import { useState } from 'react'
import { PDFDocument, degrees } from 'pdf-lib'
import { ToolLayout } from '../components/ToolLayout'
import { IconBtn, Thumb } from '../components/Thumb'
import { useSortable } from '../components/useSortable'
import { usePdfLifetime } from '../components/usePdfLifetime'
import { baseName, downloadBlob, loadPdf, openForWriting, renderThumb, uid, type PdfFile } from '../lib/pdf'

interface PageItem {
  id: string
  fileId: string
  index: number
  rotation: number
  thumb?: string
}

export default function Organize() {
  const [files, setFiles] = useState<PdfFile[]>([])
  const [pages, setPages] = useState<PageItem[]>([])
  const sortable = useSortable(pages, setPages)
  const pdfs = usePdfLifetime()

  const add = async (list: File[]) => {
    for (const f of list) {
      const pdf = pdfs.track(await loadPdf(f))
      const items: PageItem[] = Array.from({ length: pdf.pageCount }, (_, i) => ({ id: uid(), fileId: pdf.id, index: i, rotation: 0 }))
      setFiles(prev => [...prev, pdf])
      setPages(prev => [...prev, ...items])
      // render thumbnails progressively without blocking the UI; stops quietly if the tool is closed meanwhile
      void (async () => {
        for (const it of items) {
          const thumb = await renderThumb(pdf.doc, it.index + 1, 150)
          setPages(prev => prev.map(p => (p.id === it.id ? { ...p, thumb } : p)))
        }
      })().catch(() => {})
    }
  }

  const update = (id: string, fn: (p: PageItem) => PageItem | null) =>
    setPages(prev => prev.flatMap(p => (p.id === id ? (fn(p) ?? []) : [p])))

  const rotateAll = (delta: number) => setPages(prev => prev.map(p => ({ ...p, rotation: (p.rotation + delta + 360) % 360 })))

  const save = async () => {
    if (!pages.length) throw new Error('No pages left')
    const out = await PDFDocument.create()
    const sources = new Map<string, PDFDocument>()
    // only open files that still contribute pages
    const used = new Set(pages.map(p => p.fileId))
    for (const f of files) if (used.has(f.id)) sources.set(f.id, await openForWriting(f.bytes, f.name))
    for (const it of pages) {
      const [page] = await out.copyPages(sources.get(it.fileId)!, [it.index])
      page.setRotation(degrees((page.getRotation().angle + it.rotation) % 360))
      out.addPage(page)
    }
    downloadBlob(await out.save(), `${baseName(files[0].name)}-organized.pdf`)
  }

  const fileName = (id: string) => files.find(f => f.id === id)?.name ?? ''

  return (
    <ToolLayout
      title="Organize PDF"
      subtitle="Sort, rotate and delete pages. Add more PDFs to mix pages from several files."
      accept="application/pdf,.pdf"
      multiple
      selectLabel="Select PDF files"
      hasFiles={files.length > 0}
      onFiles={add}
      actionLabel="Save PDF"
      actionDisabled={!pages.length}
      onAction={save}
      sidebar={
        <>
          <p className="info">Drag pages to reorder. Hover a page to rotate or delete it.</p>
          <div className="btn-row">
            <button className="btn-secondary" onClick={() => rotateAll(-90)}>⟲ Rotate all left</button>
            <button className="btn-secondary" onClick={() => rotateAll(90)}>⟳ Rotate all right</button>
          </div>
          <p className="hint">{pages.length} pages</p>
        </>
      }
    >
      <div className="thumb-grid small">
        {pages.map((p, i) => (
          <Thumb
            key={p.id}
            src={p.thumb}
            rotation={p.rotation}
            label={`${i + 1}`}
            sub={files.length > 1 ? fileName(p.fileId) : undefined}
            dragProps={sortable(i)}
            actions={
              <>
                <IconBtn title="Rotate left" onClick={() => update(p.id, x => ({ ...x, rotation: (x.rotation + 270) % 360 }))}>⟲</IconBtn>
                <IconBtn title="Rotate right" onClick={() => update(p.id, x => ({ ...x, rotation: (x.rotation + 90) % 360 }))}>⟳</IconBtn>
                <IconBtn title="Delete page" onClick={() => update(p.id, () => null)}>✕</IconBtn>
              </>
            }
          />
        ))}
      </div>
    </ToolLayout>
  )
}
