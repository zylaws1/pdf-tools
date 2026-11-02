import { useEffect, useRef, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { ToolLayout } from '../components/ToolLayout'
import { IconBtn, Thumb } from '../components/Thumb'
import { useSortable } from '../components/useSortable'
import { canvasToBytes, downloadBlob, uid } from '../lib/pdf'

interface Img {
  id: string
  name: string
  url: string
  file: File
}

const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const
type Size = keyof typeof SIZES | 'fit'
type Orientation = 'auto' | 'portrait' | 'landscape'

// Re-encode through a canvas so EXIF orientation is applied and any browser-readable format works
async function normalize(file: File) {
  const bmp = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  const isJpeg = /jpe?g/.test(file.type)
  return { bytes: await canvasToBytes(canvas, isJpeg ? 'image/jpeg' : 'image/png', 0.92), isJpeg, w: canvas.width, h: canvas.height }
}

export default function ImagesToPdf() {
  const [imgs, setImgs] = useState<Img[]>([])
  const [size, setSize] = useState<Size>('a4')
  const [orientation, setOrientation] = useState<Orientation>('auto')
  const [margin, setMargin] = useState(0)
  const sortable = useSortable(imgs, setImgs)

  // release preview object URLs when images are removed or the tool closes
  const imgsRef = useRef(imgs)
  useEffect(() => {
    imgsRef.current = imgs
  })
  useEffect(() => () => imgsRef.current.forEach(i => URL.revokeObjectURL(i.url)), [])

  const remove = (it: Img) => {
    URL.revokeObjectURL(it.url)
    setImgs(imgs.filter(x => x.id !== it.id))
  }

  const add = (files: File[]) =>
    setImgs(prev => [...prev, ...files.map(f => ({ id: uid(), name: f.name, url: URL.createObjectURL(f), file: f }))])

  const convert = async () => {
    const pdf = await PDFDocument.create()
    for (const it of imgs) {
      const { bytes, isJpeg, w, h } = await normalize(it.file)
      const image = isJpeg ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
      let pw: number, ph: number
      if (size === 'fit') [pw, ph] = [w + margin * 2, h + margin * 2]
      else {
        const [a, b] = SIZES[size]
        const landscape = orientation === 'landscape' || (orientation === 'auto' && w > h)
        ;[pw, ph] = landscape ? [b, a] : [a, b]
      }
      const page = pdf.addPage([pw, ph])
      const scale = Math.min((pw - margin * 2) / w, (ph - margin * 2) / h)
      const dw = w * scale
      const dh = h * scale
      page.drawImage(image, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh })
    }
    downloadBlob(await pdf.save(), imgs.length === 1 ? imgs[0].name.replace(/\.[^.]+$/, '.pdf') : 'images.pdf')
  }

  return (
    <ToolLayout
      title="Image to PDF"
      subtitle="Convert JPG, PNG, WebP and other images to PDF. Adjust page size, orientation and margins."
      accept="image/*"
      multiple
      selectLabel="Select images"
      hasFiles={imgs.length > 0}
      onFiles={add}
      actionLabel="Convert to PDF"
      actionDisabled={!imgs.length}
      onAction={convert}
      sidebar={
        <>
          <label className="field">
            Page size
            <select value={size} onChange={e => setSize(e.target.value as Size)}>
              <option value="a4">A4 (297×210 mm)</option>
              <option value="letter">US Letter</option>
              <option value="fit">Same as image</option>
            </select>
          </label>
          {size !== 'fit' && (
            <label className="field">
              Orientation
              <select value={orientation} onChange={e => setOrientation(e.target.value as Orientation)}>
                <option value="auto">Auto (match each image)</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
          )}
          <label className="field">
            Margin
            <select value={margin} onChange={e => setMargin(+e.target.value)}>
              <option value={0}>No margin</option>
              <option value={20}>Small</option>
              <option value={50}>Big</option>
            </select>
          </label>
          <p className="hint">Drag images to change page order.</p>
        </>
      }
    >
      <div className="thumb-grid">
        {imgs.map((it, i) => (
          <Thumb
            key={it.id}
            src={it.url}
            label={it.name}
            dragProps={sortable(i)}
            actions={<IconBtn title="Remove" onClick={() => remove(it)}>✕</IconBtn>}
          />
        ))}
      </div>
    </ToolLayout>
  )
}
