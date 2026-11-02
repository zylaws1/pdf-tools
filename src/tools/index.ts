import { lazy, type ComponentType } from 'react'
import Merge from './Merge'
import Split from './Split'
import Organize from './Organize'
import ImagesToPdf from './ImagesToPdf'
import PdfToImages from './PdfToImages'

// the editor pulls in font tooling, so it's loaded only when opened
const Edit = lazy(() => import('./edit/Edit'))

export interface ToolDef {
  id: string
  title: string
  short: string
  desc: string
  colors: [string, string]
  icon: string
  badge?: string
  Component: ComponentType
}

export const TOOLS: ToolDef[] = [
  { id: 'edit', title: 'Edit PDF', short: 'Edit', desc: 'Change existing text in its original font, add text, shapes, images and signatures, fill forms.', colors: ['#7c6fff', '#c084fc'], icon: 'edit', badge: 'Pro editor', Component: Edit },
  { id: 'merge', title: 'Merge PDF', short: 'Merge', desc: 'Combine several PDFs into one, in exactly the order you want.', colors: ['#5eead4', '#38bdf8'], icon: 'merge', Component: Merge },
  { id: 'split', title: 'Split PDF', short: 'Split', desc: 'Pull out page ranges, single pages or a hand-picked selection.', colors: ['#38bdf8', '#7c6fff'], icon: 'split', Component: Split },
  { id: 'organize', title: 'Organize PDF', short: 'Organize', desc: 'Reorder, rotate and delete pages, or mix pages from several files.', colors: ['#fbbf24', '#fb7185'], icon: 'organize', Component: Organize },
  { id: 'image-to-pdf', title: 'Image to PDF', short: 'Image → PDF', desc: 'Turn JPG, PNG and WebP images into a clean PDF with your page size and margins.', colors: ['#34d399', '#5eead4'], icon: 'img2pdf', Component: ImagesToPdf },
  { id: 'pdf-to-image', title: 'PDF to Image', short: 'PDF → Image', desc: 'Export every page as a sharp JPG or PNG, up to 300 dpi.', colors: ['#f472b6', '#a78bfa'], icon: 'pdf2img', Component: PdfToImages },
]
