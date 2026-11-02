import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderPageToCanvas, type PageViewport, type PdfjsDoc } from '../../lib/pdf'
import { fontRegistry, type FontCategory } from './fonts'

export interface TextRun {
  id: string
  str: string
  /** Cover box, top-left based */
  x: number
  y: number
  w: number
  h: number
  baseline: number
  size: number
  /** pdf.js font id, used to join pieces of the same run */
  fontId: string
  /** Font name as written in the PDF (e.g. "ABCDEF+Calibri-Bold") */
  pdfFontName: string
  /** Registry key of the PDF's own embedded font, if it could be loaded */
  docFont: string | null
  category: FontCategory
  bold: boolean
  italic: boolean
  /** The pieces pdf.js reported (`item` = index in its text content), before joining them into one line; `space` if a space was added before it. */
  parts: { str: string; x: number; w: number; space: boolean; item: number }[]
}

type PdfPage = Awaited<ReturnType<PdfjsDoc['getPage']>>

interface PdfJsFont {
  name?: string
  loadedName?: string
  data?: Uint8Array
  bold?: boolean
  italic?: boolean
  black?: boolean
  missingFile?: boolean
  isType3Font?: boolean
}

function fontInfo(page: PdfPage, fontName: string, family = '') {
  let f: PdfJsFont = {}
  try {
    if (page.commonObjs.has(fontName)) f = (page.commonObjs.get(fontName) as PdfJsFont) ?? {}
  } catch {
    // font object not available; fall back to the family hint
  }
  const name = f.name ?? ''
  const n = `${name} ${family}`.toLowerCase()
  const category: FontCategory = /courier|mono|consol/.test(n) ? 'mono' : /times|georgia|garamond|cambria|minion|roman|serif|song|ming/.test(n) && !/sans/.test(n) ? 'serif' : 'sans'
  const bold = !!f.bold || !!f.black || /bold|black|heavy|semibold|demi/i.test(name)
  const italic = !!f.italic || /italic|oblique/i.test(name)
  const docFont =
    f.data && !f.missingFile && !f.isType3Font
      ? fontRegistry.registerDocFont({ loadedName: f.loadedName ?? fontName, name: name || fontName, data: f.data, bold, italic, category })
      : null
  return { fontId: fontName, pdfFontName: name || family, docFont, category, bold, italic }
}

/** Horizontal text runs on a page, positioned in viewport (scale 1) coordinates. Call after the page has been rendered. */
export async function getTextRuns(doc: PdfjsDoc, pageNumber: number, vp: PageViewport): Promise<TextRun[]> {
  const page = await doc.getPage(pageNumber)
  const content = await page.getTextContent()
  const runs: TextRun[] = []
  content.items.forEach((item, i) => {
    if (!('str' in item) || !item.str.trim() || !item.width) return
    const tx = pdfjs.Util.transform(vp.transform, item.transform)
    if (Math.abs(tx[1]) > 0.01 || Math.abs(tx[2]) > 0.01 || tx[0] <= 0) return
    const size = Math.abs(tx[3])
    if (size < 2) return
    const run: TextRun = {
      id: `${pageNumber}:${i}`,
      str: item.str,
      x: tx[4],
      y: tx[5] - size * 0.92,
      w: item.width,
      h: size * 1.17,
      baseline: tx[5],
      size,
      ...fontInfo(page, item.fontName, content.styles[item.fontName]?.fontFamily),
      parts: [{ str: item.str, x: tx[4], w: item.width, space: false, item: i }],
    }
    // pdf.js often splits a line into words; join pieces on the same line with the same style
    const prev = runs[runs.length - 1]
    const gap = prev ? run.x - (prev.x + prev.w) : Infinity
    if (
      prev &&
      Math.abs(prev.baseline - run.baseline) < size * 0.1 &&
      Math.abs(prev.size - size) < 0.5 &&
      prev.fontId === run.fontId &&
      prev.bold === run.bold &&
      prev.italic === run.italic &&
      gap > -size * 0.3 &&
      gap < size * 0.7
    ) {
      const space = gap > size * 0.12 && !prev.str.endsWith(' ') && !run.str.startsWith(' ') ? ' ' : ''
      prev.str += space + run.str
      prev.w = run.x + run.w - prev.x
      prev.parts.push({ str: run.str, x: run.x, w: run.w, space: !!space, item: i })
      return
    }
    runs.push(run)
  })
  return runs
}

const SAMPLE_SCALE = 2
let cached: { doc: PdfjsDoc; page: number; canvas: HTMLCanvasElement } | null = null

interface GlyphArg {
  unicode?: string
}

const OPS = pdfjs.OPS
const SHOW_TEXT = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText])
const colorCache = new WeakMap<PdfjsDoc, Map<number, Promise<(string | null)[][]>>>()

/**
 * The color each character of the page's text content is drawn in, read from the PDF's drawing operators
 * (pdf.js converts gray/CMYK/RGB fills to hex). null where unknown: invisible text (e.g. the OCR layer of a scan),
 * pattern fills, or characters that couldn't be matched up.
 */
function pageCharColors(doc: PdfjsDoc, pageNumber: number) {
  let byPage = colorCache.get(doc)
  if (!byPage) colorCache.set(doc, (byPage = new Map()))
  let p = byPage.get(pageNumber)
  if (!p) {
    p = (async () => {
      const page = await doc.getPage(pageNumber)
      const [{ fnArray, argsArray }, content] = await Promise.all([page.getOperatorList(), page.getTextContent()])
      // visible characters in drawing order, with the color they are painted in
      const seq: { ch: string; color: string | null }[] = []
      let state = { fill: '#000000' as string | null, stroke: '#000000' as string | null, mode: 0 }
      const stack: (typeof state)[] = []
      fnArray.forEach((fn, i) => {
        const a = argsArray[i] as unknown[]
        if (fn === OPS.save || fn === OPS.paintFormXObjectBegin) stack.push({ ...state })
        else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd) state = stack.pop() ?? state
        else if (fn === OPS.setFillRGBColor) state.fill = typeof a[0] === 'string' ? a[0] : null
        else if (fn === OPS.setStrokeRGBColor) state.stroke = typeof a[0] === 'string' ? a[0] : null
        else if (fn === OPS.setFillColorN || fn === OPS.setFillTransparent) state.fill = null
        else if (fn === OPS.setStrokeColorN || fn === OPS.setStrokeTransparent) state.stroke = null
        else if (fn === OPS.setTextRenderingMode) state.mode = a[0] as number
        else if (SHOW_TEXT.has(fn)) {
          // render modes: 0/2/4/6 fill, 1/5 stroke only, 3/7 invisible
          const m = state.mode & 3
          const color = m === 3 ? null : m === 1 ? state.stroke : state.fill
          for (const g of (a[0] as (GlyphArg | number)[]) ?? []) {
            if (typeof g !== 'object' || !g?.unicode) continue
            for (const ch of g.unicode.normalize('NFKC')) if (ch.trim()) seq.push({ ch, color })
          }
        }
      })
      // walk the text content in the same order, matching its characters to the drawn ones
      let at = 0
      return content.items.map(item => {
        if (!('str' in item)) return []
        return [...item.str].map(ch => {
          if (!ch.trim()) return null
          for (const c of ch.normalize('NFKC')) {
            // skip a few drawn characters the text content leaves out; give up on this one if it's not close by
            const found = seq.slice(at, at + 64).findIndex(x => x.ch === c)
            if (found < 0) return null
            at += found + 1
            return seq[at - 1].color
          }
          return null
        })
      })
    })().catch(() => [])
    byPage.set(pageNumber, p)
  }
  return p
}

/**
 * Splits a line into stretches of one color each, e.g. a red label before black text.
 * Colors come from the PDF itself; where that's unknown, from the rendered page.
 * `measure` gives a character's relative advance width, to place it within its piece.
 */
export async function colorGroups(doc: PdfjsDoc, pageNumber: number, run: TextRun, measure: (ch: string) => number) {
  const known = await pageCharColors(doc, pageNumber)
  const groups: { str: string; x: number; w: number; color: string }[] = []
  let color: string | null = null
  for (const p of run.parts) {
    const chars = [...p.str]
    const widths = chars.map(c => Math.max(0.01, measure(c)))
    const k = p.w / widths.reduce((a, b) => a + b, 0)
    let x = p.x
    for (let i = 0; i < chars.length; i++) {
      const w = widths[i] * k
      const exact = known[p.item]?.[i]
      if (exact) color = exact
      else if (chars[i].trim()) {
        const s = await sampleColors(doc, pageNumber, { ...run, x, w })
        // too little ink to tell (dots, thin punctuation): keep the color around it
        if (s.ink >= 6) color = s.text
      }
      const last = groups[groups.length - 1]
      const space = i === 0 && p.space ? ' ' : ''
      if (last && (last.color === color || !color)) {
        last.str += space + chars[i]
        last.w = x + w - last.x
      } else if (last && !last.color) {
        // the line started with characters of unknown color
        Object.assign(last, { str: last.str + space + chars[i], w: x + w - last.x, color })
      } else {
        groups.push({ str: chars[i], x, w, color: color ?? '' })
      }
      x += w
    }
  }
  return groups.map(g => ({ ...g, color: g.color || '#000000' }))
}

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

/** Estimates the text color and the background color behind a run from the rendered page. */
export async function sampleColors(doc: PdfjsDoc, pageNumber: number, run: Pick<TextRun, 'x' | 'y' | 'w' | 'h' | 'baseline' | 'size'>) {
  if (!cached || cached.doc !== doc || cached.page !== pageNumber) {
    cached = { doc, page: pageNumber, canvas: await renderPageToCanvas(doc, pageNumber, SAMPLE_SCALE) }
  }
  const { canvas } = cached
  const x0 = Math.max(0, Math.floor((run.x - 2) * SAMPLE_SCALE))
  const y0 = Math.max(0, Math.floor((run.y - 1) * SAMPLE_SCALE))
  const w = Math.max(1, Math.min(canvas.width - x0, Math.ceil((run.w + 4) * SAMPLE_SCALE)))
  const h = Math.max(1, Math.min(canvas.height - y0, Math.ceil((run.h + 2) * SAMPLE_SCALE)))
  const data = canvas.getContext('2d')!.getImageData(x0, y0, w, h).data

  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > 1 && x < w - 2 && y > 1 && y < h - 2) continue
      const i = (y * w + x) * 4
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
      const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
      b.n++
      b.r += data[i]
      b.g += data[i + 1]
      b.b += data[i + 2]
      buckets.set(key, b)
    }
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0] ?? { n: 1, r: 255, g: 255, b: 255 }
  const bg = [top.r / top.n, top.g / top.n, top.b / top.n]

  // Text color: the most common clearly-not-background color in the body of the glyphs (baseline up to cap height).
  // Taking the pixels most unlike the background instead picks up a nearby black line, rule or underline,
  // which turned e.g. red text dark or black.
  const ix0 = Math.max(0, Math.floor(run.x * SAMPLE_SCALE) - x0)
  const ix1 = Math.min(w, Math.ceil((run.x + run.w) * SAMPLE_SCALE) - x0)
  const iy0 = Math.max(0, Math.floor((run.baseline - run.size * 0.85) * SAMPLE_SCALE) - y0)
  const iy1 = Math.min(h, Math.ceil((run.baseline + run.size * 0.05) * SAMPLE_SCALE) - y0)
  const buckets16 = new Map<number, number>()
  const exact = new Map<number, number>()
  const bucketOf = (c: number) => (((c >> 20) & 15) << 8) | (((c >> 12) & 15) << 4) | ((c >> 4) & 15)
  for (let y = iy0; y < iy1; y++) {
    for (let x = ix0; x < ix1; x++) {
      const i = (y * w + x) * 4
      if (Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) <= 60) continue
      const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
      exact.set(c, (exact.get(c) ?? 0) + 1)
      // anti-aliased edge pixels spread over many buckets, so fully covered ones (the true color) form the biggest
      buckets16.set(bucketOf(c), (buckets16.get(bucketOf(c)) ?? 0) + 1)
    }
  }
  const main = [...buckets16].sort((a, b) => b[1] - a[1])[0]?.[0]
  // within that bucket, the single most frequent color is the one the text was drawn with
  const best = main === undefined ? undefined : [...exact].filter(([c]) => bucketOf(c) === main).sort((a, b) => b[1] - a[1])[0][0]
  const text = best === undefined ? '#000000' : hex(best >> 16, (best >> 8) & 255, best & 255)
  return { text, bg: hex(bg[0], bg[1], bg[2]), ink: main === undefined ? 0 : buckets16.get(main)! }
}
