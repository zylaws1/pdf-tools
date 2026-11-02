# PDF Tools

Personal iLovePDF-style PDF toolkit. Everything runs in the browser — files are never uploaded.

Tools: Merge, Split, Organize (reorder/rotate/delete pages), Edit, Image→PDF (JPG/PNG/WebP…), PDF→Image (JPG/PNG).

## Edit PDF

- **Edit existing text** — click any text in the PDF; it is covered with the sampled background color and replaced by an editable copy matching font family, weight, size and color.
- **Insert signature** (WPS-style) — draw (smooth, speed/pressure-sensitive pen, 3 ink colors), type your name in handwriting fonts, or upload a photo/scan with automatic white-background removal; signatures can be saved in the browser for one-click reuse; a preview follows the cursor until placed; "Place on all pages" for initials.
- **Add** text, images (or paste one from the clipboard), freehand drawing, rectangles, ellipses, lines, arrows, whiteout and highlights.
- **Fonts** — searchable picker with live previews:
  - *In this PDF*: the document's own embedded fonts; edits reuse them and fall back to the closest full font when a subset lacks a character.
  - *Standard*: Helvetica/Times/Courier (not embedded, smallest files).
  - *Library* (35+ bundled, loaded on demand): metric-compatible stand-ins for Arial/Helvetica (Arimo), Times New Roman (Tinos), Courier New (Cousine), Calibri (Carlito), Cambria (Caladea); popular sans/serif/mono families; handwriting fonts for signatures. Chinese/Japanese/Korean fonts are not bundled (to keep the build small) — use the PDF's own font, an installed font or an upload.
  - *On this computer*: every installed font via the Local Font Access API (Chrome/Edge, asks permission), including .ttc collections.
  - *Uploaded*: any .ttf/.otf/.woff files; bold/italic files of one family are grouped.
  - Missing bold/italic styles are simulated; text in scripts the font can't draw switches to a suitable font automatically.
  - Fonts are subset with HarfBuzz (WebAssembly) so saved PDFs only carry the glyphs used.
- **Text styling** — bold, italic, underline, alignment, line spacing, color, opacity.
- **Layers panel** — every item listed per page; select, drag to reorder, hide, lock; bring forward/send back.
- **Fill forms** — PDF form fields are listed in the sidebar, optionally flattened on save.
- Undo/redo, duplicate, copy/paste, zoom, precise X/Y/W/H.

Shortcuts: V select · E edit text · T text · S signature · I image · P draw · R rect · O ellipse · L line · A arrow · W whiteout · H highlight ·
Ctrl/⌘+Z / Shift+Ctrl/⌘+Z undo/redo · Ctrl/⌘+D duplicate · Ctrl/⌘+C/V copy/paste · Ctrl/⌘+[ / ] layer order · arrows nudge (Shift ×10) · Enter edit text · Del delete · Esc deselect.

## Develop

Requires Node.js 20+.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
npm run preview  # serve the built dist/ locally to check it
```

## Deploy

The app is a fully static site — there is no backend. Deploy the contents of `dist/` to any static host:

- **Cloudflare Pages** (production: `https://pdf.vber-ai.com`): connect the GitHub repo, framework preset *Vite* / build command `npm run build`, output directory `dist`. Node version comes from `.nvmrc`. `public/_headers` sets caching and only lets `https://ai-document.vber-ai.com` embed the editor — update it if that address changes. Vercel/Netlify work the same way (the whole build is ~40 MB; the largest file is under 2 MB).
- **Your own server (nginx/Apache/IIS)**: copy `dist/` into the web root, or a sub-folder — asset paths are relative, so `/pdf/` works too. No rewrite rules are needed (routing uses `#/…` URLs).
- **With AI Document**: set ai-document's `PDF_EDITOR_URL` to this app's address. AI Document opens `#/edit?file=<id>&api=<ai-document origin>&token=<file-edit token>&embed=1` (full-screen inside its dashboard, or in a tab); the editor loads the file and **Save to folder** posts a new version to ai-document's `/api/editor` endpoints with that short-lived, single-file token, which is moved out of the address bar on load (see `src/tools/edit/libraryLink.ts`). Without `?file=` the tool works standalone as usual.

Notes:
- Serve over **HTTPS** (or localhost) — the "fonts on this computer" feature needs a secure context.
- Cache-friendly: everything in `dist/assets/` has a content hash in its name and can be cached for a year; don't cache `index.html` long.

Built with React + Vite, [pdf-lib](https://pdf-lib.js.org) + fontkit (writing PDFs), [HarfBuzz](https://github.com/harfbuzz/harfbuzzjs) (font subsetting), [pdf.js](https://mozilla.github.io/pdf.js/) (rendering, text detection), fflate (zip downloads) and Google Fonts via `@expo-google-fonts/*` (OFL/Apache licensed).

Bundled fonts are only downloaded when chosen.

Known limits: "edit existing text" replaces text visually (the original stays underneath the cover, so it is still selectable/searchable); added items are flattened into the page on save and can't be re-opened as layers later.
