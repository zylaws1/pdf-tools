import { Icon } from '../../components/Icon'
import { KIND_LABEL, isLinear, type El, type LayerOp } from './model'
import { useFontRegistry } from './fonts'
import { FontPicker } from './FontPicker'

interface Props {
  el: El
  onChange: (patch: Partial<El>) => void
  onPickFont: (key: string) => void
  onUploadFont: () => void
  onDuplicate: () => void
  onDelete: () => void
  onLayer: (op: LayerOp) => void
  onCopyToAllPages?: () => void
}

const r1 = (n: number) => Math.round(n * 10) / 10

function Num({ label, value, onChange, min, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={r1(value)}
        min={min}
        step={step}
        onChange={e => {
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) onChange(min !== undefined ? Math.max(min, v) : v)
        }}
      />
    </label>
  )
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      {label}
      <input type="color" value={value} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

export function PropsPanel({ el, onChange, onPickFont, onUploadFont, onDuplicate, onDelete, onLayer, onCopyToAllPages }: Props) {
  const fonts = useFontRegistry()
  const chosen = fonts.get(el.font)
  const text = el.text ?? ''
  const fallback = fonts.fallbackOf(el.font, text, el.fallbackFont)
  const synth = el.kind === 'text' ? fonts.pick(chosen, el.bold, el.italic) : null
  const hasStroke = ['rect', 'ellipse', 'line', 'arrow', 'pen'].includes(el.kind)

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>
          {el.label ?? KIND_LABEL[el.kind]} <span className="muted">· page {el.page + 1}</span>
        </h3>
        <div className="mini-btns">
          <button title="Duplicate (Ctrl/⌘+D)" onClick={onDuplicate}><Icon name="copy" size={16} /></button>
          <button title="Delete (Del)" className="danger" onClick={onDelete}><Icon name="trash" size={16} /></button>
        </div>
      </div>

      {el.kind === 'text' && (
        <>
          <label className="field">
            Text <span className="muted">(or double-click it on the page)</span>
            <textarea rows={3} value={el.text} onChange={e => onChange({ text: e.target.value })} />
          </label>
          <div className="field">
            Font
            <FontPicker value={el.font ?? 'helvetica'} onPick={onPickFont} onUpload={onUploadFont} />
          </div>
          {fonts.supports(chosen, text) === false &&
            (fallback ? (
              <p className="warn">
                {chosen.label} doesn't contain some of these characters, so just those use <b>{fallback.label}</b>.
              </p>
            ) : (
              <p className="warn">
                No available font can show some of these characters. Pick a font from <b>On this computer</b> or upload one that supports them.
              </p>
            ))}
          <div className="field-row">
            <Num label="Size" value={el.size!} min={2} onChange={size => onChange({ size })} />
            <Color label="Color" value={el.color!} onChange={color => onChange({ color })} />
          </div>
          <div className="style-row">
            <div className="toggle-group">
              <button className={el.bold ? 'on' : ''} title="Bold" onClick={() => onChange({ bold: !el.bold })}><b>B</b></button>
              <button className={el.italic ? 'on' : ''} title="Italic" onClick={() => onChange({ italic: !el.italic })}><i>I</i></button>
              <button className={el.underline ? 'on' : ''} title="Underline" onClick={() => onChange({ underline: !el.underline })}><u>U</u></button>
            </div>
            <div className="toggle-group">
              {(['left', 'center', 'right'] as const).map(a => (
                <button key={a} className={el.align === a ? 'on' : ''} title={`Align ${a}`} onClick={() => onChange({ align: a })}>
                  <Icon name={a === 'left' ? 'alignLeft' : a === 'center' ? 'alignCenter' : 'alignRight'} size={16} />
                </button>
              ))}
            </div>
          </div>
          {(synth?.fakeBold || synth?.fakeItalic) && (
            <p className="hint">
              {chosen.label} has no {[synth.fakeBold && 'bold', synth.fakeItalic && 'italic'].filter(Boolean).join('/')} style; it is simulated.
            </p>
          )}
          <label className="field">
            Line spacing <span className="muted">{el.lineHeight?.toFixed(2)}</span>
            <input type="range" min={0.8} max={3} step={0.05} value={el.lineHeight} onChange={e => onChange({ lineHeight: +e.target.value })} />
          </label>
        </>
      )}

      {(el.kind === 'rect' || el.kind === 'ellipse') && (
        <div className="field-row">
          <label className="field">
            Fill
            <div className="fill-row">
              <input type="checkbox" checked={!!el.fill} onChange={e => onChange({ fill: e.target.checked ? '#ffd7d6' : null })} />
              {el.fill && <input type="color" value={el.fill} onChange={e => onChange({ fill: e.target.value })} />}
            </div>
          </label>
        </div>
      )}
      {(el.kind === 'whiteout' || el.kind === 'highlight') && (
        <Color label={el.kind === 'whiteout' ? 'Cover color' : 'Highlight color'} value={el.fill ?? '#ffffff'} onChange={fill => onChange({ fill })} />
      )}
      {hasStroke && (
        <div className="field-row">
          <Color label={isLinear(el.kind) || el.kind === 'pen' ? 'Color' : 'Border'} value={el.stroke!} onChange={stroke => onChange({ stroke })} />
          <Num label="Thickness" value={el.strokeWidth!} min={el.kind === 'rect' || el.kind === 'ellipse' ? 0 : 0.5} step={0.5} onChange={strokeWidth => onChange({ strokeWidth })} />
        </div>
      )}

      <label className="field">
        Opacity <span className="muted">{Math.round(el.opacity * 100)}%</span>
        <input type="range" min={0.05} max={1} step={0.05} value={el.opacity} onChange={e => onChange({ opacity: +e.target.value })} />
      </label>

      <div className="field-row">
        <Num label="X" value={el.x} onChange={x => onChange({ x })} />
        <Num label="Y" value={el.y} onChange={y => onChange({ y })} />
      </div>
      {el.kind !== 'text' && (
        <div className="field-row">
          <Num label={isLinear(el.kind) ? 'ΔX' : 'W'} value={el.w} min={isLinear(el.kind) ? undefined : 1} onChange={w => onChange(el.kind === 'image' ? { w, h: (w * el.h) / el.w } : { w })} />
          <Num label={isLinear(el.kind) ? 'ΔY' : 'H'} value={el.h} min={isLinear(el.kind) ? undefined : 1} onChange={h => onChange(el.kind === 'image' ? { h, w: (h * el.w) / el.h } : { h })} />
        </div>
      )}

      <div className="field">
        Arrange
        <div className="toggle-group wide">
          <button title="Bring to front (Ctrl/⌘+Shift+])" onClick={() => onLayer('front')}><Icon name="front" size={16} /></button>
          <button title="Bring forward (Ctrl/⌘+])" onClick={() => onLayer('up')}><Icon name="up" size={16} /></button>
          <button title="Send backward (Ctrl/⌘+[)" onClick={() => onLayer('down')}><Icon name="down" size={16} /></button>
          <button title="Send to back (Ctrl/⌘+Shift+[)" onClick={() => onLayer('back')}><Icon name="back" size={16} /></button>
        </div>
      </div>
      {onCopyToAllPages && (
        <button className="btn-secondary" title="Put a copy at the same spot on every other page, e.g. initials" onClick={onCopyToAllPages}>
          <Icon name="pages" size={14} /> Place on all pages
        </button>
      )}
    </section>
  )
}
