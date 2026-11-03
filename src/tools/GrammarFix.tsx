import { useEffect, useState } from 'react'
import { ToolLayout } from '../components/ToolLayout'
import { Thumb } from '../components/Thumb'
import { usePdfLifetime } from '../components/usePdfLifetime'
import { baseName, loadPdf, renderThumb, type PageViewport, type PdfFile } from '../lib/pdf'
import { getTextRuns, type TextRun } from './edit/textRuns'
import { buildReplacement } from './edit/autoReplace'
import { exportPdf } from './edit/exportPdf'
import { fixGrammar } from '../lib/grammar'
import { diffWords, type DiffToken } from '../lib/diffWords'
import type { El } from './edit/model'

interface Change {
  id: string
  page: number
  run: TextRun
  before: string
  after: string
  fixes: number
  via: 'on-device' | 'online'
  accepted: boolean
}

interface Result {
  url: string
  filename: string
  issues: { message: string; count: number }[]
  fallback?: string
}

function Diff({ tokens, kind }: { tokens: DiffToken[]; kind: 'before' | 'after' }) {
  const markType = kind === 'before' ? 'removed' : 'added'
  return (
    <>
      {tokens.map((t, i) => (t.type === markType ? <mark key={i} className={`diff-${t.type}`}>{t.text}</mark> : <span key={i}>{t.text}</span>))}
    </>
  )
}

export default function GrammarFix() {
  const [file, setFile] = useState<PdfFile | null>(null)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [checked, setChecked] = useState(false)
  const [changes, setChanges] = useState<Change[]>([])
  const [checkIssues, setCheckIssues] = useState<{ message: string; count: number }[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const pdfs = usePdfLifetime()

  // revoke the previous blob URL whenever it's replaced, and on unmount
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url)
  }, [result])

  const load = async ([f]: File[]) => {
    const gen = pdfs.nextGeneration()
    const pdf = pdfs.track(await loadPdf(f, { keepFontData: true }))
    if (!pdfs.isCurrent(gen)) return pdfs.close(pdf)
    pdfs.close(file)
    setFile(pdf)
    setThumbs([])
    setChecked(false)
    setChanges([])
    setCheckIssues([])
    setResult(null)
    const t: string[] = []
    for (let n = 1; n <= pdf.pageCount; n++) {
      // also warms up pdf.js's per-page font info, which the text extraction below needs
      const thumb = await renderThumb(pdf.doc, n, 140)
      if (!pdfs.isCurrent(gen)) return
      t.push(thumb)
      setThumbs([...t])
    }
  }

  const check = async () => {
    if (!file) return
    const found: Change[] = []
    const issues = new Map<string, number>()
    for (let n = 1; n <= file.pageCount; n++) {
      const vp = (await file.doc.getPage(n)).getViewport({ scale: 1 })
      const runs = await getTextRuns(file.doc, n, vp)
      for (const run of runs) {
        try {
          const fixed = await fixGrammar(run.str)
          if (fixed.fixes > 0) found.push({ id: run.id, page: n, run, before: run.str, after: fixed.text, fixes: fixed.fixes, via: fixed.via, accepted: true })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          issues.set(message, (issues.get(message) ?? 0) + 1)
        }
      }
    }
    setChanges(found)
    setCheckIssues([...issues].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count))
    setChecked(true)
  }

  const apply = async () => {
    if (!file) return
    const accepted = changes.filter(c => c.accepted)
    const viewports: PageViewport[] = []
    for (let n = 1; n <= file.pageCount; n++) viewports.push((await file.doc.getPage(n)).getViewport({ scale: 1 }))

    const els: El[] = []
    const issues = new Map<string, number>()
    for (const c of accepted) {
      try {
        els.push(...(await buildReplacement(file, c.page - 1, c.run, c.after)))
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        issues.set(message, (issues.get(message) ?? 0) + 1)
      }
    }

    // never let an unexpected failure here lose the document entirely: fall back to the original
    let bytes: Uint8Array
    let fallback: string | undefined
    try {
      bytes = await exportPdf(file.bytes, els, viewports, null)
    } catch (e) {
      bytes = file.bytes
      fallback = `Couldn't build the grammar-fixed PDF (${e instanceof Error ? e.message : String(e)}); here's the original, unchanged.`
    }
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }))
    setResult({
      url,
      filename: `${baseName(file.name)}-grammar-fixed.pdf`,
      issues: [...issues].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count),
      fallback,
    })
  }

  const toggle = (id: string) => setChanges(prev => prev.map(c => (c.id === id ? { ...c, accepted: !c.accepted } : c)))
  const setAll = (accepted: boolean) => setChanges(prev => prev.map(c => ({ ...c, accepted })))

  const acceptedCount = changes.filter(c => c.accepted).length
  const action = !checked
    ? { label: 'Check grammar', run: check, disabled: !file }
    : { label: `Apply ${acceptedCount} change${acceptedCount === 1 ? '' : 's'}`, run: apply, disabled: acceptedCount === 0 }

  return (
    <ToolLayout
      title="Fix grammar in PDF"
      subtitle="Review each spelling or grammar fix before it's applied — same layout, fonts and positions, just the wording you approve."
      accept="application/pdf,.pdf"
      multiple={false}
      selectLabel="Select PDF file"
      hasFiles={!!file}
      onFiles={load}
      actionLabel={action.label}
      actionDisabled={action.disabled}
      onAction={action.run}
      sidebar={
        <>
          <p className="info">
            Tries your browser's on-device proofreader first; otherwise uses a free online service (LanguageTool), sending each line of text (not the file) to
            check it. Checking finds the issues; nothing is changed in the PDF until you apply the ones you want.
          </p>
          {checked && (
            <>
              <p className="info">
                {changes.length === 0
                  ? 'No issues found.'
                  : `${changes.length} issue${changes.length === 1 ? '' : 's'} found, ${acceptedCount} selected.`}
              </p>
              {changes.length > 0 && (
                <div className="field-row">
                  <button className="btn-secondary" onClick={() => setAll(true)}>
                    Select all
                  </button>
                  <button className="btn-secondary" onClick={() => setAll(false)}>
                    Select none
                  </button>
                </div>
              )}
              {checkIssues.length > 0 && (
                <div className="warn">
                  <p>{checkIssues.reduce((n, i) => n + i.count, 0)} line(s) couldn't be checked:</p>
                  <ul className="issue-list">
                    {checkIssues.map(i => (
                      <li key={i.message}>
                        {i.count}× {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {result && (
            <>
              {result.fallback && <p className="warn">{result.fallback}</p>}
              {result.issues.length > 0 && (
                <div className="warn">
                  <p>{result.issues.reduce((n, i) => n + i.count, 0)} change(s) couldn't be applied and were left as they were:</p>
                  <ul className="issue-list">
                    {result.issues.map(i => (
                      <li key={i.message}>
                        {i.count}× {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <a className="btn-secondary" href={result.url} download={result.filename}>
                Download fixed PDF
              </a>
            </>
          )}
        </>
      }
    >
      {result ? (
        <iframe className="result-preview" src={result.url} title="Grammar-fixed PDF preview" />
      ) : checked ? (
        <div className="change-list">
          {changes.map(c => {
            const { before, after } = diffWords(c.before, c.after)
            return (
              <label key={c.id} className={`change-card${c.accepted ? '' : ' rejected'}`}>
                <input type="checkbox" checked={c.accepted} onChange={() => toggle(c.id)} />
                <div className="change-body">
                  <div className="change-meta muted">
                    Page {c.page} · {c.via === 'on-device' ? 'on-device' : 'online'}
                  </div>
                  <p className="change-before">
                    <Diff tokens={before} kind="before" />
                  </p>
                  <p className="change-after">
                    <Diff tokens={after} kind="after" />
                  </p>
                </div>
              </label>
            )
          })}
        </div>
      ) : (
        <div className="thumb-grid small">
          {Array.from({ length: file?.pageCount ?? 0 }, (_, i) => (
            <Thumb key={i} src={thumbs[i]} label={`Page ${i + 1}`} />
          ))}
        </div>
      )}
    </ToolLayout>
  )
}
