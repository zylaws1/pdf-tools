import { uid, type PdfFile } from '../../lib/pdf'
import { defaultsFor, type El, type Kind } from './model'
import { fontRegistry, baselineOffset, needsCjk, variantOf, type Variant } from './fonts'
import { sampleColors, colorGroups, type TextRun } from './textRuns'

/**
 * There's no bundled CJK font, so the only way to draw CJK text is a system font — but a name match
 * alone doesn't mean one actually has the right glyphs (seen: a Korean-only font winning a Chinese
 * search just by sorting first in the installed-fonts list). Tries each script-appropriate candidate
 * in order, actually loading and checking supports() before committing to one, instead of guessing once.
 */
async function pickCjkFont(newText: string, variant: Variant): Promise<string | null> {
  for (const candidate of fontRegistry.cjkSystemCandidates(newText)) {
    await fontRegistry.load(candidate.key, variant).catch(() => {})
    if (fontRegistry.supports(candidate, newText)) return candidate.key
  }
  return null
}

const el = (page: number, kind: Kind, props: Partial<El>): El => ({ id: uid(), page, kind, x: 0, y: 0, w: 0, h: 0, opacity: 1, ...defaultsFor(kind), ...props })

/** Tags a font-loading failure with which font it was, since the underlying error (e.g. a fontkit parser bug) doesn't say. */
async function loadFont(key: string, variant: Variant) {
  try {
    await fontRegistry.load(key, variant)
  } catch (e) {
    throw new Error(`Font "${key}" failed to load: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Builds the whiteout + text element that replace one run with new text, in its original
 * position, font and color — same mechanics as the editor's click-to-edit, but for text that's
 * already decided (translated or grammar-fixed) rather than typed live. Unlike the editor's
 * per-click flow, a run that mixes colors collapses to its dominant color here: the per-character
 * color lookup that splits mixed-color lines only matches the *original* text's characters, and a
 * translation or correction doesn't share those positions. The font size shrinks (down to a floor)
 * if the new text would be wider than the original at full size — translations are rarely the same length.
 *
 * Throws if no available font can draw the new text at all (e.g. translating into a script, such as
 * CJK, that no bundled or system font covers) rather than building elements `exportPdf` would later
 * reject — callers should catch this per run and leave that line as it was.
 *
 * Unlike the editor's click-to-edit flow, this never reuses the PDF's own embedded font (run.docFont)
 * for the new text, even when its glyph coverage looks sufficient: a PDF-embedded subset font that's
 * inconsistently built (e.g. a cmap entry pointing at a glyph the pruned glyf/loca tables no longer
 * have) can report that it supports characters it actually can't safely be asked to render, and the
 * resulting crash — during the final whole-document PDF save, which can't be isolated to one element —
 * has been seen in production. Always matching a bundled/standard font instead means replacement text
 * only ever touches fonts this app ships and has control over.
 */
export async function buildReplacement(file: PdfFile, page: number, run: TextRun, newText: string): Promise<El[]> {
  const variant = variantOf(run.bold, run.italic)
  // match the font against the *new* text, not the original — a translation often needs a different
  // script. CJK is tried first and separately: there's no bundled fallback for it at all, so a system
  // font, verified to actually work, is the only option — see the allowSystem note on match() for why
  // ordinary (non-CJK) text never considers one here.
  const fontKey = (needsCjk(newText) && (await pickCjkFont(newText, variant))) || fontRegistry.match(run.pdfFontName, newText, run.category, false)
  await loadFont(fontKey, variant)
  const fam = fontRegistry.get(fontKey)

  // confirm there's a font that can actually draw this text before committing to it (same
  // load-then-recheck as exportPdf, since a fallback candidate may still be loading)
  let fallback = fontRegistry.fallbackOf(fontKey, newText)
  for (let i = 0; fallback && i < 3; i++) {
    await loadFont(fallback.key, variant)
    const next = fontRegistry.fallbackOf(fontKey, newText)
    if (next === fallback) break
    fallback = next
  }
  if (fontRegistry.supports(fam, newText) === false && !fallback) {
    throw new Error(`No available font can display "${newText.length > 40 ? newText.slice(0, 40) + '…' : newText}"`)
  }

  const { bg } = await sampleColors(file.doc, page + 1, run)

  const ctx = document.createElement('canvas').getContext('2d')!
  const weight = fontRegistry.cssStyle(fam, run.bold, run.italic).fontWeight
  ctx.font = `${weight} 100px ${fam.css}, sans-serif`
  const groups = await colorGroups(file.doc, page + 1, run, ch => ctx.measureText(ch).width)
  const dominant = groups.reduce((a, b) => (b.str.length > a.str.length ? b : a), groups[0])

  ctx.font = `${weight} ${run.size}px ${fam.css}, sans-serif`
  const width = ctx.measureText(newText).width || 1
  const size = Math.round((width > run.w ? Math.max(run.size * 0.55, (run.size * run.w) / width) : run.size) * 10) / 10

  return [
    el(page, 'whiteout', { x: run.x - 1, y: run.y, w: run.w + 2, h: run.h, fill: bg, opacity: 1, srcRun: run.id }),
    el(page, 'text', {
      x: run.x,
      y: run.baseline - size * baselineOffset(fam, 1.2),
      text: newText,
      size,
      font: fontKey,
      fallbackFont: fallback?.key,
      bold: run.bold,
      italic: run.italic,
      underline: false,
      align: 'left',
      lineHeight: 1.2,
      color: dominant?.color ?? '#000000',
      opacity: dominant?.opacity ?? 1,
      srcRun: run.id,
    }),
  ]
}
