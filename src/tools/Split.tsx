import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { ToolLayout } from '../components/ToolLayout'
import { Thumb } from '../components/Thumb'
import { usePdfLifetime } from '../components/usePdfLifetime'
import { baseName, downloadMany, loadPdf, openForWriting, parseRanges, renderThumb, type PdfFile } from '../lib/pdf'

type Mode = 'ranges' | 'all' | 'select'

export default function Split() {
  const [file, setFile] = useState<PdfFile | null>(null)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [mode, setMode] = useState<Mode>('ranges')
  const [ranges, setRanges] = useState('')
  const [mergeRanges, setMergeRanges] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const pdfs = usePdfLifetime()

  const load = async ([f]: File[]) => {
    const gen = pdfs.nextGeneration()
    const pdf = pdfs.track(await loadPdf(f))
    if (!pdfs.isCurrent(gen)) return pdfs.close(pdf)
    pdfs.close(file)
    setFile(pdf)
    setThumbs([])
    setRanges(pdf.pageCount > 1 ? `1-${Math.ceil(pdf.pageCount / 2)}, ${Math.ceil(pdf.pageCount / 2) + 1}-${pdf.pageCount}` : '1')
    setSelected(new Set())
    const t: string[] = []
    for (let n = 1; n <= pdf.pageCount; n++) {
      const thumb = await renderThumb(pdf.doc, n, 140)
      if (!pdfs.isCurrent(gen)) return
      t.push(thumb)
      setThumbs([...t])
    }
  }

  const toggle = (n: number) => {
    if (mode !== 'select') return
    const s = new Set(selected)
    if (s.has(n)) s.delete(n)
    else s.add(n)
    setSelected(s)
  }

  const split = async () => {
    if (!file) return
    let groups: number[][]
    if (mode === 'all') groups = Array.from({ length: file.pageCount }, (_, i) => [i + 1])
    else if (mode === 'select') groups = [[...selected].sort((a, b) => a - b)]
    else {
      groups = parseRanges(ranges, file.pageCount)
      if (mergeRanges) groups = [groups.flat()]
    }
    if (!groups[0]?.length) throw new Error('Select at least one page')
    const src = await openForWriting(file.bytes, file.name)
    const name = baseName(file.name)
    const outputs = []
    for (const g of groups) {
      const out = await PDFDocument.create()
      const pages = await out.copyPages(src, g.map(n => n - 1))
      pages.forEach(p => out.addPage(p))
      const label = g.length === 1 ? `${g[0]}` : `${g[0]}-${g[g.length - 1]}`
      outputs.push({ name: `${name}-${groups.length === 1 && mode !== 'all' ? 'extracted' : label}.pdf`, data: await out.save() })
    }
    downloadMany(outputs, `${name}-split.zip`)
  }

  return (
    <ToolLayout
      title="Split PDF file"
      subtitle="Separate one page or a whole set for easy conversion into independent PDF files."
      accept="application/pdf,.pdf"
      multiple={false}
      selectLabel="Select PDF file"
      hasFiles={!!file}
      onFiles={load}
      actionLabel="Split PDF"
      actionDisabled={mode === 'select' && selected.size === 0}
      onAction={split}
      sidebar={
        <>
          <div className="segmented">
            {(['ranges', 'all', 'select'] as Mode[]).map(m => (
              <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
                {{ ranges: 'By range', all: 'Every page', select: 'Pick pages' }[m]}
              </button>
            ))}
          </div>
          {mode === 'ranges' && (
            <>
              <label className="field">
                Page ranges
                <input value={ranges} onChange={e => setRanges(e.target.value)} placeholder="e.g. 1-3, 5, 8-" />
              </label>
              <p className="hint">Each range becomes its own PDF. Use commas to separate ranges.</p>
              <label className="check">
                <input type="checkbox" checked={mergeRanges} onChange={e => setMergeRanges(e.target.checked)} />
                Merge all ranges into one PDF
              </label>
            </>
          )}
          {mode === 'all' && <p className="info">Every page will be saved as a separate PDF ({file?.pageCount} files, zipped).</p>}
          {mode === 'select' && (
            <p className="info">
              Click pages to select them. {selected.size} selected — they'll be extracted into one PDF.
            </p>
          )}
        </>
      }
    >
      <div className="thumb-grid small">
        {Array.from({ length: file?.pageCount ?? 0 }, (_, i) => i + 1).map(n => (
          <Thumb key={n} src={thumbs[n - 1]} label={`Page ${n}`} selected={selected.has(n)} onClick={mode === 'select' ? () => toggle(n) : undefined} />
        ))}
      </div>
    </ToolLayout>
  )
}
