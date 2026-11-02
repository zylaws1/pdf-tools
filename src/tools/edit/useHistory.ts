import { useEffect, useRef, useState, type SetStateAction } from 'react'

interface H<T> {
  past: T[]
  present: T
  future: T[]
  /** Last value recorded as an undo step; differs from present while a change is still being grouped. */
  saved: T
}

const record = <T,>(h: H<T>): H<T> =>
  h.present === h.saved ? h : { past: [...h.past, h.saved].slice(-200), present: h.present, future: [], saved: h.present }

/** State with undo/redo; rapid successive changes (drags, typing) are grouped into one step. */
export function useHistory<T>(initial: T) {
  const [h, setH] = useState<H<T>>({ past: [], present: initial, future: [], saved: initial })
  const timer = useRef(0)

  useEffect(() => {
    if (h.present === h.saved) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setH(record), 400)
  }, [h.present, h.saved])

  const set = (v: SetStateAction<T>) => setH(s => ({ ...s, present: typeof v === 'function' ? (v as (p: T) => T)(s.present) : v }))

  const undo = () =>
    setH(s => {
      const c = record(s)
      if (!c.past.length) return c
      const prev = c.past[c.past.length - 1]
      return { past: c.past.slice(0, -1), present: prev, saved: prev, future: [...c.future, c.present] }
    })

  const redo = () =>
    setH(s => {
      if (s.present !== s.saved || !s.future.length) return s
      const next = s.future[s.future.length - 1]
      return { past: [...s.past, s.present], present: next, saved: next, future: s.future.slice(0, -1) }
    })

  const reset = (v: T) => {
    window.clearTimeout(timer.current)
    setH({ past: [], present: v, future: [], saved: v })
  }

  return [
    h.present,
    set,
    { undo, redo, reset, canUndo: h.past.length > 0 || h.present !== h.saved, canRedo: h.future.length > 0 && h.present === h.saved },
  ] as const
}
