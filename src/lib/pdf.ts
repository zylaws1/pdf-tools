// legacy build: includes polyfills for browsers without the newest JS features (e.g. Uint8Array.toHex)
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { zipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PdfjsDoc = pdfjs.PDFDocumentProxy
export type PageViewport = pdfjs.PageViewport

export interface PdfFile {
  id: string
  name: string
  bytes: Uint8Array
  doc: PdfjsDoc
  pageCount: number
}

export const uid = () => Math.random().toString(36).slice(2, 10)

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

/** Frees a document's memory in pdf.js (and its worker). Safe to call more than once. */
export const closePdf = (f?: PdfFile | null) => {
  if (f) void f.doc.loadingTask.destroy()
}

/** keepFontData retains embedded font files after rendering so they can be reused for editing. */
export async function loadPdf(file: File, { keepFontData = false } = {}): Promise<PdfFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // pdf.js transfers the buffer to its worker, so give it a copy
  const task = pdfjs.getDocument({ data: bytes.slice(), fontExtraProperties: keepFontData })
  try {
    const doc = await task.promise
    return { id: uid(), name: file.name, bytes, doc, pageCount: doc.numPages }
  } catch (e) {
    void task.destroy()
    if (e instanceof Error && e.name === 'PasswordException') throw new Error(`"${file.name}" is password-protected. Remove the password first, then try again.`)
    if (e instanceof Error && e.name === 'InvalidPDFException') throw new Error(`"${file.name}" is not a valid PDF file.`)
    throw e
  }
}

/** Opens a PDF for modification, refusing encrypted files (pdf-lib would copy their encrypted content as garbage). */
export async function openForWriting(bytes: Uint8Array, name?: string) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  if (doc.isEncrypted) throw new Error(`${name ? `"${name}"` : "This PDF"} is encrypted, so it can't be modified. Remove its protection (e.g. print to PDF) and try again.`)
  return doc
}

export async function renderPageToCanvas(doc: PdfjsDoc, pageNumber: number, scale: number) {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  return canvas
}

export async function renderThumb(doc: PdfjsDoc, pageNumber: number, width = 180) {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = (width * Math.min(2, window.devicePixelRatio || 1)) / base.width
  const canvas = await renderPageToCanvas(doc, pageNumber, scale)
  return canvas.toDataURL('image/jpeg', 0.8)
}

export function downloadBlob(data: Uint8Array | Blob, filename: string, type = 'application/pdf') {
  const blob = data instanceof Blob ? data : new Blob([data as Uint8Array<ArrayBuffer>], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function downloadMany(files: { name: string; data: Uint8Array }[], zipName: string, type?: string) {
  if (files.length === 1) return downloadBlob(files[0].data, files[0].name, type)
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) {
    let name = f.name
    for (let i = 2; entries[name]; i++) name = f.name.replace(/(\.[^.]+)$/, `-${i}$1`)
    entries[name] = f.data
  }
  downloadBlob(zipSync(entries, { level: 0 }), zipName, 'application/zip')
}

export function canvasToBytes(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Uint8Array>((resolve, reject) =>
    canvas.toBlob(
      b => (b ? b.arrayBuffer().then(buf => resolve(new Uint8Array(buf))) : reject(new Error('Canvas export failed'))),
      type,
      quality,
    ),
  )
}

export function pickFiles(accept: string, multiple: boolean) {
  return new Promise<File[]>(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

export function matchesAccept(file: File, accept: string) {
  return accept.split(',').some(a => {
    a = a.trim().toLowerCase()
    if (a.startsWith('.')) return file.name.toLowerCase().endsWith(a)
    if (a.endsWith('/*')) return file.type.startsWith(a.slice(0, -1))
    return file.type === a
  })
}

/** Parses "1-3, 5, 8-" into 1-based page groups; throws on invalid input. */
export function parseRanges(input: string, pageCount: number): number[][] {
  const groups: number[][] = []
  for (const part of input.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*(-)?\s*(\d+)?$/)
    if (!m || (!m[1] && !m[3])) throw new Error(`"${part}" is not a valid range`)
    const start = m[1] ? +m[1] : 1
    const end = m[2] ? (m[3] ? +m[3] : pageCount) : start
    if (start > end) throw new Error(`"${part}" starts after it ends — write it as ${end}-${start}`)
    if (start < 1 || end > pageCount) throw new Error(`"${part}" is outside 1-${pageCount}`)
    groups.push(Array.from({ length: end - start + 1 }, (_, i) => start + i))
  }
  if (!groups.length) throw new Error('Enter at least one page range')
  return groups
}
