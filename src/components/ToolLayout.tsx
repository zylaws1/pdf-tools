import { useEffect, useRef, useState, type ReactNode } from 'react'
import { matchesAccept, pickFiles } from '../lib/pdf'
import { takePendingFiles } from '../lib/pendingFiles'
import { Icon } from './Icon'

interface Props {
  title: string
  subtitle: string
  accept: string
  multiple: boolean
  selectLabel: string
  hasFiles: boolean
  onFiles: (files: File[]) => void | Promise<void>
  sidebar: ReactNode
  actionLabel: string
  onAction: () => void | Promise<void>
  actionDisabled?: boolean
  children: ReactNode
}

export function ToolLayout(p: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const run = async (label: string, fn: () => void | Promise<void>) => {
    setError(null)
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      console.error(e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const accept = (files: File[]) => {
    const ok = files.filter(f => matchesAccept(f, p.accept))
    if (!ok.length) return setError('Those files are not supported by this tool.')
    run('Loading files…', () => p.onFiles(p.multiple ? ok : ok.slice(0, 1)))
  }

  const select = async () => {
    const files = await pickFiles(p.accept, p.multiple)
    if (files.length) accept(files)
  }

  // window listeners are registered once and always call the latest accept()
  const acceptRef = useRef(accept)
  useEffect(() => {
    acceptRef.current = accept
  })

  // files dropped on the home page open straight in this tool, once the tool has fully mounted
  // (a timer, so a mount/cleanup cycle such as React's StrictMode check can't cancel the load it starts)
  useEffect(() => {
    const t = window.setTimeout(() => {
      const files = takePendingFiles()
      if (files) acceptRef.current(files)
    })
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    let depth = 0
    const isFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return
      if (--depth <= 0) setDragging(false)
    }
    const over = (e: DragEvent) => isFiles(e) && e.preventDefault()
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      acceptRef.current(Array.from(e.dataTransfer!.files))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  return (
    <>
      {dragging && <div className="drop-overlay">Drop files here</div>}
      {busy && (
        <div className="busy-overlay">
          <div className="spinner" />
          {busy}
        </div>
      )}
      {!p.hasFiles ? (
        <section className="tool-hero">
          <h1>{p.title}</h1>
          <p className="subtitle">{p.subtitle}</p>
          <button className="btn-select" onClick={select}>
            {p.selectLabel}
          </button>
          <p className="drop-hint">or drop files here</p>
          {error && <p className="error">{error}</p>}
          <p className="privacy"><Icon name="shield" size={14} /> Files are processed in your browser and never uploaded.</p>
        </section>
      ) : (
        <div className="workspace">
          <main className="workspace-main">
            {p.multiple && (
              <button className="btn-add" title="Add more files" onClick={select}>
                +
              </button>
            )}
            {p.children}
          </main>
          <aside className="sidebar">
            <h2>{p.title}</h2>
            <div className="sidebar-body">
              {p.sidebar}
              {error && <p className="error">{error}</p>}
            </div>
            <button
              className="btn-action"
              disabled={p.actionDisabled || !!busy}
              onClick={() => run('Processing…', p.onAction)}
            >
              {p.actionLabel} <span aria-hidden>➜</span>
            </button>
          </aside>
        </div>
      )}
    </>
  )
}
