import type { IconName } from '../../components/Icon'
import type { Tool } from './model'

export const TOOLS: { id: Tool; label: string; short: string; key: string; icon: IconName }[] = [
  { id: 'select', label: 'Select & move', short: 'Select', key: 'V', icon: 'select' },
  { id: 'edittext', label: 'Edit existing text', short: 'Edit text', key: 'E', icon: 'edittext' },
  { id: 'text', label: 'Add text', short: 'Add text', key: 'T', icon: 'text' },
  { id: 'image', label: 'Image / signature', short: 'Image', key: 'I', icon: 'image' },
  { id: 'pen', label: 'Draw / sign', short: 'Draw', key: 'P', icon: 'pen' },
  { id: 'rect', label: 'Rectangle', short: 'Rectangle', key: 'R', icon: 'rect' },
  { id: 'ellipse', label: 'Ellipse', short: 'Ellipse', key: 'O', icon: 'ellipse' },
  { id: 'line', label: 'Line', short: 'Line', key: 'L', icon: 'line' },
  { id: 'arrow', label: 'Arrow', short: 'Arrow', key: 'A', icon: 'arrow' },
  { id: 'whiteout', label: 'Whiteout', short: 'Whiteout', key: 'W', icon: 'whiteout' },
  { id: 'highlight', label: 'Highlight', short: 'Highlight', key: 'H', icon: 'highlight' },
]

export const TOOL_KEYS = Object.fromEntries(TOOLS.map(t => [t.key.toLowerCase(), t.id])) as Record<string, Tool>
