import { useRef, type DragEvent } from 'react'

export function useSortable<T>(items: T[], setItems: (items: T[]) => void) {
  const dragIndex = useRef<number | null>(null)

  return (index: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      dragIndex.current = index
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(index))
    },
    onDragOver: (e: DragEvent) => {
      const from = dragIndex.current
      if (from === null) return
      e.preventDefault()
      if (from === index) return
      const next = items.slice()
      const [moved] = next.splice(from, 1)
      next.splice(index, 0, moved)
      dragIndex.current = index
      setItems(next)
    },
    onDrop: (e: DragEvent) => {
      if (dragIndex.current !== null) e.preventDefault()
    },
    onDragEnd: () => {
      dragIndex.current = null
    },
  })
}
