import { useState, type ReactNode } from 'react'

interface Props {
  src?: string
  label: string
  sub?: string
  rotation?: number
  selected?: boolean
  onClick?: () => void
  actions?: ReactNode
  dragProps?: object
}

export function Thumb({ src, label, sub, rotation = 0, selected, onClick, actions, dragProps }: Props) {
  const [aspect, setAspect] = useState(1)
  // a quarter turn swaps width and height, so shrink the image to keep it inside the box
  const scale = rotation % 180 ? Math.min(aspect, 1 / aspect) : 1
  return (
    <div className={`thumb${selected ? ' selected' : ''}${onClick ? ' clickable' : ''}`} onClick={onClick} {...dragProps}>
      {actions && <div className="thumb-actions" onClick={e => e.stopPropagation()}>{actions}</div>}
      <div className="thumb-img">
        {src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={e => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight || 1)}
            style={{ transform: `rotate(${rotation}deg) scale(${scale})` }}
          />
        ) : (
          <div className="spinner small" />
        )}
      </div>
      <div className="thumb-label" title={label}>{label}</div>
      {sub && <div className="thumb-sub">{sub}</div>}
    </div>
  )
}

export const IconBtn = ({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) => (
  <button className="icon-btn" title={title} onClick={onClick}>
    {children}
  </button>
)
