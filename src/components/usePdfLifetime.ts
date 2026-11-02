import { useEffect, useState } from 'react'
import { closePdf, type PdfFile } from '../lib/pdf'

class PdfTracker {
  private open = new Set<PdfFile>()
  // bumped on every new load and on dispose, so stale background work can stop
  private generation = 0

  track<T extends PdfFile>(f: T): T {
    this.open.add(f)
    return f
  }

  close(f?: PdfFile | null) {
    if (!f) return
    this.open.delete(f)
    closePdf(f)
  }

  nextGeneration() {
    return ++this.generation
  }

  isCurrent(g: number) {
    return g === this.generation
  }

  dispose() {
    this.generation++
    this.open.forEach(closePdf)
    this.open.clear()
  }
}

/** Tracks opened PDFs so their pdf.js memory is released when removed or when the tool unmounts. */
export function usePdfLifetime() {
  const [tracker] = useState(() => new PdfTracker())
  useEffect(() => () => tracker.dispose(), [tracker])
  return tracker
}
