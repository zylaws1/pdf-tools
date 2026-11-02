import { Icon } from '../../components/Icon'
import type { Tool } from './model'
import { TOOLS } from './toolList'

interface Props {
  tool: Tool
  onTool: (t: Tool) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  zoom: number
  onZoom: (z: number) => void
  onFit: () => void
  onSign: () => void
}

export function Toolbar({ tool, onTool, canUndo, canRedo, onUndo, onRedo, zoom, onZoom, onFit, onSign }: Props) {
  return (
    <div className="editor-toolbar">
      <div className="tb-group">
        {TOOLS.map(t => [
          <button key={t.id} className={`tb-btn${tool === t.id ? ' active' : ''}`} title={`${t.label} (${t.key})`} onClick={() => onTool(t.id)}>
            <Icon name={t.icon} />
            <span className="tb-label">{t.short}</span>
          </button>,
          t.id === 'text' && (
            <button key="sign" className="tb-btn tb-sign" title="Insert signature (S)" onClick={onSign}>
              <Icon name="signature" />
              <span className="tb-label">Sign</span>
            </button>
          ),
        ])}
      </div>
      <div className="tb-group">
        <button className="tb-btn" title="Undo (Ctrl/⌘+Z)" disabled={!canUndo} onClick={onUndo}>
          <Icon name="undo" />
        </button>
        <button className="tb-btn" title="Redo (Ctrl/⌘+Shift+Z)" disabled={!canRedo} onClick={onRedo}>
          <Icon name="redo" />
        </button>
        <span className="tb-sep" />
        <button className="tb-btn" title="Zoom out" onClick={() => onZoom(zoom / 1.2)}>
          <Icon name="zoomOut" />
        </button>
        <span className="tb-zoom">{Math.round(zoom * 100)}%</span>
        <button className="tb-btn" title="Zoom in" onClick={() => onZoom(zoom * 1.2)}>
          <Icon name="zoomIn" />
        </button>
        <button className="tb-btn" title="Fit width" onClick={onFit}>
          <Icon name="fit" />
        </button>
      </div>
    </div>
  )
}
