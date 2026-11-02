const PATHS: Record<string, string> = {
  merge: 'M8 6h10v14H8zM14 12h10v14H14z',
  split: 'M6 8h8v16H6zM18 8h8v16h-8zM16 4v24',
  organize: 'M6 6h8v8H6zM18 6h8v8h-8zM6 18h8v8H6zM18 18h8v8h-8z',
  edit: 'M8 24l2-6 12-12 4 4-12 12zM10 18l4 4',
  img2pdf: 'M5 9h14v12H5zM5 18l4-4 4 4 2-2 4 4M20 14h7v12H17v-3',
  pdf2img: 'M5 6h12v16H5zM15 13h12v12H15zM15 22l4-4 3 3 2-2 3 3',
}

export function ToolIcon({ name, colors, size = 46 }: { name: string; colors: [string, string]; size?: number }) {
  const id = `tool-grad-${name}`
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={colors[0]} />
          <stop offset="1" stopColor={colors[1]} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <path d={PATHS[name]} fill="none" stroke="#0b0d12" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" transform="translate(3.2 3.2) scale(0.8)" />
    </svg>
  )
}
