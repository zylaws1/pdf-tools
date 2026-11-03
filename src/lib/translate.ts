import { withTimeout } from './withTimeout'

// Common languages for the translate picker. Codes work with both the on-device
// Translator API and the MyMemory fallback below.
export const LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'ru', label: 'Russian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'sv', label: 'Swedish' },
]

/** A quick, honest guess from the script used — not a real language detector. null when the script (e.g. Latin) doesn't tell us enough. */
export function guessLanguage(text: string): string | null {
  if (/[぀-ヿ]/.test(text)) return 'ja'
  if (/[가-힣]/.test(text)) return 'ko'
  if (/[一-鿿]/.test(text)) return 'zh'
  if (/[Ѐ-ӿ]/.test(text)) return 'ru'
  if (/[؀-ۿ]/.test(text)) return 'ar'
  if (/[ऀ-ॿ]/.test(text)) return 'hi'
  if (/[฀-๿]/.test(text)) return 'th'
  return null
}

// The on-device model can need a first-time download; if that stalls (slow or flaky connection),
// fall back to the online service rather than leaving the user stuck on "Processing…" forever.
const ON_DEVICE_TIMEOUT_MS = 8000

interface BuiltInTranslator {
  translate(text: string): Promise<string>
  destroy?: () => void
}

interface TranslatorStatic {
  availability: (opts: { sourceLanguage: string; targetLanguage: string }) => Promise<string>
  create: (opts: { sourceLanguage: string; targetLanguage: string }) => Promise<BuiltInTranslator>
}

/** Chrome's on-device Translator API: no network call, nothing leaves the device. Not available in other browsers. */
async function translateOnDevice(text: string, from: string, to: string): Promise<string | null> {
  const T = (globalThis as { Translator?: TranslatorStatic }).Translator
  if (!T) return null
  try {
    const status = await T.availability({ sourceLanguage: from, targetLanguage: to })
    if (status === 'unavailable') return null
    const translator = await T.create({ sourceLanguage: from, targetLanguage: to })
    try {
      return await translator.translate(text)
    } finally {
      translator.destroy?.()
    }
  } catch {
    // feature-detected API that didn't actually work for this language pair or browser version
    return null
  }
}

// MyMemory's free anonymous tier caps requests at ~500 characters; split on sentence/word
// boundaries so nothing gets silently truncated.
function chunk(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > max) {
    let cut = rest.lastIndexOf('. ', max)
    if (cut < max * 0.4) cut = rest.lastIndexOf(' ', max)
    if (cut < 1) cut = max
    parts.push(rest.slice(0, cut + 1))
    rest = rest.slice(cut + 1)
  }
  if (rest) parts.push(rest)
  return parts
}

async function translateOnline(text: string, from: string, to: string): Promise<string> {
  const pieces = await Promise.all(
    chunk(text, 450).map(async piece => {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(piece)}&langpair=${from}|${to}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Translation service returned ${res.status}`)
      const data = await res.json()
      const out = data?.responseData?.translatedText
      if (typeof out !== 'string' || data?.responseStatus >= 400) throw new Error('Translation failed')
      return out
    }),
  )
  return pieces.join('')
}

export interface TranslateResult {
  text: string
  /** 'on-device' never left the browser; 'online' sent the text to a free translation API. */
  via: 'on-device' | 'online'
}

export async function translateText(text: string, from: string, to: string): Promise<TranslateResult> {
  const onDevice = await withTimeout(translateOnDevice(text, from, to), ON_DEVICE_TIMEOUT_MS)
  if (onDevice != null) return { text: onDevice, via: 'on-device' }
  return { text: await translateOnline(text, from, to), via: 'online' }
}
