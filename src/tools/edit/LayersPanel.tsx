import { Icon, type IconName } from '../../components/Icon'
import { useSortable } from '../../components/useSortable'
import { layerLabel, type El, type Kind } from './model'

const KIND_ICON: Record<Kind, IconName> = {
  text: 'text',
  rect: 'rect',
  ellipse: 'ellipse',
  line: 'line',
  arrow: 'arrow',
  pen: 'pen',
  image: 'image',
  whiteout: 'whiteout',
  highlight: 'highlight',
}

interface Props {
  els: El[]
  selectedId: string | null
  onSelect: (id: string) => void
  onChange: (els: El[]) => void
  onToggle: (id: string, key: 'hidden' | 'locked') => void
}

function PageGroup({ page, items, selectedId, onSelect, onReorder, onToggle }: { page: number; items: El[]; selectedId: string | null; onSelect: (id: string) => void; onReorder: (items: El[]) => void; onToggle: Props['onToggle'] }) {
  const sortable = useSortable(items, onReorder)
  return (
    <div className="layer-group">
      <div className="layer-page">Page {page + 1}</div>
      {items.map((el, i) => (
        <div key={el.id} className={`layer-row${el.id === selectedId ? ' selected' : ''}${el.hidden ? ' is-hidden' : ''}`} onClick={() => onSelect(el.id)} {...sortable(i)}>
          <span className="layer-grip"><Icon name="grip" size={14} /></span>
          <span className="layer-icon"><Icon name={KIND_ICON[el.kind]} size={15} /></span>
          <span className="layer-name">{layerLabel(el)}</span>
          <button title={el.hidden ? 'Show' : 'Hide'} onClick={e => { e.stopPropagation(); onToggle(el.id, 'hidden') }}>
            <Icon name={el.hidden ? 'eyeOff' : 'eye'} size={15} />
          </button>
          <button title={el.locked ? 'Unlock' : 'Lock'} className={el.locked ? 'on' : ''} onClick={e => { e.stopPropagation(); onToggle(el.id, 'locked') }}>
            <Icon name={el.locked ? 'lock' : 'unlock'} size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function LayersPanel({ els, selectedId, onSelect, onChange, onToggle }: Props) {
  const pages = [...new Set(els.map(e => e.page))].sort((a, b) => a - b)
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Layers <span className="muted">· {els.length}</span></h3>
      </div>
      {!els.length && <p className="hint">Items you add appear here. Top of the list is drawn on top.</p>}
      {pages.map(page => {
        // top-most layer first, like most design tools
        const items = els.filter(e => e.page === page).reverse()
        return (
          <PageGroup
            key={page}
            page={page}
            items={items}
            selectedId={selectedId}
            onSelect={onSelect}
            onToggle={onToggle}
            onReorder={list => onChange([...els.filter(e => e.page !== page), ...list.slice().reverse()])}
          />
        )
      })}
    </section>
  )
}
