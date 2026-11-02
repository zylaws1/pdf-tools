import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react'
import { arrowHead, bbox, isLinear, type El, type Handle } from './model'
interface Props {
  el: El
  scale: number
  selected: boolean
  editing: boolean
  /** fontFamily / fontWeight / fontStyle for text elements */
  font: React.CSSProperties
  onPointerDown: (e: RPointerEvent, el: El) => void
  onHandleDown: (e: RPointerEvent, el: El, h: Handle) => void
  onDoubleClick: (el: El) => void
  onTextChange: (el: El, text: string) => void
  onEditEnd: (el: El) => void
}

function InlineText({ value, style, onChange, onDone }: { value: string; style: React.CSSProperties; onChange: (v: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    // focus after the click that created us has finished, otherwise the click steals focus back
    const t = setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 0)
    return () => clearTimeout(t)
  }, [])
  return (
    <textarea
      ref={ref}
      className="inline-text"
      style={style}
      value={value}
      rows={Math.max(1, value.split('\n').length)}
      // fallback width for browsers without CSS field-sizing (Safari, Firefox)
      cols={Math.max(2, ...value.split('\n').map(l => l.length + 1))}
      onChange={e => onChange(e.target.value)}
      onBlur={onDone}
      onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Escape') ref.current?.blur()
      }}
    />
  )
}

export function ElementView({ el, scale, selected, editing, font, onPointerDown, onHandleDown, onDoubleClick, onTextChange, onEditEnd }: Props) {
  const b = bbox(el)
  const sw = (el.strokeWidth ?? 0) * scale
  const W = b.width * scale
  const H = b.height * scale
  const cls = `el el-${el.kind}${selected ? ' selected' : ''}${el.locked ? ' locked' : ''}${editing ? ' editing' : ''}`
  const common = {
    'data-el': el.id,
    className: cls,
    onPointerDown: (e: RPointerEvent) => onPointerDown(e, el),
    onDoubleClick: () => onDoubleClick(el),
  }
  const handle = (h: Handle, x: number, y: number) => (
    <span key={h} className={`handle handle-${h}`} style={{ left: x, top: y }} onPointerDown={e => onHandleDown(e, el, h)} />
  )
  const showHandles = selected && !el.locked && !editing

  if (el.kind === 'text') {
    const style: React.CSSProperties = {
      ...font,
      fontSize: el.size! * scale,
      lineHeight: el.lineHeight,
      color: el.color,
      textDecoration: el.underline ? 'underline' : 'none',
      textAlign: el.align,
    }
    return (
      <div {...common} style={{ left: el.x * scale, top: el.y * scale, opacity: el.opacity, ...style }}>
        {editing ? (
          <InlineText value={el.text ?? ''} style={style} onChange={v => onTextChange(el, v)} onDone={() => onEditEnd(el)} />
        ) : (
          el.text || ' '
        )}
      </div>
    )
  }

  if (isLinear(el.kind)) {
    const x1 = (el.x - b.left) * scale
    const y1 = (el.y - b.top) * scale
    const x2 = x1 + el.w * scale
    const y2 = y1 + el.h * scale
    const head = el.kind === 'arrow' ? arrowHead(x1, y1, x2, y2, sw) : null
    const [ex, ey] = head ? head.base : [x2, y2]
    return (
      <div {...common} style={{ left: b.left * scale, top: b.top * scale, width: W, height: H, opacity: el.opacity }}>
        <svg className="el-svg">
          <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={el.stroke} strokeWidth={sw} strokeLinecap="round" />
          {head && <polygon points={head.tri.map(p => p.join(',')).join(' ')} fill={el.stroke} />}
          <line className="hit" x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(14, sw + 10)} />
        </svg>
        {showHandles && [handle('start', x1, y1), handle('end', x2, y2)]}
      </div>
    )
  }

  let content = null
  if (el.kind === 'rect') {
    content = (
      <svg className="el-svg">
        <rect x={sw / 2} y={sw / 2} width={Math.max(0, W - sw)} height={Math.max(0, H - sw)} fill={el.fill ?? 'none'} stroke={sw ? el.stroke : 'none'} strokeWidth={sw} />
      </svg>
    )
  } else if (el.kind === 'ellipse') {
    content = (
      <svg className="el-svg">
        <ellipse cx={W / 2} cy={H / 2} rx={Math.max(0, W / 2 - sw / 2)} ry={Math.max(0, H / 2 - sw / 2)} fill={el.fill ?? 'none'} stroke={sw ? el.stroke : 'none'} strokeWidth={sw} />
      </svg>
    )
  } else if (el.kind === 'pen') {
    content = (
      <svg className="el-svg">
        {el.strokes!.map((s, i) => (
          <polyline key={i} points={s.map(([nx, ny]) => `${nx * W},${ny * H}`).join(' ')} fill="none" stroke={el.stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    )
  } else if (el.kind === 'image') {
    content = <img src={el.img!.url} alt="" draggable={false} />
  }

  return (
    <div
      {...common}
      style={{
        left: b.left * scale,
        top: b.top * scale,
        width: W,
        height: H,
        opacity: el.opacity,
        ...((el.kind === 'whiteout' || el.kind === 'highlight') && { background: el.fill ?? '#fff' }),
      }}
    >
      {content}
      {showHandles && [handle('nw', 0, 0), handle('ne', W, 0), handle('sw', 0, H), handle('se', W, H)]}
    </div>
  )
}
