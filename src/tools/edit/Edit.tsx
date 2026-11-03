import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { ToolLayout } from '../../components/ToolLayout'
import { baseName, canvasToBytes, closePdf, downloadBlob, loadPdf, pickFiles, renderPageToCanvas, uid, type PageViewport, type PdfFile } from '../../lib/pdf'
import { STYLE_KEYS, defaultsFor, moveLayer, resizeEl, strokesFromAbs, strokesToAbs, type El, type Handle, type ImgData, type Kind, type LayerOp, type Point, type Tool } from './model'
import { baselineOffset, useFontRegistry, variantOf } from './fonts'
import { useHistory } from './useHistory'
import { colorGroups, getTextRuns, sampleColors, type TextRun } from './textRuns'
import { readForm, type FormState } from './form'
import { exportPdf } from './exportPdf'
import { ElementView } from './ElementView'
import { Toolbar } from './Toolbar'
import { TOOL_KEYS } from './toolList'
import { PropsPanel } from './PropsPanel'
import { LayersPanel } from './LayersPanel'
import { FormPanel } from './FormPanel'
import { SignatureDialog } from './SignatureDialog'
import { fetchLibraryFile, leaveEditor, notifyLibrary, readLibraryLink, saveLibraryVersion } from './libraryLink'

const DISPLAY_W = 820
const RENDER_SCALE = 2
// tools that stay active after drawing one item, since they're usually used repeatedly
const STICKY_TOOLS: Tool[] = ['whiteout', 'highlight', 'pen', 'edittext']

interface PageInfo {
  vp: PageViewport
  src: string
  runs: TextRun[]
}

async function imageToPng(file: Blob): Promise<ImgData> {
  const bmp = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  return { bytes: await canvasToBytes(canvas, 'image/png'), url: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height }
}

function startDrag(e: RPointerEvent, scale: number, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onUp?: () => void) {
  e.preventDefault()
  e.stopPropagation()
  const sx = e.clientX
  const sy = e.clientY
  const move = (ev: PointerEvent) => onMove((ev.clientX - sx) / scale, (ev.clientY - sy) / scale, ev)
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    onUp?.()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

const blurActive = () => (document.activeElement as HTMLElement | null)?.blur?.()

export default function Edit() {
  const [file, setFile] = useState<PdfFile | null>(null)
  const [pages, setPages] = useState<PageInfo[]>([])
  const [els, setEls, history] = useHistory<El[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [zoom, setZoomRaw] = useState(1)
  const fonts = useFontRegistry()
  const [form, setForm] = useState<FormState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<{ img: ImgData; label?: string } | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [ghost, setGhost] = useState<{ page: number; x: number; y: number } | null>(null)
  const clipboard = useRef<El | null>(null)
  const styleDefaults = useRef<Partial<Record<Kind, Partial<El>>>>({})
  const editorRef = useRef<HTMLDivElement>(null)
  const loadToken = useRef(0)
  const runsInFlight = useRef(new Set<string>())
  // set when opened from an ai-document client folder (#/edit?file=<id>)
  const [link] = useState(readLibraryLink)
  const savedEls = useRef<El[] | null>(null)
  const [libraryError, setLibraryError] = useState('')

  const selected = els.find(e => e.id === selectedId) ?? null
  // a text element's own font, plus the font for any characters it lacks
  const fontsOf = (el: El) => ({ fam: fonts.get(el.font), fallback: fonts.fallbackOf(el.font, el.text ?? '', el.fallbackFont) })
  const setZoom = (z: number) => setZoomRaw(Math.min(3, Math.max(0.3, Math.round(z * 100) / 100)))
  const scaleOf = (p: PageInfo) => (DISPLAY_W * zoom) / p.vp.width
  const usedRuns = new Set(els.filter(e => e.kind === 'text' && e.srcRun).map(e => e.srcRun))

  const flash = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(n => (n === msg ? null : n)), 3500)
  }

  const newEl = (kind: Kind, page: number, props: Partial<El>): El => ({
    id: uid(),
    page,
    kind,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    opacity: 1,
    ...defaultsFor(kind),
    ...styleDefaults.current[kind],
    ...props,
  })

  const updateEl = (id: string, patch: Partial<El>) => setEls(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)))
  const addEls = (...list: El[]) => {
    setEls(prev => [...prev, ...list])
    setSelectedId(list[list.length - 1].id)
  }
  const removeEl = (id: string) => {
    setEls(prev => prev.filter(e => e.id !== id))
    setSelectedId(s => (s === id ? null : s))
    setEditingId(s => (s === id ? null : s))
  }

  const changeSelected = (patch: Partial<El>) => {
    if (!selected) return
    updateEl(selected.id, patch)
    const style = Object.fromEntries(Object.entries(patch).filter(([k]) => (STYLE_KEYS as readonly string[]).includes(k)))
    if (Object.keys(style).length) styleDefaults.current[selected.kind] = { ...styleDefaults.current[selected.kind], ...style }
  }

  const duplicate = (el: El, offset = 12) =>
    addEls({ ...el, id: uid(), x: el.x + offset, y: el.y + offset, srcRun: undefined, locked: false, hidden: false })

  /** Page most visible in the viewport, and the center of its visible part in page coordinates. */
  const visibleSpot = () => {
    const nodes = editorRef.current?.querySelectorAll<HTMLElement>('.editor-page') ?? []
    let best = { page: 0, cx: 100, cy: 100, vis: -1 }
    nodes.forEach((n, i) => {
      const r = n.getBoundingClientRect()
      const top = Math.max(r.top, 0)
      const bottom = Math.min(r.bottom, window.innerHeight)
      if (bottom - top > best.vis && pages[i]) {
        const s = scaleOf(pages[i])
        best = { page: i, cx: r.width / 2 / s, cy: ((top + bottom) / 2 - r.top) / s, vis: bottom - top }
      }
    })
    return best
  }

  const imageSize = (img: ImgData, page: number, label?: string) => {
    const w = Math.min(label === 'Signature' ? 160 : 200, pages[page].vp.width / 2, img.w)
    return { w, h: (w * img.h) / img.w }
  }

  const placeImage = (img: ImgData, page: number, cx: number, cy: number, label?: string) => {
    const { w, h } = imageSize(img, page, label)
    addEls(newEl('image', page, { x: cx - w / 2, y: cy - h / 2, w, h, img, label }))
  }

  const startPlacing = (img: ImgData, label?: string) => {
    blurActive()
    setPending({ img, label })
    setTool('image')
    setEditingId(null)
    setSelectedId(null)
    flash(label === 'Signature' ? 'Click where you want to place the signature' : 'Click on a page to place the image')
  }

  const copyToAllPages = (el: El) =>
    setEls(prev => [
      ...prev,
      ...pages.flatMap((p, i) =>
        i === el.page
          ? []
          : [{ ...el, id: uid(), page: i, x: Math.min(el.x, p.vp.width - Math.abs(el.w)), y: Math.min(el.y, p.vp.height - Math.abs(el.h)), srcRun: undefined }],
      ),
    ])

  const docRef = useRef<PdfFile | null>(null)
  useEffect(
    () => () => {
      // stop background page rendering and free the pdf.js document when leaving the editor
      loadToken.current++
      closePdf(docRef.current)
    },
    [],
  )

  const load = async ([f]: File[]) => {
    if (els.length && !window.confirm('Open a different PDF? Your unsaved edits will be lost.')) return
    const token = ++loadToken.current
    const pdf = await loadPdf(f, { keepFontData: true })
    if (token !== loadToken.current) return closePdf(pdf)
    closePdf(docRef.current)
    docRef.current = pdf
    fonts.clearDocFonts()
    setFile(pdf)
    setPages([])
    history.reset([])
    setSelectedId(null)
    setEditingId(null)
    setPending(null)
    const formState = await readForm(pdf.bytes)
    if (token !== loadToken.current) return
    setForm(formState)
    const renderPage = async (n: number): Promise<PageInfo> => {
      const vp = (await pdf.doc.getPage(n)).getViewport({ scale: 1 })
      const canvas = await renderPageToCanvas(pdf.doc, n, (DISPLAY_W * RENDER_SCALE) / vp.width)
      const runs = await getTextRuns(pdf.doc, n, vp)
      return { vp, src: canvas.toDataURL('image/jpeg', 0.85), runs }
    }
    const list = [await renderPage(1)]
    if (token !== loadToken.current) return
    setPages([...list])
    // remaining pages render in the background so editing can start right away
    void (async () => {
      for (let n = 2; n <= pdf.pageCount; n++) {
        if (token !== loadToken.current) return
        const p = await renderPage(n)
        if (token !== loadToken.current) return
        list.push(p)
        setPages([...list])
      }
    })().catch(err => {
      // a newer load or leaving the editor cancels rendering of this document; only real failures matter
      if (token === loadToken.current) flash(`Couldn't render all pages: ${err instanceof Error ? err.message : err}`)
    })
  }

  const chooseTool = async (t: Tool) => {
    if (t === 'image') {
      const [img] = await pickFiles('image/png,image/jpeg,image/webp,image/gif', false)
      if (!img) return
      return startPlacing(await imageToPng(img))
    }
    blurActive()
    setTool(t)
    setEditingId(null)
    setSelectedId(null)
  }

  const replaceRun = async (page: number, run: TextRun, clickX: number) => {
    if (!file || runsInFlight.current.has(run.id)) return
    runsInFlight.current.add(run.id)
    try {
      await doReplaceRun(file, page, run, clickX)
    } finally {
      runsInFlight.current.delete(run.id)
    }
  }

  const doReplaceRun = async (file: PdfFile, page: number, run: TextRun, clickX: number) => {
    // prefer the PDF's own embedded font; keep a closest-match font for characters the (usually subset) embedded font lacks
    const fallback = fonts.match(run.pdfFontName, run.str, run.category)
    const own = run.docFont && fonts.supports(fonts.get(run.docFont), run.str) !== false ? run.docFont : null
    const fontKey = own ?? fallback
    const variant = variantOf(run.bold, run.italic)
    await fonts.load(fontKey, variant)
    // best-effort warm-up for the fallback font; a failure here must not become an unhandled rejection
    if (own) void fonts.load(fallback, variant).catch(() => {})
    const fam = fonts.get(fontKey)
    const size = Math.round(run.size * 10) / 10
    const { bg } = await sampleColors(file.doc, page + 1, run)
    // a line mixing colors (e.g. a red label before black text) becomes one text item per color
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = `${fonts.cssStyle(fam, run.bold, run.italic).fontWeight} 100px ${fam.css}, sans-serif`
    const groups = await colorGroups(file.doc, page + 1, run, ch => ctx.measureText(ch).width)
    const cover = newEl('whiteout', page, { x: run.x - 1, y: run.y, w: run.w + 2, h: run.h, fill: bg, opacity: 1, srcRun: run.id })
    const texts = groups.map(g =>
      newEl('text', page, {
        x: g.x,
        y: run.baseline - size * baselineOffset(fam, 1.2),
        text: g.str,
        size,
        font: fontKey,
        fallbackFont: fallback,
        bold: run.bold,
        italic: run.italic,
        underline: false,
        align: 'left',
        lineHeight: 1.2,
        color: g.color,
        opacity: g.opacity,
        srcRun: run.id,
      }),
    )
    const clicked = texts[Math.max(0, groups.findLastIndex(g => g.x <= clickX))]
    addEls(cover, ...texts)
    setSelectedId(clicked.id)
    setEditingId(clicked.id)
  }

  const onPageDown = (e: RPointerEvent<HTMLDivElement>, page: number, scale: number) => {
    if (e.button !== 0) return
    blurActive()
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / scale
    const y = (e.clientY - r.top) / scale

    if (tool === 'select' || tool === 'edittext') return setSelectedId(null)

    if (tool === 'text') {
      const size = styleDefaults.current.text?.size ?? 16
      const el = newEl('text', page, { x, y: y - size * 0.6, text: 'Text' })
      addEls(el)
      setEditingId(el.id)
      setTool('select')
      return
    }

    if (tool === 'image') {
      if (pending) placeImage(pending.img, page, x, y, pending.label)
      setPending(null)
      setGhost(null)
      setTool('select')
      return
    }

    if (tool === 'pen') {
      // consecutive strokes join the selected drawing, so a multi-stroke signature stays one item
      const existing = selected?.kind === 'pen' && selected.page === page ? selected : null
      const prev = existing ? strokesToAbs(existing) : []
      const stroke: Point[] = [[x, y]]
      const id = existing?.id ?? uid()
      if (!existing) addEls({ ...newEl('pen', page, strokesFromAbs([stroke])), id })
      startDrag(e, scale, (dx, dy) => {
        stroke.push([x + dx, y + dy])
        updateEl(id, strokesFromAbs([...prev, stroke]))
      })
      return
    }

    const kind = tool
    const el = newEl(kind, page, { x, y })
    addEls(el)
    let moved = false
    startDrag(
      e,
      scale,
      (dx, dy, ev) => {
        moved ||= Math.abs(dx) > 2 || Math.abs(dy) > 2
        if (kind === 'line' || kind === 'arrow') {
          if (ev.shiftKey) {
            const len = Math.hypot(dx, dy)
            const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
            dx = Math.cos(a) * len
            dy = Math.sin(a) * len
          }
          updateEl(el.id, { w: dx, h: dy })
        } else {
          if (ev.shiftKey) {
            const m = Math.max(Math.abs(dx), Math.abs(dy))
            dx = Math.sign(dx || 1) * m
            dy = Math.sign(dy || 1) * m
          }
          updateEl(el.id, { x: Math.min(x, x + dx), y: Math.min(y, y + dy), w: Math.abs(dx), h: Math.abs(dy) })
        }
      },
      () => {
        if (!moved) removeEl(el.id)
        if (!STICKY_TOOLS.includes(kind)) setTool('select')
      },
    )
  }

  const onElDown = (e: RPointerEvent, el: El, scale: number) => {
    if (e.button !== 0) return
    // a stray click on the box being edited (not its textarea, which stops propagation itself) must not
    // bubble up to the page and end the edit — clicking to place the cursor shouldn't deselect
    if (editingId === el.id) {
      e.stopPropagation()
      return
    }
    blurActive()
    const wasSelected = el.id === selectedId
    setSelectedId(el.id)
    // with Edit text active, clicking text that was already edited (only text is clickable then) types into it again
    if (tool === 'edittext') {
      e.preventDefault()
      e.stopPropagation()
      if (!el.locked) setEditingId(el.id)
      return
    }
    if (el.locked) return
    const start = { x: el.x, y: el.y }
    let moved = false
    startDrag(
      e,
      scale,
      (dx, dy, ev) => {
        // a click with a slightly shaky hand mustn't nudge the item
        moved ||= Math.hypot(dx, dy) * scale > 3
        if (!moved) return
        if (ev.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0
          else dx = 0
        }
        updateEl(el.id, { x: start.x + dx, y: start.y + dy })
      },
      () => {
        // clicking text that is already selected starts typing, like in slide editors
        if (!moved && wasSelected && el.kind === 'text') setEditingId(el.id)
      },
    )
  }

  const onHandleDown = (e: RPointerEvent, el: El, h: Handle, scale: number) => {
    const o = { ...el }
    startDrag(e, scale, (dx, dy) => updateEl(el.id, resizeEl(o, h, dx, dy)))
  }

  const pickFont = (key: string) => changeSelected({ font: key, fallbackFont: undefined })

  const uploadFont = async () => {
    const files = await pickFiles('.ttf,.otf,font/ttf,font/otf', true)
    if (!files.length) return
    try {
      const key = await fonts.addUploaded(files)
      if (key) {
        pickFont(key)
        flash(`Font "${fonts.get(key).label}" added`)
      }
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err))
    }
  }

  // load the faces needed to show text in its chosen style (cached after the first load)
  const requestedFaces = useRef(new Set<string>())
  useEffect(() => {
    for (const el of els) {
      if (el.kind !== 'text') continue
      const { fam, fallback } = fontsOf(el)
      for (const f of fallback ? [fam, fallback] : [fam]) {
        const v = fonts.pick(f, el.bold, el.italic).variant
        if (requestedFaces.current.has(`${f.key}:${v}`)) continue
        requestedFaces.current.add(`${f.key}:${v}`)
        fonts.load(f.key, v)?.catch(err => flash(`Couldn't load ${f.label}: ${err instanceof Error ? err.message : err}`))
      }
    }
  })

  const layerOp = (op: LayerOp) => selected && setEls(prev => moveLayer(prev, selected.id, op))

  const selectFromLayers = (id: string) => {
    setSelectedId(id)
    setTool('select')
    setTimeout(() => editorRef.current?.querySelector(`[data-el="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!file || signOpen || isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) history.redo()
        else history.undo()
      } else if (mod && k === 'y') {
        e.preventDefault()
        history.redo()
      } else if (mod && k === 'd' && selected) {
        e.preventDefault()
        duplicate(selected)
      } else if (mod && k === 'c' && selected) {
        clipboard.current = selected
      } else if (mod && (e.key === ']' || e.key === '[') && selected) {
        e.preventDefault()
        layerOp(e.key === ']' ? (e.shiftKey ? 'front' : 'up') : e.shiftKey ? 'back' : 'down')
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !selected.locked) {
        e.preventDefault()
        removeEl(selected.id)
      } else if (e.key === 'Escape') {
        setEditingId(null)
        setSelectedId(null)
        setTool('select')
        setPending(null)
        setGhost(null)
      } else if (e.key === 'Enter' && selected?.kind === 'text' && !selected.locked) {
        e.preventDefault()
        setEditingId(selected.id)
      } else if (e.key.startsWith('Arrow') && selected && !selected.locked) {
        e.preventDefault()
        const d = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
        updateEl(selected.id, { x: selected.x + dx, y: selected.y + dy })
      } else if (!mod && !e.altKey && k === 's') {
        setSignOpen(true)
      } else if (!mod && !e.altKey && TOOL_KEYS[k]) {
        void chooseTool(TOOL_KEYS[k])
      }
    }
    const onPaste = async (e: ClipboardEvent) => {
      if (!file || signOpen || isTyping(e.target)) return
      const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'))
      const blob = item?.getAsFile()
      if (blob) {
        e.preventDefault()
        const spot = visibleSpot()
        placeImage(await imageToPng(blob), spot.page, spot.cx, spot.cy)
      } else if (clipboard.current) {
        e.preventDefault()
        duplicate(clipboard.current, 16)
        clipboard.current = { ...clipboard.current, x: clipboard.current.x + 16, y: clipboard.current.y + 16 }
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
    }
  })

  const fitWidth = () => {
    const w = editorRef.current?.parentElement?.clientWidth
    if (w) setZoom((w - 64) / DISPLAY_W)
  }

  const save = async (download = false) => {
    if (!file) return
    blurActive()
    const out = await exportPdf(file.bytes, els, pages.map(p => p.vp), form)
    if (link && !download) {
      await saveLibraryVersion(link, out, file.name)
      savedEls.current = els
      flash('Saved to the client folder as a new version')
    } else {
      downloadBlob(out, `${baseName(file.name)}-edited.pdf`)
    }
  }

  // opened from an ai-document client folder: load that file instead of asking for one
  useEffect(() => {
    if (!link) return
    let cancelled = false
    fetchLibraryFile(link)
      .then(f => (cancelled ? undefined : load([f])))
      .catch(e => {
        if (!cancelled) setLibraryError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
    // runs once for the file in the URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link])

  // tell ai-document whether closing would lose edits
  const dirty = !!link && (savedEls.current ? els !== savedEls.current : els.length > 0)
  useEffect(() => {
    if (link) notifyLibrary(link, { type: 'library:dirty', dirty })
  }, [link, dirty])

  const allLoaded = !!file && pages.length === file.pageCount

  if (link && !file) {
    return (
      <section className="tool-hero">
        <h1>Edit PDF</h1>
        {libraryError ? <p className="error">{libraryError}</p> : <div className="spinner" style={{ margin: '24px auto' }} />}
        {!libraryError && <p className="subtitle">Opening the document from the client folder…</p>}
      </section>
    )
  }

  return (
    <ToolLayout
      title="Edit PDF"
      subtitle="Edit existing text, add text, shapes, drawings, images and signatures, fill forms — all in your browser."
      accept="application/pdf,.pdf"
      multiple={false}
      selectLabel="Select PDF file"
      hasFiles={!!file}
      onFiles={load}
      actionLabel={allLoaded ? (link ? 'Save to folder' : 'Save PDF') : `Loading pages ${pages.length}/${file?.pageCount ?? 0}…`}
      actionDisabled={!allLoaded}
      onAction={() => save()}
      sidebar={
        <>
          {link && (
            <p className="info">
              Editing <b>{file?.name}</b> from a client folder. Saving keeps the previous version in its history.{' '}
              <button className="link-btn" disabled={!allLoaded} onClick={() => void save(true).catch(e => flash(String(e)))}>
                Download a copy instead
              </button>
              {!link.embedded && (
                <>
                  {' · '}
                  <button className="link-btn" onClick={() => leaveEditor(link)}>
                    Back to folder
                  </button>
                </>
              )}
            </p>
          )}
          {selected ? (
            <PropsPanel
              el={selected}
              onPickFont={pickFont}
              onChange={changeSelected}
              onUploadFont={uploadFont}
              onDuplicate={() => duplicate(selected)}
              onDelete={() => removeEl(selected.id)}
              onLayer={layerOp}
              onCopyToAllPages={allLoaded && pages.length > 1 ? () => copyToAllPages(selected) : undefined}
            />
          ) : (
            <p className="hint">
              Pick a tool from the toolbar. Click an item to select it, drag to move, drag corners to resize. Shift constrains, arrow keys
              nudge, Ctrl/⌘+Z undoes. Paste an image to place it.
            </p>
          )}
          <LayersPanel
            els={els}
            selectedId={selectedId}
            onSelect={selectFromLayers}
            onChange={setEls}
            onToggle={(id, key) => setEls(prev => prev.map(e => (e.id === id ? { ...e, [key]: !e[key] } : e)))}
          />
          {form && <FormPanel form={form} onChange={setForm} />}
        </>
      }
    >
      <Toolbar
        tool={tool}
        onTool={chooseTool}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
        zoom={zoom}
        onZoom={setZoom}
        onFit={fitWidth}
        onSign={() => setSignOpen(true)}
      />
      {/* floats over the page, so a notice appearing or going away never shifts what's under the pointer */}
      <div className="editor-notices">
        {notice && <div className="editor-notice">{notice}</div>}
        {tool === 'edittext' && !notice && <div className="editor-notice subtle">Click any text in the document to edit it.</div>}
      </div>
      <div ref={editorRef} className={`editor tool-${tool}`}>
        {pages.map((p, i) => {
          const scale = scaleOf(p)
          return (
            <div key={i} className="editor-page-wrap">
              <div
                className="editor-page"
                style={{ width: DISPLAY_W * zoom, height: p.vp.height * scale }}
                onPointerDown={e => onPageDown(e, i, scale)}
                onPointerMove={e => {
                  if (tool !== 'image' || !pending) return
                  const r = e.currentTarget.getBoundingClientRect()
                  setGhost({ page: i, x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale })
                }}
                onPointerLeave={() => setGhost(null)}
              >
                <img src={p.src} alt="" draggable={false} />
                {tool === 'image' && pending && ghost?.page === i && (() => {
                  // preview of the image following the cursor until it's placed
                  const { w, h } = imageSize(pending.img, i, pending.label)
                  return (
                    <img
                      className="place-ghost"
                      src={pending.img.url}
                      alt=""
                      style={{ left: (ghost.x - w / 2) * scale, top: (ghost.y - h / 2) * scale, width: w * scale, height: h * scale }}
                    />
                  )
                })()}
                {tool === 'edittext' &&
                  p.runs
                    .filter(run => !usedRuns.has(run.id))
                    .map(run => (
                      <div
                        key={run.id}
                        className="text-run"
                        title={run.str}
                        style={{ left: run.x * scale, top: run.y * scale, width: run.w * scale, height: run.h * scale }}
                        onPointerDown={e => {
                          e.stopPropagation()
                          e.preventDefault()
                          void replaceRun(i, run, (e.clientX - e.currentTarget.parentElement!.getBoundingClientRect().left) / scale)
                        }}
                      />
                    ))}
                {els
                  .filter(el => el.page === i && !el.hidden)
                  .map(el => (
                    <ElementView
                      key={el.id}
                      el={el}
                      scale={scale}
                      selected={el.id === selectedId}
                      editing={el.id === editingId}
                      font={el.kind === 'text' ? (({ fam, fallback }) => fonts.cssStyle(fam, el.bold, el.italic, fallback))(fontsOf(el)) : {}}
                      onPointerDown={(e, el) => onElDown(e, el, scale)}
                      onHandleDown={(e, el, h) => onHandleDown(e, el, h, scale)}
                      onDoubleClick={el => el.kind === 'text' && !el.locked && setEditingId(el.id)}
                      onTextChange={(el, text) => updateEl(el.id, { text })}
                      onEditEnd={el => {
                        setEditingId(id => (id === el.id ? null : id))
                        setEls(prev => prev.filter(x => x.id !== el.id || !!x.text?.trim()))
                      }}
                    />
                  ))}
              </div>
              <div className="page-num">
                {i + 1} / {file?.pageCount}
              </div>
            </div>
          )
        })}
      </div>
      {signOpen && (
        <SignatureDialog
          onClose={() => setSignOpen(false)}
          onDone={img => {
            setSignOpen(false)
            startPlacing(img, 'Signature')
          }}
        />
      )}
    </ToolLayout>
  )
}
