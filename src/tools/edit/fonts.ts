import * as fontkitModule from '@pdf-lib/fontkit'
import { useSyncExternalStore, type CSSProperties } from 'react'
import {
  StandardFonts,
  TextRenderingMode,
  popGraphicsState,
  pushGraphicsState,
  setGraphicsState,
  setLineWidth,
  setStrokingColor,
  setTextRenderingMode,
  type Color,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import { uid } from '../../lib/pdf'

// The package's runtime export is a default export, but its typings only declare named ones
export const fontkit = (fontkitModule as unknown as { default?: typeof fontkitModule }).default ?? fontkitModule
type FkFont = ReturnType<typeof fontkitModule.create>

export type FontGroup = 'document' | 'standard' | 'library' | 'uploaded' | 'system'
export type FontCategory = 'sans' | 'serif' | 'mono' | 'script'
/** bit 0 = bold, bit 1 = italic */
export type Variant = 0 | 1 | 2 | 3

interface FaceSource {
  url?: string
  bytes?: Uint8Array
  getBytes?: () => Promise<Uint8Array>
  /** Needed to pick one face out of a .ttc collection. */
  postscriptName?: string
  /** FontFace registered for on-screen display. */
  displayed?: boolean
}

export interface FontFamily {
  key: string
  label: string
  group: FontGroup
  category: FontCategory
  /** CSS font-family used to display this font. */
  css: string
  aliases: string[]
  sources: Partial<Record<Variant, FaceSource>>
  standard?: [StandardFonts, StandardFonts, StandardFonts, StandardFonts]
  /** Ascent/descent as a fraction of the em size; known once a face has been parsed. */
  ascent?: number
  descent?: number
  /** Parsed face used to check which characters the font can draw. */
  glyphs?: FkFont
  /** Display-only faces (pdf.js) are registered without weight/style, so CSS must not synthesize on top of them. */
  intrinsicStyle?: boolean
}

interface LocalFontData {
  family: string
  fullName: string
  postscriptName: string
  style: string
  blob(): Promise<Blob>
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// ---- bundled library -------------------------------------------------------

const LIBRARY: [pkg: string, label: string, category: FontCategory, aliases?: string[]][] = [
  ['arimo', 'Arimo (Arial / Helvetica metrics)', 'sans', ['arial', 'arialmt', 'helvetica', 'helveticaneue', 'liberationsans', 'nimbussans']],
  ['carlito', 'Carlito (Calibri metrics)', 'sans', ['calibri']],
  ['open-sans', 'Open Sans', 'sans', ['verdana', 'tahoma', 'segoeui', 'trebuchetms']],
  ['roboto', 'Roboto', 'sans'],
  ['inter', 'Inter', 'sans', ['sfpro', 'sfprotext', 'sfprodisplay', 'systemui']],
  ['lato', 'Lato', 'sans'],
  ['montserrat', 'Montserrat', 'sans', ['gotham', 'proximanova', 'centurygothic', 'futura']],
  ['poppins', 'Poppins', 'sans', ['avenir', 'avenirnext']],
  ['source-sans-3', 'Source Sans 3', 'sans', ['sourcesanspro', 'myriad', 'myriadpro', 'frutiger']],
  ['noto-sans', 'Noto Sans', 'sans'],
  ['nunito', 'Nunito', 'sans'],
  ['raleway', 'Raleway', 'sans'],
  ['ibm-plex-sans', 'IBM Plex Sans', 'sans'],
  ['pt-sans', 'PT Sans', 'sans'],
  ['fira-sans', 'Fira Sans', 'sans'],
  ['oswald', 'Oswald', 'sans', ['impact', 'bebasneue']],
  ['tinos', 'Tinos (Times New Roman metrics)', 'serif', ['timesnewroman', 'timesnewromanps', 'timesnewromanpsmt', 'times', 'timesroman', 'liberationserif', 'nimbusroman']],
  ['caladea', 'Caladea (Cambria metrics)', 'serif', ['cambria']],
  ['noto-serif', 'Noto Serif', 'serif', ['georgia']],
  ['merriweather', 'Merriweather', 'serif'],
  ['lora', 'Lora', 'serif'],
  ['playfair-display', 'Playfair Display', 'serif', ['didot', 'bodoni']],
  ['pt-serif', 'PT Serif', 'serif', ['palatino', 'palatinolinotype', 'bookantiqua']],
  ['eb-garamond', 'EB Garamond', 'serif', ['garamond', 'adobegaramond', 'adobegaramondpro']],
  ['libre-baskerville', 'Libre Baskerville', 'serif', ['baskerville', 'baskervilleoldface']],
  ['source-serif-4', 'Source Serif 4', 'serif', ['minion', 'minionpro', 'sourceserifpro']],
  ['cousine', 'Cousine (Courier New metrics)', 'mono', ['couriernew', 'couriernewpsmt', 'courier', 'liberationmono']],
  ['roboto-mono', 'Roboto Mono', 'mono', ['consolas', 'menlo', 'monaco', 'lucidaconsole']],
  ['source-code-pro', 'Source Code Pro', 'mono'],
  ['ibm-plex-mono', 'IBM Plex Mono', 'mono'],
  ['jetbrains-mono', 'JetBrains Mono', 'mono'],
  ['dancing-script', 'Dancing Script', 'script', ['brushscript', 'brushscriptmt']],
  ['great-vibes', 'Great Vibes', 'script'],
  ['sacramento', 'Sacramento', 'script'],
  ['caveat', 'Caveat', 'script', ['comicsans', 'comicsansms', 'segoeprint']],
  ['homemade-apple', 'Homemade Apple', 'script'],
  ['pacifico', 'Pacifico', 'script'],
]

const LIB_FILES = import.meta.glob('/node_modules/@expo-google-fonts/*/{400Regular,400Regular_Italic,700Bold,700Bold_Italic}/*.ttf', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const FOLDER_VARIANT: Record<string, Variant> = { '400Regular': 0, '700Bold': 1, '400Regular_Italic': 2, '700Bold_Italic': 3 }

const STANDARD: FontFamily[] = [
  {
    key: 'helvetica',
    label: 'Helvetica',
    group: 'standard',
    category: 'sans',
    css: 'Arial, Helvetica, sans-serif',
    aliases: ['helvetica', 'arial', 'arialmt'],
    sources: {},
    ascent: 0.905,
    descent: 0.212,
    standard: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  },
  {
    key: 'times',
    label: 'Times',
    group: 'standard',
    category: 'serif',
    css: '"Times New Roman", Times, serif',
    aliases: ['times', 'timesroman', 'timesnewroman', 'timesnewromanpsmt'],
    sources: {},
    ascent: 0.891,
    descent: 0.216,
    standard: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  },
  {
    key: 'courier',
    label: 'Courier',
    group: 'standard',
    category: 'mono',
    css: '"Courier New", Courier, monospace',
    aliases: ['courier', 'couriernew', 'couriernewpsmt'],
    sources: {},
    ascent: 0.833,
    descent: 0.3,
    standard: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
  },
]

// Characters the base-14 fonts can encode (WinAnsi)
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
const winAnsiOk = (ch: string) => {
  const c = ch.codePointAt(0)!
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch) || ch === '\n' || ch === '\t'
}

export const variantOf = (bold = false, italic = false) => ((bold ? 1 : 0) | (italic ? 2 : 0)) as Variant
const styleVariant = (style: string) => variantOf(/bold|black|heavy/i.test(style) && !/semi|demi/i.test(style), /italic|oblique/i.test(style))

function metricsOf(f: FkFont) {
  const os2 = (f as unknown as Record<string, { fsSelection?: { useTypoMetrics?: boolean }; typoAscender?: number; typoDescender?: number }>)['OS/2']
  const typo = os2?.fsSelection?.useTypoMetrics
  const ascent = typo ? os2!.typoAscender! : f.ascent
  const descent = typo ? os2!.typoDescender! : f.descent
  return { ascent: ascent / f.unitsPerEm, descent: Math.abs(descent) / f.unitsPerEm }
}

function parse(bytes: Uint8Array, postscriptName?: string): FkFont {
  // fontkit's second argument means "variation name" for single fonts, so only use it for .ttc collections
  const f = fontkit.create(bytes) as FkFont | { fonts: FkFont[]; getFont(name: string): FkFont | null }
  if (!('fonts' in f)) return f
  const face = (postscriptName && f.getFont(postscriptName)) || f.fonts[0]
  if (!face) throw new Error('Empty font collection.')
  return face
}

/** No CJK fonts are bundled; such text needs a font from the PDF itself, this computer or an upload. */
export const needsCjk = (text: string) => /[\u3040-\u30ff\uac00-\ud7af\u1100-\u11ff\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/.test(text)
// Broad hint for picking a CJK-capable system font by name \u2014 a PDF/translation's own font name
// (e.g. "Arial") never hints at CJK coverage the way it does for ordinary text, so this can't go
// through the usual name-matching path at all.
// Script-specific name hints for picking a *candidate list* of system fonts for CJK text — ordered
// roughly by how broad/standard each is, since a name match alone doesn't mean a font actually has
// the glyphs (e.g. "AppleGothic" name-matches generically but is Korean-only); callers must still
// verify with supports() before committing to one. Separate scripts matter: a Korean-leaning name
// like "AppleGothic" would otherwise win a Chinese search just by sorting first.
const HANGUL = /[가-힣]/
const KANA = /[぀-ヿ]/
const CJK_FONT_NAME_BY_SCRIPT = {
  ko: [/^apple sd gothic neo$/i, /malgun/i, /batang|dotum|gulim/i, /nanum/i, /gothic/i],
  ja: [/^hiragino sans$/i, /^hiragino.*gothic/i, /yu\s?gothic/i, /meiryo/i, /hiragino/i, /toppan|tsukushi/i],
  zh: [/^pingfang sc$/i, /^pingfang/i, /heiti sc|songti sc/i, /^hei$|^kai$/i, /heiti|songti|kaiti|yuanti|xingkai|fangsong|lantinghei|simsong|biaukai/i],
} as const

class FontRegistry {
  private fams = new Map<string, FontFamily>()
  private listeners = new Set<() => void>()
  private loading = new Map<string, Promise<void>>()
  version = 0
  systemLoaded = false
  readonly systemSupported = typeof window !== 'undefined' && 'queryLocalFonts' in window

  constructor() {
    for (const f of STANDARD) this.fams.set(f.key, f)
    for (const [pkg, label, category, aliases = []] of LIBRARY) {
      const sources: FontFamily['sources'] = {}
      for (const [path, url] of Object.entries(LIB_FILES)) {
        const m = path.match(/@expo-google-fonts\/([^/]+)\/([^/]+)\//)
        if (m && m[1] === pkg && m[2] in FOLDER_VARIANT) sources[FOLDER_VARIANT[m[2]]] = { url }
      }
      if (sources[0]) this.fams.set(`lib:${pkg}`, { key: `lib:${pkg}`, label, group: 'library', category, css: `"lib-${pkg}"`, aliases: [norm(label.split(' (')[0]), ...aliases], sources })
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.version++
    this.listeners.forEach(fn => fn())
  }

  list() {
    return [...this.fams.values()]
  }

  /**
   * System fonts worth trying for CJK text, in priority order — a name match alone doesn't guarantee
   * the glyphs are actually there, so this is a *candidate list* for a caller to verify with
   * supports() (after loading each), not a single final answer. Script-aware: a Korean-leaning name
   * would otherwise win a Chinese search just by sorting first in the installed-fonts list.
   */
  cjkSystemCandidates(text: string): FontFamily[] {
    const patterns = CJK_FONT_NAME_BY_SCRIPT[HANGUL.test(text) ? 'ko' : KANA.test(text) ? 'ja' : 'zh']
    const system = this.list().filter(f => f.group === 'system')
    const seen = new Set<string>()
    const out: FontFamily[] = []
    for (const pattern of patterns) {
      for (const f of system) {
        if (pattern.test(f.label) && !seen.has(f.key)) {
          seen.add(f.key)
          out.push(f)
        }
      }
    }
    return out
  }

  get(key?: string) {
    return (key && this.fams.get(key)) || this.fams.get('helvetica')!
  }

  /** Best face for a requested style and whether bold/italic must be simulated. */
  pick(f: FontFamily, bold = false, italic = false) {
    if (f.standard) return { variant: variantOf(bold, italic), fakeBold: false, fakeItalic: false }
    const want = variantOf(bold, italic)
    const order: Variant[] = [want, (want & 1) as Variant, (want & 2) as Variant, 0, 1, 2, 3]
    const variant = order.find(v => f.sources[v]) ?? 0
    return { variant, fakeBold: bold && !(variant & 1), fakeItalic: italic && !(variant & 2) }
  }

  /** CSS for showing text in this font (and its fallback, glyph by glyph) so it matches what gets saved. */
  cssStyle(f: FontFamily, bold = false, italic = false, fallback?: FontFamily | null): CSSProperties {
    const fontFamily = [f.css, fallback?.css, 'sans-serif'].filter(Boolean).join(', ')
    const style = { fontFamily, fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal' }
    if (!f.intrinsicStyle) return style
    // the PDF's own face already is bold/italic as needed; the browser may only simulate the styles it lacks
    const p = this.pick(f, bold, italic)
    return { ...style, fontSynthesis: [p.fakeBold && 'weight', p.fakeItalic && 'style'].filter(Boolean).join(' ') || 'none' }
  }

  /**
   * true/false if known; undefined if the font hasn't been parsed yet. A font whose tables are
   * inconsistent (seen with some PDF-embedded subset fonts: a cmap entry pointing at a glyph the
   * subsetted glyf/loca tables no longer have) can throw from fontkit while just being asked this —
   * that's not a real answer either way, so it's treated as "doesn't support" rather than propagated.
   */
  supports(f: FontFamily, text: string): boolean | undefined {
    const chars = [...text].filter(c => c !== '\n' && c !== '\r')
    if (f.standard) return chars.every(winAnsiOk)
    if (!f.glyphs) return undefined
    try {
      return chars.every(c => c === ' ' || f.glyphs!.hasGlyphForCodePoint(c.codePointAt(0)!))
    } catch {
      return false
    }
  }

  /**
   * Whether `f` has a glyph for `ch`. Unlike supports(), spaces count too: subset fonts in PDFs often have none,
   * and the browser then draws them with the next font in the list, so saving must do the same.
   */
  private hasChar(f: FontFamily, ch: string) {
    if (ch === ' ' && f.glyphs && !f.standard) {
      try {
        return f.glyphs.hasGlyphForCodePoint(0x20)
      } catch {
        return false
      }
    }
    return this.supports(f, ch)
  }

  /** Characters of `text` that `f` can't draw. */
  private missing(f: FontFamily, text: string) {
    return [...new Set(text)].filter(c => c !== '\n' && c !== '\r' && this.hasChar(f, c) === false).join('')
  }

  /**
   * Font for the characters an element's own font lacks (often a subset font embedded in the PDF), or null if it has them all.
   * Only those characters switch font, so the rest of the text keeps its look and position.
   */
  fallbackOf(fontKey: string | undefined, text: string, fallbackKey?: string): FontFamily | null {
    const f = this.get(fontKey)
    const missing = this.missing(f, text)
    if (!missing) return null
    for (const k of [fallbackKey, 'lib:arimo']) {
      if (!k || k === f.key || !this.fams.has(k)) continue
      const c = this.fams.get(k)!
      // best-effort: this result is re-checked (and, for exportPdf/autoReplace, awaited) once it
      // loads; a failure here (e.g. a malformed system font) must not become an unhandled rejection
      if (this.supports(c, missing) === undefined) void this.load(k).catch(() => {})
      if (this.supports(c, missing) !== false) return c
    }
    return null
  }

  /** Splits one line into pieces drawn with the main font or the fallback. */
  segments(f: FontFamily, fallback: FontFamily | null, line: string) {
    const out: { fam: FontFamily; text: string }[] = []
    for (const ch of line) {
      const fam = fallback && this.hasChar(f, ch) === false ? fallback : f
      const last = out[out.length - 1]
      if (last?.fam === fam) last.text += ch
      else out.push({ fam, text: ch })
    }
    return out
  }

  async load(key: string, variant: Variant = 0) {
    const f = this.fams.get(key)
    if (!f || f.standard) return
    const v = this.pick(f, !!(variant & 1), !!(variant & 2)).variant
    const id = `${key}:${v}`
    if (!this.loading.has(id)) {
      const p = this.doLoad(f, v)
        .catch(err => {
          // forget failures (e.g. a dropped connection) so the next attempt retries
          this.loading.delete(id)
          throw err
        })
        .finally(() => this.emit())
      this.loading.set(id, p)
    }
    return this.loading.get(id)
  }

  private async doLoad(f: FontFamily, v: Variant) {
    const src = f.sources[v]!
    const bytes = await this.bytesOf(src)
    if (!f.glyphs || v === 0) {
      const parsed = parse(bytes, src.postscriptName)
      f.glyphs = parsed
      Object.assign(f, metricsOf(parsed))
    }
    if ((f.group === 'library' || f.group === 'uploaded') && !src.displayed) {
      const face = new FontFace(f.css.replace(/"/g, ''), bytes.slice().buffer, { weight: v & 1 ? '700' : '400', style: v & 2 ? 'italic' : 'normal' })
      await face.load()
      document.fonts.add(face)
      src.displayed = true
    }
  }

  private async bytesOf(src: FaceSource) {
    if (!src.bytes) {
      if (src.getBytes) src.bytes = await src.getBytes()
      else src.bytes = new Uint8Array(await (await fetch(src.url!)).arrayBuffer())
    }
    return src.bytes
  }

  async faceBytes(f: FontFamily, v: Variant) {
    const src = f.sources[v]!
    return { bytes: await this.bytesOf(src), postscriptName: src.postscriptName }
  }

  /** Finds the closest available family for a font name used in a PDF. */
  /**
   * `allowSystem` lets a caller that doesn't want *any* dependence on the Local Font Access API
   * (the batch Translate/Fix-grammar tools, via autoReplace.ts) opt out of it entirely: without it,
   * a document whose own font happens to share a name with one of the user's installed system fonts
   * (this is common — "Arial", "ArialNarrow", etc.) would silently pick that system font for ordinary
   * Latin text too, not just CJK. System fonts are real files of unpredictable internal structure,
   * and subsetting/embedding one has — independent of script — triggered an internal fontkit "buffer
   * length" crash during the final whole-document PDF save, a point no per-element error handling can
   * isolate. The interactive editor still allows it (default): there, it's only ever reached by the
   * user's own explicit choice in the font picker, where a bad result is visible and fixable.
   */
  match(pdfFontName: string, text = '', hint: FontCategory = 'sans', allowSystem = true) {
    const clean = pdfFontName.replace(/^[A-Z]{6}\+/, '')
    const full = norm(clean.split(/[-,]/)[0])
    // try "SourceSansPro" as-is before stripping suffixes like PSMT/Pro/Std
    const names = [...new Set([full, full.replace(/(psmt|mt|ps|std|pro|lt|regular)$/, '')])]
    const cjk = needsCjk(text)
    // CJK has no bundled fallback at all. cjkSystemCandidates() (tried by the caller, autoReplace.ts,
    // before falling back to this) is the real way one gets picked; nothing here can verify a system
    // font actually has the right glyphs by name alone, so this just keeps CJK out of the ordinary
    // name-matching below (a PDF's own font name never hints at CJK coverage anyway).
    const candidates = this.list().filter(f => f.group !== 'document' && (allowSystem || f.group !== 'system') && !(cjk && f.group === 'system'))
    const byName =
      candidates.find(f => f.group === 'system' && Object.values(f.sources).some(s => s?.postscriptName === clean)) ??
      candidates.find(f => f.group === 'system' && names.includes(norm(f.label))) ??
      candidates.find(f => f.group === 'standard' && !cjk && names.some(n => f.aliases.includes(n))) ??
      candidates.find(f => f.aliases.some(a => names.includes(a))) ??
      candidates.find(f => f.aliases.some(a => a.length > 3 && names.some(n => n.startsWith(a))))
    if (byName) return byName.key
    return hint === 'serif' ? 'times' : hint === 'mono' ? 'courier' : 'helvetica'
  }

  /** Registers a font embedded in the open PDF (as decoded by pdf.js). */
  registerDocFont(info: { loadedName: string; name: string; data?: Uint8Array; bold: boolean; italic: boolean; category: FontCategory }) {
    const key = `doc:${info.loadedName}`
    if (this.fams.has(key)) return key
    if (!info.data) return null
    let glyphs: FkFont
    try {
      glyphs = parse(info.data)
    } catch {
      return null
    }
    const label = info.name
      .replace(/^[A-Z]{6}\+/, '')
      .replace(/-\d{3,}$/, '')
      .replace(/[-_,]/g, ' ')
    this.fams.set(key, {
      key,
      label,
      group: 'document',
      category: info.category,
      css: `"${info.loadedName}"`,
      aliases: [],
      sources: { [variantOf(info.bold, info.italic)]: { bytes: info.data } },
      glyphs,
      ...metricsOf(glyphs),
      intrinsicStyle: true,
    })
    this.emit()
    return key
  }

  clearDocFonts() {
    for (const k of [...this.fams.keys()]) if (k.startsWith('doc:')) this.fams.delete(k)
    this.emit()
  }

  async addSystemFonts() {
    const fonts = await window.queryLocalFonts!()
    const byFamily = new Map<string, LocalFontData[]>()
    for (const f of fonts) byFamily.set(f.family, [...(byFamily.get(f.family) ?? []), f])
    for (const [family, faces] of byFamily) {
      const key = `sys:${family}`
      if (this.fams.has(key)) continue
      const sources: FontFamily['sources'] = {}
      // prefer the plainest face for each variant ("Regular" over "Medium", "Bold" over "Heavy")
      const rank = (s: string) => (/^(regular|roman|book|normal|bold|italic|bold italic|oblique|bold oblique)$/i.test(s) ? 0 : 1)
      for (const face of [...faces].sort((a, b) => rank(a.style) - rank(b.style))) {
        const v = styleVariant(face.style)
        if (sources[v]) continue
        if (v === 0 && /light|thin|medium|semi|demi|black|heavy|condensed|narrow/i.test(face.style)) continue
        sources[v] = { postscriptName: face.postscriptName, getBytes: async () => new Uint8Array(await (await face.blob()).arrayBuffer()) }
      }
      if (!sources[0]) {
        const f0 = faces[0]
        sources[0] = { postscriptName: f0.postscriptName, getBytes: async () => new Uint8Array(await (await f0.blob()).arrayBuffer()) }
      }
      const n = norm(family)
      const category: FontCategory = /mono|courier|consol|menlo|code/.test(n) ? 'mono' : /serif|times|song|mincho|ming|georgia|garamond/.test(n) && !/sans/.test(n) ? 'serif' : 'sans'
      this.fams.set(key, { key, label: family, group: 'system', category, css: `"${family}"`, aliases: [n], sources })
    }
    this.systemLoaded = true
    this.emit()
  }

  async addUploaded(files: File[]) {
    let firstKey: string | null = null
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const magic = String.fromCharCode(...bytes.slice(0, 4))
      // HarfBuzz (used when saving) only reads raw TrueType/OpenType data
      if (magic === 'wOFF' || magic === 'wOF2') throw new Error(`"${file.name}" is a web font (WOFF). Please use the .ttf or .otf version.`)
      let parsed: FkFont
      try {
        parsed = parse(bytes)
      } catch (e) {
        throw new Error(`"${file.name}" can't be used: ${e instanceof Error ? e.message : 'not a font file'}`)
      }
      const family = parsed.familyName || file.name.replace(/\.[^.]+$/, '')
      const key = `up:${norm(family)}`
      const fam: FontFamily = this.fams.get(key) ?? { key, label: family, group: 'uploaded', category: 'sans', css: `"up-${uid()}"`, aliases: [norm(family)], sources: {} }
      const style = parsed.subfamilyName ?? ''
      const v = styleVariant(style)
      // in a multi-weight upload, Light/Medium/etc. must not take the place of the plain face
      const plain = /^(regular|book|normal|roman|bold|italic|bold italic|oblique|bold oblique)$/i.test(style.trim())
      if (fam.sources[v] && !plain) continue
      fam.sources[v] = { bytes }
      this.loading.delete(`${key}:${v}`)
      if (v === 0 || !fam.glyphs) {
        fam.glyphs = parsed
        Object.assign(fam, metricsOf(parsed))
      }
      this.fams.set(key, fam)
      await this.load(key, v)
      firstKey ??= key
    }
    this.emit()
    return firstKey
  }
}

export const fontRegistry = new FontRegistry()

export function useFontRegistry() {
  useSyncExternalStore(fontRegistry.subscribe, () => fontRegistry.version)
  return fontRegistry
}

/** Distance from the top of a text box to the first baseline, as a fraction of font size. */
export const baselineOffset = (f: FontFamily, lineHeight: number) => {
  const a = f.ascent ?? 0.9
  const d = f.descent ?? 0.22
  return (lineHeight - (a + d)) / 2 + a
}

export class FontEmbedder {
  private cache = new Map<string, PDFFont>()
  private pdf: PDFDocument

  constructor(pdf: PDFDocument) {
    this.pdf = pdf
    pdf.registerFontkit(fontkit)
  }

  async get(f: FontFamily, bold = false, italic = false) {
    const { variant, fakeBold, fakeItalic } = fontRegistry.pick(f, bold, italic)
    const key = `${f.key}:${variant}`
    let font = this.cache.get(key)
    if (!font) {
      try {
        if (f.standard) font = await this.pdf.embedFont(f.standard[variant])
        else {
          // No subsetting, ever: confirmed in isolation (plain Node, no browser, no PDF) that
          // HarfBuzz's subsetter can reliably corrupt its own output (a malformed last glyph) for an
          // entirely ordinary range of characters, surfacing later as fontkit's "buffer length" crash
          // during the one whole-document save step no per-element try/catch can isolate. The full,
          // un-subset file has always swept glyph-by-glyph clean in every font tested. The cost is a
          // bigger embedded font than a reduced glyph set would need — worth it for never corrupting.
          const { bytes } = await fontRegistry.faceBytes(f, variant)
          font = await this.pdf.embedFont(bytes, { subset: false })
        }
      } catch (e) {
        throw new Error(`Font "${key}" failed to embed: ${e instanceof Error ? e.message : String(e)}`)
      }
      this.cache.set(key, font)
    }
    return { font, fakeBold, fakeItalic }
  }
}

/** Draws text with optional simulated bold (fill + outline) for fonts without a bold face. */
export function drawStyledText(page: PDFPage, text: string, opts: Parameters<PDFPage['drawText']>[1] & { color: Color; size: number }, fakeBold: boolean) {
  if (!fakeBold) return page.drawText(text, opts)
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.FillAndOutline), setLineWidth(opts.size * 0.035), setStrokingColor(opts.color))
  if (opts.opacity !== undefined && opts.opacity < 1) {
    // drawText's opacity only covers the fill; the simulated-bold outline needs a matching stroke opacity
    const ctx = page.doc.context
    const gs = page.node.newExtGState('GS', ctx.register(ctx.obj({ Type: 'ExtGState', CA: opts.opacity })))
    page.pushOperators(setGraphicsState(gs))
  }
  page.drawText(text, opts)
  page.pushOperators(popGraphicsState())
}
