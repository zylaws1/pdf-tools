import { withTimeout } from './withTimeout'

// The on-device model can need a first-time download; if that stalls (slow or flaky connection),
// fall back to the online service rather than leaving the user stuck on "Processing…" forever.
const ON_DEVICE_TIMEOUT_MS = 8000

export interface GrammarResult {
  text: string
  /** 'on-device' never left the browser; 'online' sent the text to a free grammar-check API. */
  via: 'on-device' | 'online'
  /** Number of issues found and corrected. */
  fixes: number
}

interface ProofreaderCorrection {
  startIndex: number
  endIndex: number
  correction: string
}

interface ProofreadOutput {
  correctedInput: string
  corrections: ProofreaderCorrection[]
}

interface ProofreaderStatic {
  availability: () => Promise<string>
  create: () => Promise<{ proofread(text: string): Promise<ProofreadOutput>; destroy?: () => void }>
}

/** Chrome's on-device Proofreader API: no network call, nothing leaves the device. Not available in other browsers. */
async function fixOnDevice(text: string): Promise<GrammarResult | null> {
  const P = (globalThis as { Proofreader?: ProofreaderStatic }).Proofreader
  if (!P) return null
  try {
    const status = await P.availability()
    if (status === 'unavailable') return null
    const proofreader = await P.create()
    try {
      const out = await proofreader.proofread(text)
      return { text: out.correctedInput ?? text, via: 'on-device', fixes: out.corrections?.length ?? 0 }
    } finally {
      proofreader.destroy?.()
    }
  } catch {
    // feature-detected API that didn't actually work in this browser version
    return null
  }
}

interface LTMatch {
  offset: number
  length: number
  replacements?: { value: string }[]
}

/** LanguageTool's free community server. Detects the language itself; no key needed, but rate-limited. */
async function fixOnline(text: string): Promise<GrammarResult> {
  const res = await fetch('https://api.languagetool.org/v2/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text, language: 'auto' }),
  })
  if (!res.ok) throw new Error(`Grammar check service returned ${res.status}`)
  const data = await res.json()
  const matches: LTMatch[] = data?.matches ?? []
  // apply back-to-front so each replacement's offset is still valid for the text before it
  let out = text
  let fixes = 0
  for (const m of [...matches].sort((a, b) => b.offset - a.offset)) {
    const fix = m.replacements?.[0]?.value
    if (fix === undefined) continue
    out = out.slice(0, m.offset) + fix + out.slice(m.offset + m.length)
    fixes++
  }
  return { text: out, via: 'online', fixes }
}

export async function fixGrammar(text: string): Promise<GrammarResult> {
  const onDevice = await withTimeout(fixOnDevice(text), ON_DEVICE_TIMEOUT_MS)
  if (onDevice) return onDevice
  return fixOnline(text)
}
