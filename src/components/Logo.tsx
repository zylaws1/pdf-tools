/** Vber AI mark: a "V" with the brand's violet dot, same as vber-ai.com's favicon. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <rect x="1" y="1" width="62" height="62" rx="15" fill="#151924" stroke="#2f3548" strokeWidth="2" />
      <path d="M19 20 L31 45 L43 20" fill="none" stroke="#e9eaf0" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="48" cy="45" r="5" fill="#7c6fff" />
    </svg>
  )
}

export function Logo() {
  return (
    <a href="#/" className="logo" aria-label="Vber PDF home">
      <LogoMark />
      <span className="logo-word">
        vber<span className="dot">.</span>ai
      </span>
      <span className="logo-product">PDF</span>
    </a>
  )
}
