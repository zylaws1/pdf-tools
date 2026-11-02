import { BlendMode, LineCapStyle, degrees, rgb, type PDFImage } from 'pdf-lib'
import { openForWriting, type PageViewport } from '../../lib/pdf'
import { arrowHead, hexToRgb01, strokesToAbs, type El, type ImgData, type Point } from './model'
import { FontEmbedder, baselineOffset, drawStyledText, fontRegistry, type FontFamily } from './fonts'
import { applyForm, type FormState } from './form'

const color = (hex: string) => rgb(...hexToRgb01(hex))

export async function exportPdf(bytes: Uint8Array, els: El[], viewports: PageViewport[], form: FormState | null) {
  // decide each text element's fonts once, so subsetting and drawing always agree
  const fontOf = new Map<El, { fam: FontFamily; fallback: FontFamily | null }>()
  for (const el of els) {
    if (el.kind !== 'text' || el.hidden) continue
    const fam = fontRegistry.get(el.font)
    const load = (f: FontFamily) => fontRegistry.load(f.key, fontRegistry.pick(f, el.bold, el.italic).variant)
    await load(fam)
    // loading a fallback can reveal it lacks glyphs too and switch to the next one, which then needs loading
    let fallback = fontRegistry.fallbackOf(el.font, el.text ?? '', el.fallbackFont)
    for (let i = 0; fallback && i < 3; i++) {
      await load(fallback)
      const next = fontRegistry.fallbackOf(el.font, el.text ?? '', el.fallbackFont)
      if (next === fallback) break
      fallback = next
    }
    fontOf.set(el, { fam, fallback })
  }
  const pdf = await openForWriting(bytes)
  const embedder = new FontEmbedder(pdf)
  for (const [el, { fam, fallback }] of fontOf) {
    for (const seg of fontRegistry.segments(fam, fallback, (el.text ?? '').replace(/\n/g, ''))) embedder.use(seg.fam, el.bold, el.italic, seg.text)
  }
  // the same signature placed on many pages is embedded once
  const images = new Map<ImgData, PDFImage>()
  if (form) applyForm(pdf.getForm(), form)

  for (const el of els) {
    if (el.hidden) continue
    const page = pdf.getPage(el.page)
    const vp = viewports[el.page]
    const P = (x: number, y: number) => {
      const [px, py] = vp.convertToPdfPoint(x, y) as Point
      return { x: px, y: py }
    }
    const svgPath = (pts: Point[], close = false) =>
      pts.map(([x, y], i) => {
        const p = P(x, y)
        // drawSvgPath flips the y axis around its origin, which we pin at (0, 0)
        return `${i ? 'L' : 'M'}${p.x} ${-p.y}`
      }).join(' ') + (close ? ' Z' : '')
    const rotate = degrees(vp.rotation)
    const opacity = el.opacity
    const sw = el.strokeWidth ?? 0

    // rectangle in PDF space from two display corners, inset so strokes stay inside the box like the preview
    const box = (inset: number) => {
      const a = P(el.x, el.y)
      const b = P(el.x + el.w, el.y + el.h)
      return {
        x: Math.min(a.x, b.x) + inset,
        y: Math.min(a.y, b.y) + inset,
        width: Math.max(0, Math.abs(b.x - a.x) - inset * 2),
        height: Math.max(0, Math.abs(b.y - a.y) - inset * 2),
      }
    }

    switch (el.kind) {
      case 'whiteout':
      case 'highlight':
        page.drawRectangle({
          ...box(0),
          color: color(el.fill ?? '#ffffff'),
          opacity,
          ...(el.kind === 'highlight' && { blendMode: BlendMode.Multiply }),
        })
        break
      case 'rect':
        page.drawRectangle({
          ...box(sw / 2),
          color: el.fill ? color(el.fill) : undefined,
          borderColor: sw > 0 ? color(el.stroke!) : undefined,
          borderWidth: sw,
          opacity,
          borderOpacity: opacity,
        })
        break
      case 'ellipse': {
        const b = box(sw / 2)
        page.drawEllipse({
          x: b.x + b.width / 2,
          y: b.y + b.height / 2,
          xScale: b.width / 2,
          yScale: b.height / 2,
          color: el.fill ? color(el.fill) : undefined,
          borderColor: sw > 0 ? color(el.stroke!) : undefined,
          borderWidth: sw,
          opacity,
          borderOpacity: opacity,
        })
        break
      }
      case 'line':
      case 'arrow': {
        const x2 = el.x + el.w
        const y2 = el.y + el.h
        let end: Point = [x2, y2]
        if (el.kind === 'arrow') {
          const head = arrowHead(el.x, el.y, x2, y2, sw)
          end = head.base
          page.drawSvgPath(svgPath(head.tri, true), { x: 0, y: 0, color: color(el.stroke!), opacity })
        }
        page.drawLine({ start: P(el.x, el.y), end: P(...end), thickness: sw, color: color(el.stroke!), opacity, lineCap: LineCapStyle.Round })
        break
      }
      case 'pen':
        for (const s of strokesToAbs(el)) {
          const pts = s.length === 1 ? [s[0], [s[0][0] + 0.01, s[0][1]] as Point] : s
          page.drawSvgPath(svgPath(pts), {
            x: 0,
            y: 0,
            borderColor: color(el.stroke!),
            borderWidth: sw,
            borderOpacity: opacity,
            borderLineCap: LineCapStyle.Round,
          })
        }
        break
      case 'image': {
        let image = images.get(el.img!)
        if (!image) images.set(el.img!, (image = await pdf.embedPng(el.img!.bytes)))
        page.drawImage(image, { ...P(el.x, el.y + el.h), width: el.w, height: el.h, rotate, opacity })
        break
      }
      case 'text': {
        const { fam, fallback } = fontOf.get(el)!
        const size = el.size!
        const lh = el.lineHeight ?? 1.2
        // each line is drawn in pieces: the element's font, and its fallback for characters that font lacks
        // (one at a time: the embedder caches each font only after it has been embedded)
        const lines = []
        for (const line of el.text!.split('\n')) {
          const segs = []
          for (const seg of fontRegistry.segments(fam, fallback, line)) {
            const { font, fakeBold, fakeItalic } = await embedder.get(seg.fam, el.bold, el.italic)
            if (seg.fam.standard) {
              try {
                font.encodeText(seg.text)
              } catch {
                throw new Error(`"${line}" uses characters that ${seg.fam.label} can't display. Pick another font for this text.`)
              }
            }
            // the skew is applied in unrotated text space, so simulated italic is only drawn on upright pages
            segs.push({ ...seg, font, fakeBold, fakeItalic: fakeItalic && vp.rotation === 0, width: font.widthOfTextAtSize(seg.text, size) })
          }
          lines.push(segs)
        }
        const widths = lines.map(segs => segs.reduce((w, s) => w + s.width, 0))
        const boxW = Math.max(...widths)
        lines.forEach((segs, i) => {
          if (!segs.length) return
          let x = el.x + (el.align === 'center' ? (boxW - widths[i]) / 2 : el.align === 'right' ? boxW - widths[i] : 0)
          const by = el.y + size * (baselineOffset(fam, lh) + i * lh)
          if (el.underline) {
            const uy = by + size * 0.12
            page.drawLine({ start: P(x, uy), end: P(x + widths[i], uy), thickness: Math.max(0.5, size / 15), color: color(el.color!), opacity })
          }
          for (const s of segs) {
            drawStyledText(
              page,
              s.text,
              { ...P(x, by), size, font: s.font, color: color(el.color!), opacity, rotate, ...(s.fakeItalic && { ySkew: degrees(12) }) },
              s.fakeBold,
            )
            x += s.width
          }
        })
        break
      }
    }
  }
  return pdf.save()
}
