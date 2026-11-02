import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { ToolLayout } from '../components/ToolLayout'
import { IconBtn, Thumb } from '../components/Thumb'
import { useSortable } from '../components/useSortable'
import { usePdfLifetime } from '../components/usePdfLifetime'
import { downloadBlob, loadPdf, openForWriting, renderThumb, type PdfFile } from '../lib/pdf'

type Item = PdfFile & { thumb: string }

export default function Merge() {
  const [items, setItems] = useState<Item[]>([])
  const sortable = useSortable(items, setItems)
  const pdfs = usePdfLifetime()

  const add = async (files: File[]) => {
    const loaded: Item[] = []
    for (const f of files) {
      const pdf = await loadPdf(f)
      loaded.push(pdfs.track({ ...pdf, thumb: await renderThumb(pdf.doc, 1) }))
    }
    setItems(prev => [...prev, ...loaded])
  }

  const remove = (it: Item) => {
    setItems(items.filter(x => x.id !== it.id))
    pdfs.close(it)
  }

  const merge = async () => {
    const out = await PDFDocument.create()
    for (const it of items) {
      const src = await openForWriting(it.bytes, it.name)
      const pages = await out.copyPages(src, src.getPageIndices())
      pages.forEach(p => out.addPage(p))
    }
    downloadBlob(await out.save(), 'merged.pdf')
  }

  return (
    <ToolLayout
      title="Merge PDF files"
      subtitle="Combine PDFs in the order you want with the easiest PDF merger available."
      accept="application/pdf,.pdf"
      multiple
      selectLabel="Select PDF files"
      hasFiles={items.length > 0}
      onFiles={add}
      actionLabel="Merge PDF"
      actionDisabled={items.length < 2}
      onAction={merge}
      sidebar={
        <p className="info">
          {items.length < 2
            ? 'Add at least one more PDF to merge.'
            : 'Drag files to change the order, then click Merge PDF.'}
        </p>
      }
    >
      <div className="thumb-grid">
        {items.map((it, i) => (
          <Thumb
            key={it.id}
            src={it.thumb}
            label={it.name}
            sub={`${it.pageCount} page${it.pageCount > 1 ? 's' : ''}`}
            dragProps={sortable(i)}
            actions={<IconBtn title="Remove" onClick={() => remove(it)}>✕</IconBtn>}
          />
        ))}
      </div>
    </ToolLayout>
  )
}
