import { Suspense, useEffect, useState, type DragEvent, type MouseEvent } from 'react'
import { TOOLS } from './tools'
import { ToolIcon } from './components/ToolIcon'
import { Logo, LogoMark } from './components/Logo'
import { Icon } from './components/Icon'
import { isEmbedded } from './tools/edit/libraryLink'
import { pickFiles } from './lib/pdf'
import { setPendingFiles } from './lib/pendingFiles'

const VBER_URL = 'https://vber-ai.com'

// '#/edit?file=…' → 'edit' (the query part is read by the tool itself)
const currentRoute = () => window.location.hash.replace(/^#\/?/, '').split('?')[0]

export default function App() {
  const [route, setRoute] = useState(currentRoute)
  // inside ai-document's editor window: no site header, the host app has its own
  const [embedded] = useState(isEmbedded)

  useEffect(() => {
    const onHash = () => {
      setRoute(currentRoute())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const tool = TOOLS.find(t => t.id === route)

  useEffect(() => {
    document.title = tool ? `${tool.title} · Vber PDF` : 'Vber PDF — free, private PDF editor by Vber AI'
  }, [tool])

  return (
    <div className={`app${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <header className="header">
          <Logo />
          <nav>
            {TOOLS.map(t => (
              <a key={t.id} href={`#/${t.id}`} className={t.id === route ? 'active' : ''}>
                {t.short}
              </a>
            ))}
          </nav>
          <a className="by-vber" href={VBER_URL} target="_blank" rel="noopener">
            by Vber AI ↗
          </a>
        </header>
      )}
      <div className="content">
        {/* key forces a fresh tool state when switching tools */}
        <Suspense fallback={<div className="tool-hero"><div className="spinner" style={{ margin: '0 auto' }} /></div>}>
          {tool ? <tool.Component key={tool.id} /> : <Home />}
        </Suspense>
      </div>
      {!tool && !embedded && <Footer />}
      <span className="app-version" title="Vber PDF version">v{__APP_VERSION__}</span>
    </div>
  )
}

/** Sends dropped/picked files to the tool that fits: images → Image to PDF, several PDFs → Merge, one PDF → Edit. */
function openFiles(list: File[]) {
  const pdfs = list.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
  const images = list.filter(f => f.type.startsWith('image/'))
  if (!pdfs.length && !images.length) return
  const [route, files] = !pdfs.length ? ['image-to-pdf', images] : pdfs.length > 1 ? ['merge', pdfs] : ['edit', pdfs]
  setPendingFiles(files)
  window.location.hash = `#/${route}`
}

function Home() {
  const [dragging, setDragging] = useState(false)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    openFiles(Array.from(e.dataTransfer.files))
  }

  // the glow on each card follows the pointer
  const glow = (e: MouseEvent<HTMLAnchorElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  return (
    <div
      onDragOver={e => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={e => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={onDrop}
    >
      {dragging && <div className="drop-overlay">Drop to open — PDFs open in the editor, images become a PDF</div>}
      <section className="home-hero">
        <p className="eyebrow">Vber AI · PDF Studio</p>
        <h1>
          Every PDF task.
          <br />
          <span className="grad-text">One private workspace.</span>
        </h1>
        <p className="sub">
          Edit, sign, merge, split and convert PDFs right in your browser. Your files never leave your device — no uploads, no account,
          no watermark.
        </p>
        <div className="hero-ctas">
          <a href="#/edit" className="btn btn-primary">
            Open the editor
          </a>
          <a href="#/merge" className="btn btn-ghost">
            Merge PDFs
          </a>
        </div>
        <div className="trust">
          <span>100% in your browser</span>
          <span>Free · no sign-up</span>
          <span>Fonts, forms &amp; signatures</span>
        </div>
      </section>

      <button
        className="home-drop"
        onClick={async () => openFiles(await pickFiles('application/pdf,.pdf,image/*', true))}
        aria-label="Choose PDFs or images to open"
      >
        <span className="home-drop-icon">
          <Icon name="pages" size={22} />
        </span>
        <span>
          <b>Drop a PDF here to start editing</b> — or several to merge, or images to turn into a PDF.
          <br />
          <span className="hint">Or click to choose files.</span>
        </span>
      </button>

      <h2 className="section-title">
        <span className="num">01</span> Tools
      </h2>
      <section className="tool-grid">
        {TOOLS.map(t => (
          <a key={t.id} href={`#/${t.id}`} className="tool-card" onMouseMove={glow}>
            <ToolIcon name={t.icon} colors={t.colors} />
            <span className="tool-arrow" aria-hidden>
              →
            </span>
            <h3>
              {t.title} {t.badge && <span className="badge">{t.badge}</span>}
            </h3>
            <p>{t.desc}</p>
          </a>
        ))}
      </section>

      <h2 className="section-title">
        <span className="num">02</span> Why Vber PDF
      </h2>
      <section className="features">
        <div className="feature">
          <span className="num">// private</span>
          <h4>Nothing is uploaded</h4>
          <p>Every page is processed on your device, so contracts, statements and IDs stay with you.</p>
        </div>
        <div className="feature">
          <span className="num">// powerful</span>
          <h4>A real editor</h4>
          <p>Edit existing text in its own font, layers, shapes, form filling, and signatures you can save and reuse.</p>
        </div>
        <div className="feature">
          <span className="num">// simple</span>
          <h4>Free, instant, no account</h4>
          <p>Open the page and go. No sign-up, no watermark, no file-size paywall.</p>
        </div>
      </section>
    </div>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <p style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LogoMark size={22} />
          <span>
            Vber PDF is built by <a href={VBER_URL} target="_blank" rel="noopener">Vber AI</a> · vber-ai.com
          </span>
        </p>
        <p>Files are processed on your device. Nothing is uploaded.</p>
      </div>
    </footer>
  )
}
