import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { canvasToBytes, pickFiles, uid } from '../../lib/pdf'
import { fontRegistry } from './fonts'
import type { ImgData } from './model'
import './signature.css'

type Tab = 'draw' | 'type' | 'upload'

interface Saved {
  id: string
  url: string
}

const STORE_KEY = 'pdftools.signatures'
const COLORS = ['#000000', '#1a3fb8', '#c0161a']
const SCRIPT_FONTS = ['lib:great-vibes', 'lib:dancing-script', 'lib:sacramento', 'lib:homemade-apple', 'lib:caveat', 'lib:pacifico']
// signatures are rasterized at this multiple of their on-page size so they stay crisp in print
const DENSITY = 3

const loadSaved = (): Saved[] => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]')
  } catch {
    return []
  }
}

/** Crops a canvas to its non-transparent pixels. */
function trim(src: HTMLCanvasElement, pad = 6) {
  const ctx = src.getContext('2d')!
  const { data, width, height } = ctx.getImageData(0, 0, src.width, src.height)
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(width - 1, x1 + pad)
  y1 = Math.min(height - 1, y1 + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1
  out.height = y1 - y0 + 1
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

async function toImgData(canvas: HTMLCanvasElement): Promise<ImgData> {
  return { bytes: await canvasToBytes(canvas, 'image/png'), url: canvas.toDataURL('image/png'), w: canvas.width / DENSITY, h: canvas.height / DENSITY }
}

// saved signatures live in localStorage (~5 MB), so keep a smaller copy there
const STORED_MAX_WIDTH = 900

function storageCopy(canvas: HTMLCanvasElement) {
  if (canvas.width <= STORED_MAX_WIDTH) return canvas.toDataURL('image/png')
  const c = document.createElement('canvas')
  c.width = STORED_MAX_WIDTH
  c.height = Math.round((canvas.height * STORED_MAX_WIDTH) / canvas.width)
  c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}

async function urlToImgData(url: string): Promise<ImgData> {
  const img = new Image()
  img.src = url
  await img.decode()
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  return { bytes, url, w: img.naturalWidth / DENSITY, h: img.naturalHeight / DENSITY }
}

type Point = { x: number; y: number; w: number }

function DrawPad({ color, thickness, onChange }: { color: string; thickness: number; onChange: (c: HTMLCanvasElement | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Point[][]>([])
  const [count, setCount] = useState(0)

  const redraw = () => {
    const c = ref.current!
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of strokes.current) {
      if (s.length === 1) {
        ctx.beginPath()
        ctx.arc(s[0].x, s[0].y, s[0].w / 2, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      // smooth curve through midpoints, with width following pen speed
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1]
        const b = s[i]
        const prevMid = i > 1 ? { x: (s[i - 2].x + a.x) / 2, y: (s[i - 2].y + a.y) / 2 } : a
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        ctx.lineWidth = (a.w + b.w) / 2
        ctx.beginPath()
        ctx.moveTo(prevMid.x, prevMid.y)
        ctx.quadraticCurveTo(a.x, a.y, mid.x, mid.y)
        ctx.stroke()
      }
    }
    onChange(strokes.current.length ? c : null)
  }

  useEffect(redraw, [color, thickness, count, onChange])

  const down = (e: RPointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!
    c.setPointerCapture(e.pointerId)
    const r = c.getBoundingClientRect()
    const sx = c.width / r.width
    const base = thickness * DENSITY
    const stroke: Point[] = [{ x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sx, w: base }]
    strokes.current.push(stroke)
    let last = { t: performance.now(), x: e.clientX, y: e.clientY }
    const move = (ev: PointerEvent) => {
      const now = performance.now()
      const speed = Math.hypot(ev.clientX - last.x, ev.clientY - last.y) / Math.max(1, now - last.t)
      last = { t: now, x: ev.clientX, y: ev.clientY }
      const prevW = stroke[stroke.length - 1].w
      // faster strokes get thinner, like a real pen; pressure is used when the device reports it
      const pressure = ev.pressure && ev.pointerType === 'pen' ? 0.5 + ev.pressure : 1
      const target = base * pressure * Math.max(0.45, Math.min(1.3, 1.25 - speed * 0.35))
      stroke.push({ x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sx, w: prevW * 0.7 + target * 0.3 })
      redraw()
    }
    const up = () => {
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('pointercancel', up)
      setCount(n => n + 1)
    }
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    // an interrupted touch/stylus gesture ends the stroke instead of leaving the pen "down"
    c.addEventListener('pointercancel', up)
    redraw()
  }

  return (
    <div className="sig-pad-wrap">
      <canvas ref={ref} className="sig-pad" width={560 * DENSITY} height={200 * DENSITY} onPointerDown={down} />
      <div className="sig-pad-line">Sign above the line</div>
      <div className="sig-pad-actions">
        <button
          className="btn-secondary"
          disabled={!count}
          onClick={() => {
            strokes.current.pop()
            setCount(n => n + 1)
          }}
        >
          Undo stroke
        </button>
        <button
          className="btn-secondary"
          disabled={!count}
          onClick={() => {
            strokes.current = []
            setCount(n => n + 1)
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}

function renderTyped(text: string, css: string, color: string) {
  const size = 64 * DENSITY
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  ctx.font = `${size}px ${css}`
  c.width = Math.ceil(ctx.measureText(text).width + size)
  c.height = Math.ceil(size * 2)
  ctx.font = `${size}px ${css}`
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, size / 2, c.height / 2)
  return trim(c)
}

async function uploadedSignature(file: File, removeBg: boolean) {
  const bmp = await createImageBitmap(file)
  const c = document.createElement('canvas')
  // keep a sensible resolution for signatures photographed on a phone
  const scale = Math.min(1, 1800 / bmp.width)
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  if (removeBg) {
    const img = ctx.getImageData(0, 0, c.width, c.height)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      // paper becomes transparent; ink keeps a soft edge
      const a = Math.max(0, Math.min(1, (215 - lum) / 70))
      d[i + 3] = Math.round(d[i + 3] * a)
    }
    ctx.putImageData(img, 0, 0)
  }
  return trim(c, 4)
}

export function SignatureDialog({ onClose, onDone }: { onClose: () => void; onDone: (img: ImgData) => void }) {
  const [tab, setTab] = useState<Tab>('draw')
  const [color, setColor] = useState(COLORS[0])
  const [thickness, setThickness] = useState(2.5)
  const [drawn, setDrawn] = useState<HTMLCanvasElement | null>(null)
  const [name, setName] = useState('')
  const [typedFont, setTypedFont] = useState(SCRIPT_FONTS[0])
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadCanvas, setUploadCanvas] = useState<HTMLCanvasElement | null>(null)
  const [removeBg, setRemoveBg] = useState(true)
  const [save, setSave] = useState(true)
  const [saved, setSaved] = useState<Saved[]>(loadSaved)
  const [, setFontsReady] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    Promise.all(SCRIPT_FONTS.map(k => fontRegistry.load(k)))
      .then(() => setFontsReady(n => n + 1))
      .catch(() => setError('Some handwriting fonts could not be loaded.'))
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCloseRef.current()
    }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [])

  useEffect(() => {
    if (!uploadFile) return
    let cancelled = false
    uploadedSignature(uploadFile, removeBg)
      .then(c => !cancelled && setUploadCanvas(c))
      .catch(() => !cancelled && setError(`"${uploadFile.name}" couldn't be read as an image. Try a JPG or PNG.`))
    // a newer file or toggle supersedes this result
    return () => {
      cancelled = true
    }
  }, [uploadFile, removeBg])

  const persist = (list: Saved[]) => {
    setSaved(list)
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list))
    } catch {
      setError('Browser storage is full, so this signature is only kept until you close the page. Delete some saved signatures.')
    }
  }

  const result = async () => {
    if (tab === 'draw') return drawn ? trim(drawn) : null
    if (tab === 'type') {
      if (!name.trim()) return null
      await fontRegistry.load(typedFont)
      return renderTyped(name.trim(), fontRegistry.get(typedFont).css, color)
    }
    return uploadCanvas
  }

  const finish = async () => {
    if (busy) return
    setBusy(true)
    try {
      const canvas = await result()
      if (!canvas) return
      const img = await toImgData(canvas)
      if (save) persist([{ id: uid(), url: storageCopy(canvas) }, ...saved].slice(0, 12))
      onDone(img)
    } finally {
      setBusy(false)
    }
  }

  const ready = !busy && (tab === 'draw' ? !!drawn : tab === 'type' ? !!name.trim() : !!uploadCanvas)

  return (
    <div className="modal-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal sig-modal" role="dialog" aria-label="Create signature">
        <div className="modal-head">
          <h2>Insert signature</h2>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            ✕
          </button>
        </div>

        {saved.length > 0 && (
          <div className="sig-saved">
            <div className="sig-label">My signatures</div>
            <div className="sig-saved-list">
              {saved.map(s => (
                <div key={s.id} className="sig-saved-item">
                  <button title="Use this signature" onClick={async () => onDone(await urlToImgData(s.url))}>
                    <img src={s.url} alt="Saved signature" />
                  </button>
                  <button className="sig-del" title="Delete" onClick={() => persist(saved.filter(x => x.id !== s.id))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="segmented">
          {(['draw', 'type', 'upload'] as Tab[]).map(t => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {{ draw: 'Draw', type: 'Type', upload: 'Upload image' }[t]}
            </button>
          ))}
        </div>

        {tab !== 'upload' && (
          <div className="sig-options">
            <div className="sig-colors">
              {COLORS.map(c => (
                <button key={c} className={`sig-color${c === color ? ' on' : ''}`} style={{ background: c }} title={c} onClick={() => setColor(c)} />
              ))}
            </div>
            {tab === 'draw' && (
              <label className="sig-thickness">
                Pen
                <input type="range" min={1} max={6} step={0.5} value={thickness} onChange={e => setThickness(+e.target.value)} />
              </label>
            )}
          </div>
        )}

        {tab === 'draw' && <DrawPad color={color} thickness={thickness} onChange={setDrawn} />}

        {tab === 'type' && (
          <div className="sig-type">
            <input autoFocus className="sig-name" placeholder="Type your name" value={name} onChange={e => setName(e.target.value)} />
            <div className="sig-font-grid">
              {SCRIPT_FONTS.map(k => (
                <button key={k} className={`sig-font${k === typedFont ? ' on' : ''}`} style={{ fontFamily: fontRegistry.get(k).css, color }} onClick={() => setTypedFont(k)}>
                  {name.trim() || 'Your Name'}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'upload' && (
          <div className="sig-upload">
            {uploadCanvas ? (
              <div className="sig-preview">
                <img src={uploadCanvas.toDataURL()} alt="Uploaded signature" />
              </div>
            ) : (
              <p className="hint">Upload a photo or scan of your signature on white paper.</p>
            )}
            <div className="btn-row">
              <button
                className="btn-secondary"
                onClick={async () => {
                  const [f] = await pickFiles('image/*', false)
                  if (f) {
                    setError(null)
                    setUploadFile(f)
                  }
                }}
              >
                {uploadFile ? 'Choose another image' : 'Choose image…'}
              </button>
            </div>
            <label className="check">
              <input type="checkbox" checked={removeBg} onChange={e => setRemoveBg(e.target.checked)} />
              Remove white background
            </label>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="modal-foot">
          <label className="check">
            <input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} />
            Save to My signatures (kept in this browser only)
          </label>
          <button className="btn-action small" disabled={!ready} onClick={finish}>
            Insert signature
          </button>
        </div>
      </div>
    </div>
  )
}
