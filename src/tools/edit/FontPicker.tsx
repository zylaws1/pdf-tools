import { useEffect, useRef, useState } from 'react'
import { useFontRegistry, type FontFamily } from './fonts'

const GROUPS: { id: string; title: string }[] = [
  { id: 'document', title: 'In this PDF' },
  { id: 'standard', title: 'Standard PDF fonts · smallest files, Latin only' },
  { id: 'lib-sans', title: 'Sans serif' },
  { id: 'lib-serif', title: 'Serif' },
  { id: 'lib-mono', title: 'Monospace' },
  { id: 'lib-script', title: 'Handwriting & signatures' },
  { id: 'uploaded', title: 'Uploaded' },
  { id: 'system', title: 'On this computer' },
]

const groupOf = (f: FontFamily) => (f.group === 'library' ? `lib-${f.category}` : f.group)

function Item({ f, selected, onPick }: { f: FontFamily; selected: boolean; onPick: (key: string) => void }) {
  const fonts = useFontRegistry()
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (f.group !== 'library' || f.glyphs) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        fonts.load(f.key)?.catch(() => {})
        io.disconnect()
      }
    })
    io.observe(ref.current!)
    return () => io.disconnect()
  }, [f, fonts])
  return (
    <button ref={ref} className={`font-item${selected ? ' selected' : ''}`} style={{ fontFamily: `${f.css}, sans-serif` }} onClick={() => onPick(f.key)} title={f.label}>
      {f.label}
    </button>
  )
}

export function FontPicker({ value, onPick, onUpload }: { value: string; onPick: (key: string) => void; onUpload: () => void }) {
  const fonts = useFontRegistry()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = fonts.get(value)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    // capture phase, so Escape closes only the picker and doesn't also deselect the item in the editor
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])

  const needle = q.trim().toLowerCase().replace(/\s+/g, '')
  const labelKey = (f: FontFamily) => f.label.toLowerCase().replace(/\s+/g, '')
  const all = fonts.list().filter(f => !needle || labelKey(f).includes(needle) || f.aliases.some(a => a.includes(needle)))
  // when searching, fonts whose own name matches beat look-alikes that only match by alias
  const best = needle
    ? all
        .filter(f => labelKey(f).includes(needle))
        .sort((a, b) => Number(!labelKey(a).startsWith(needle)) - Number(!labelKey(b).startsWith(needle)) || labelKey(a).length - labelKey(b).length)
        .slice(0, 6)
    : []
  const first = best[0] ?? all[0]

  const pick = async (key: string) => {
    setBusy(true)
    setError(null)
    try {
      await fonts.load(key)
      onPick(key)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const loadSystem = async () => {
    setError(null)
    try {
      await fonts.addSystemFonts()
    } catch (e) {
      setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Permission to read installed fonts was denied.' : String(e))
    }
  }

  return (
    <div className="font-picker" ref={root}>
      <button className="font-picker-btn" style={{ fontFamily: `${current.css}, sans-serif` }} onClick={() => setOpen(o => !o)}>
        <span>{current.label}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="font-pop">
          <input
            autoFocus
            className="font-search"
            placeholder="Search fonts, e.g. Calibri, Times, Garamond…"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && first) void pick(first.key)
            }}
          />
          <div className="font-list">
            {busy && <div className="font-note">Loading font…</div>}
            {error && <div className="font-note error">{error}</div>}
            {best.length > 0 && (
              <div className="font-group">
                <div className="font-group-title">Best matches</div>
                {best.map(f => (
                  <Item key={f.key} f={f} selected={f.key === value} onPick={k => void pick(k)} />
                ))}
              </div>
            )}
            {GROUPS.map(g => {
              const items = all.filter(f => groupOf(f) === g.id)
              const extra =
                g.id === 'system' ? (
                  fonts.systemSupported ? (
                    !fonts.systemLoaded && (
                      <button className="font-action" onClick={loadSystem}>
                        Show fonts installed on this computer…
                      </button>
                    )
                  ) : (
                    <div className="font-note">Open this page in Chrome or Edge to use installed fonts.</div>
                  )
                ) : g.id === 'uploaded' ? (
                  <button
                    className="font-action"
                    onClick={() => {
                      setOpen(false)
                      onUpload()
                    }}
                  >
                    Upload font files (.ttf / .otf)…
                  </button>
                ) : null
              if (!items.length && !extra) return null
              return (
                <div key={g.id} className="font-group">
                  <div className="font-group-title">
                    {g.title} {items.length > 0 && <span className="muted">{items.length}</span>}
                  </div>
                  {items.map(f => (
                    <Item key={f.key} f={f} selected={f.key === value} onPick={k => void pick(k)} />
                  ))}
                  {extra}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
