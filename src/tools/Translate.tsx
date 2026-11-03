import { useEffect, useState } from 'react'
import { ToolLayout } from '../components/ToolLayout'
import { Thumb } from '../components/Thumb'
import { usePdfLifetime } from '../components/usePdfLifetime'
import { baseName, loadPdf, renderThumb, type PageViewport, type PdfFile } from '../lib/pdf'
import { getTextRuns } from './edit/textRuns'
import { buildReplacement } from './edit/autoReplace'
import { exportPdf } from './edit/exportPdf'
import { fontRegistry } from './edit/fonts'
import { guessLanguage, translateText, LANGS } from '../lib/translate'
import type { El } from './edit/model'

const LAST_TO_KEY = 'pdf-tools:translate-to'
const CJK_TARGETS = new Set(['zh', 'zh-Hant', 'ja', 'ko'])

interface Result {
  url: string
  filename: string
  issues: { message: string; count: number }[]
  fallback?: string
}

export default function Translate() {
  const [file, setFile] = useState<PdfFile | null>(null)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [from, setFrom] = useState('en')
  const [to, setTo] = useState(() => localStorage.getItem(LAST_TO_KEY) ?? 'zh')
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
    setResult(null)
    const t: string[] = []
    for (let n = 1; n <= pdf.pageCount; n++) {
      // also warms up pdf.js's per-page font info, which the text extraction below needs
      const thumb = await renderThumb(pdf.doc, n, 140)
      if (!pdfs.isCurrent(gen)) return
      t.push(thumb)
      setThumbs([...t])
      if (n === 1) {
        const vp = (await pdf.doc.getPage(1)).getViewport({ scale: 1 })
        const runs = await getTextRuns(pdf.doc, 1, vp)
        setFrom(guessLanguage(runs.map(r => r.str).join('\n')) ?? 'en')
      }
    }
  }

  const translate = async () => {
    if (!file) return
    // there's no bundled CJK font; the only way to actually draw CJK text is a system font, which
    // needs this (a one-time permission prompt the first time) before match() can find one at all.
    // Best-effort: a denied/unsupported request just means CJK lines fall back to "no available font",
    // same as before.
    if (CJK_TARGETS.has(to) && fontRegistry.systemSupported && !fontRegistry.systemLoaded) {
      await fontRegistry.addSystemFonts().catch(() => {})
    }
    const viewports: PageViewport[] = []
    const els: El[] = []
    const issues = new Map<string, number>()
    const note = (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e)
      issues.set(message, (issues.get(message) ?? 0) + 1)
    }
    for (let n = 1; n <= file.pageCount; n++) {
      const vp = (await file.doc.getPage(n)).getViewport({ scale: 1 })
      viewports.push(vp)
      try {
        const runs = await getTextRuns(file.doc, n, vp)
        for (const run of runs) {
          try {
            const translated = await translateText(run.str, from, to)
            els.push(...(await buildReplacement(file, n - 1, run, translated.text)))
          } catch (e) {
            // leave this line as it was rather than failing the whole document over one line
            note(e)
          }
        }
      } catch (e) {
        // couldn't even read this page's text (e.g. a corrupt or unusually-structured embedded font);
        // leave the whole page untouched rather than losing every other page's work too
        note(new Error(`Page ${n}: couldn't be read — ${e instanceof Error ? e.message : String(e)}`))
      }
    }

    // never let an unexpected failure here lose the document entirely: fall back to the original
    let bytes: Uint8Array
    let fallback: string | undefined
    try {
      bytes = await exportPdf(file.bytes, els, viewports, null)
    } catch (e) {
      bytes = file.bytes
      fallback = `Couldn't build the translated PDF (${e instanceof Error ? e.message : String(e)}); here's the original, unchanged.`
    }
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }))
    setResult({
      url,
      filename: `${baseName(file.name)}-${to}.pdf`,
      issues: [...issues].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count),
      fallback,
    })
  }

  return (
    <ToolLayout
      title="Translate PDF"
      subtitle="Translate every line of text in place — same layout, fonts and positions, just in another language."
      accept="application/pdf,.pdf"
      multiple={false}
      selectLabel="Select PDF file"
      hasFiles={!!file}
      onFiles={load}
      actionLabel="Translate PDF"
      onAction={translate}
      sidebar={
        <>
          <label className="field">
            From
            <select value={from} onChange={e => setFrom(e.target.value)}>
              {LANGS.map(l => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            To
            <select
              value={to}
              onChange={e => {
                setTo(e.target.value)
                localStorage.setItem(LAST_TO_KEY, e.target.value)
              }}
            >
              {LANGS.map(l => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <p className="info">
            Tries your browser's on-device translator first; otherwise uses a free online service, sending each line of text (not the file) to translate it. A
            line that comes back much longer shrinks slightly to fit its original space.
          </p>
          {result && (
            <>
              {result.fallback && <p className="warn">{result.fallback}</p>}
              {result.issues.length > 0 && (
                <div className="warn">
                  <p>{result.issues.reduce((n, i) => n + i.count, 0)} line(s) couldn't be translated and were left as they were:</p>
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
                Download translated PDF
              </a>
            </>
          )}
        </>
      }
    >
      {result ? (
        <iframe className="result-preview" src={result.url} title="Translated PDF preview" />
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
