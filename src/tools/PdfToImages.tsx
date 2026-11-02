import { useState } from 'react'
import { ToolLayout } from '../components/ToolLayout'
import { Thumb } from '../components/Thumb'
import { usePdfLifetime } from '../components/usePdfLifetime'
import { baseName, canvasToBytes, downloadMany, loadPdf, renderPageToCanvas, renderThumb, type PdfFile } from '../lib/pdf'

export default function PdfToImages() {
  const [file, setFile] = useState<PdfFile | null>(null)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [dpi, setDpi] = useState(150)
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg')
  const pdfs = usePdfLifetime()

  const load = async ([f]: File[]) => {
    const gen = pdfs.nextGeneration()
    const pdf = pdfs.track(await loadPdf(f))
    if (!pdfs.isCurrent(gen)) return pdfs.close(pdf)
    pdfs.close(file)
    setFile(pdf)
    setThumbs([])
    const t: string[] = []
    for (let n = 1; n <= pdf.pageCount; n++) {
      const thumb = await renderThumb(pdf.doc, n, 140)
      if (!pdfs.isCurrent(gen)) return
      t.push(thumb)
      setThumbs([...t])
    }
  }

  const convert = async () => {
    if (!file) return
    const ext = format === 'jpeg' ? 'jpg' : 'png'
    const out = []
    for (let n = 1; n <= file.pageCount; n++) {
      const canvas = await renderPageToCanvas(file.doc, n, dpi / 72)
      out.push({ name: `${baseName(file.name)}-page-${n}.${ext}`, data: await canvasToBytes(canvas, `image/${format}`, 0.92) })
    }
    downloadMany(out, `${baseName(file.name)}-images.zip`, `image/${format}`)
  }

  return (
    <ToolLayout
      title="PDF to Image"
      subtitle="Convert each PDF page into a JPG or PNG image."
      accept="application/pdf,.pdf"
      multiple={false}
      selectLabel="Select PDF file"
      hasFiles={!!file}
      onFiles={load}
      actionLabel="Convert to images"
      onAction={convert}
      sidebar={
        <>
          <label className="field">
            Format
            <select value={format} onChange={e => setFormat(e.target.value as 'jpeg' | 'png')}>
              <option value="jpeg">JPG</option>
              <option value="png">PNG</option>
            </select>
          </label>
          <label className="field">
            Quality
            <select value={dpi} onChange={e => setDpi(+e.target.value)}>
              <option value={96}>Screen (96 dpi)</option>
              <option value={150}>Normal (150 dpi)</option>
              <option value={300}>High (300 dpi)</option>
            </select>
          </label>
          <p className="info">{file?.pageCount} page(s) → {file && file.pageCount > 1 ? 'downloaded as a ZIP' : 'one image'}.</p>
        </>
      }
    >
      <div className="thumb-grid small">
        {Array.from({ length: file?.pageCount ?? 0 }, (_, i) => (
          <Thumb key={i} src={thumbs[i]} label={`Page ${i + 1}`} />
        ))}
      </div>
    </ToolLayout>
  )
}
