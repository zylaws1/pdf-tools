const PATHS = {
  select: 'M6 3l12 9-5.5 1.2L15 19l-2.2 1-2.6-5.7L6 18z',
  edittext: 'M4 7V5h10v2M9 5v14M7 19h4M17 8v12M15 8h4M15 20h4',
  text: 'M5 7V5h14v2M12 5v14M9 19h6',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z',
  line: 'M5 19L19 5',
  arrow: 'M5 19L19 5M11 5h8v8',
  pen: 'M3 21c3-1 4-4 6-6l9-9a2 2 0 0 0-3-3l-9 9c-2 2-2 6-3 9zM13 5l3 3',
  whiteout: 'M7 21h10M5 17L15 3l5 4-10 14H5z',
  highlight: 'M4 21h16M8 17l-2-2 9-11 4 3-9 10zM6 15l-2 3h4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 8.5h.01',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5M8 11h6M11 8v6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5M8 11h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A9 9 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.8M6.5 6.6C3.8 8.4 2 12 2 12s4 7 10 7c1.9 0 3.6-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.6-1.7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  front: 'M12 20V8M6 14l6-6 6 6M5 4h14',
  back: 'M12 4v12M6 10l6 6 6-6M5 20h14',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  alignLeft: 'M4 6h16M4 10h10M4 14h16M4 18h10',
  alignCenter: 'M4 6h16M7 10h10M4 14h16M7 18h10',
  alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  signature: 'M3 16c1.5-2.5 3-8 5-8s0 7 2 7 2.5-5 4.5-5-.5 4 1.5 4c1.2 0 2-1 3-1.5M3 20h18',
  pages: 'M8 3h10v14H8zM5 7v14h10',
  shield:'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={name === 'grip' ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  )
}
