export type Kind = 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'pen' | 'image' | 'whiteout' | 'highlight'
export type Tool = 'select' | 'edittext' | Kind
export type Align = 'left' | 'center' | 'right'
export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end'
export type LayerOp = 'front' | 'up' | 'down' | 'back'
export type Point = [number, number]

export interface ImgData {
  bytes: Uint8Array
  url: string
  w: number
  h: number
}

/** All geometry is in PDF points relative to the page's top-left corner as displayed (pdf.js viewport at scale 1). */
export interface El {
  id: string
  page: number
  kind: Kind
  x: number
  y: number
  /** For line/arrow, w/h are the signed delta from start to end point. */
  w: number
  h: number
  opacity: number
  hidden?: boolean
  locked?: boolean
  /** Shown in the layers panel instead of the kind, e.g. "Signature" */
  label?: string
  text?: string
  size?: number
  font?: string
  /** Used when `font` can't draw some characters (e.g. a subset font embedded in the PDF). */
  fallbackFont?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  align?: Align
  lineHeight?: number
  color?: string
  fill?: string | null
  stroke?: string
  strokeWidth?: number
  /** Pen strokes, normalized to 0..1 within the bounding box. */
  strokes?: Point[][]
  img?: ImgData
  /** Id of the original PDF text run this element replaces. */
  srcRun?: string
}

export const STYLE_KEYS = ['size', 'font', 'bold', 'italic', 'underline', 'align', 'lineHeight', 'color', 'fill', 'stroke', 'strokeWidth', 'opacity'] as const

export const KIND_LABEL: Record<Kind, string> = {
  text: 'Text',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  pen: 'Drawing',
  image: 'Image',
  whiteout: 'Whiteout',
  highlight: 'Highlight',
}

export function defaultsFor(kind: Kind): Partial<El> {
  switch (kind) {
    case 'text':
      return { size: 16, font: 'helvetica', bold: false, italic: false, underline: false, align: 'left', lineHeight: 1.2, color: '#000000', opacity: 1 }
    case 'rect':
    case 'ellipse':
      return { fill: null, stroke: '#e5322d', strokeWidth: 2, opacity: 1 }
    case 'line':
      return { stroke: '#000000', strokeWidth: 2, opacity: 1 }
    case 'arrow':
      return { stroke: '#e5322d', strokeWidth: 3, opacity: 1 }
    case 'pen':
      return { stroke: '#1a3fb8', strokeWidth: 2.5, opacity: 1 }
    case 'whiteout':
      return { fill: '#ffffff', opacity: 1 }
    case 'highlight':
      return { fill: '#ffeb3b', opacity: 0.5 }
    case 'image':
      return { opacity: 1 }
  }
}

export const isLinear = (k: Kind) => k === 'line' || k === 'arrow'

export function bbox(el: El) {
  return {
    left: Math.min(el.x, el.x + el.w),
    top: Math.min(el.y, el.y + el.h),
    width: Math.abs(el.w),
    height: Math.abs(el.h),
  }
}

export function layerLabel(el: El) {
  if (el.kind === 'text') {
    const t = (el.text ?? '').replace(/\s+/g, ' ').trim()
    return t ? `“${t.length > 28 ? t.slice(0, 28) + '…' : t}”` : 'Empty text'
  }
  return el.label ?? KIND_LABEL[el.kind]
}

const MIN = 4

export function resizeEl(o: El, handle: Handle, dx: number, dy: number): Partial<El> {
  if (handle === 'start') return { x: o.x + dx, y: o.y + dy, w: o.w - dx, h: o.h - dy }
  if (handle === 'end') return { w: o.w + dx, h: o.h + dy }
  const west = handle.includes('w')
  const north = handle.includes('n')
  let left = o.x
  let top = o.y
  let right = o.x + o.w
  let bottom = o.y + o.h
  if (west) left = Math.min(left + dx, right - MIN)
  else right = Math.max(right + dx, left + MIN)
  if (north) top = Math.min(top + dy, bottom - MIN)
  else bottom = Math.max(bottom + dy, top + MIN)
  if (o.kind === 'image') {
    const h = (right - left) * (o.h / o.w)
    if (north) top = bottom - h
    else bottom = top + h
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function moveLayer(els: El[], id: string, op: LayerOp): El[] {
  const el = els.find(e => e.id === id)
  if (!el) return els
  const pageEls = els.filter(e => e.page === el.page)
  const idx = pageEls.indexOf(el)
  const last = pageEls.length - 1
  const to = op === 'front' ? last : op === 'back' ? 0 : op === 'up' ? Math.min(last, idx + 1) : Math.max(0, idx - 1)
  pageEls.splice(idx, 1)
  pageEls.splice(to, 0, el)
  return [...els.filter(e => e.page !== el.page), ...pageEls]
}

export function strokesToAbs(el: El): Point[][] {
  return (el.strokes ?? []).map(s => s.map(([nx, ny]) => [el.x + nx * el.w, el.y + ny * el.h] as Point))
}

export function strokesFromAbs(strokes: Point[][]) {
  const pts = strokes.flat()
  const minX = Math.min(...pts.map(p => p[0]))
  const minY = Math.min(...pts.map(p => p[1]))
  const w = Math.max(1, Math.max(...pts.map(p => p[0])) - minX)
  const h = Math.max(1, Math.max(...pts.map(p => p[1])) - minY)
  return { x: minX, y: minY, w, h, strokes: strokes.map(s => s.map(([px, py]) => [(px - minX) / w, (py - minY) / h] as Point)) }
}

/** Arrow shaft end and head triangle, in the same coordinate space as the inputs. */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, width: number) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  const ux = (x2 - x1) / len
  const uy = (y2 - y1) / len
  const head = Math.min(len, Math.max(10, width * 4))
  const bx = x2 - ux * head
  const by = y2 - uy * head
  const half = head * 0.5
  return {
    base: [bx, by] as Point,
    tri: [[x2, y2], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]] as Point[],
  }
}

export const hexToRgb01 = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
