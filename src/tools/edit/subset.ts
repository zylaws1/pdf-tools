import wasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url'

// pdf-lib's own subsetter (an old fontkit fork) corrupts many modern fonts, so fonts are subset with HarfBuzz instead

interface HbExports {
  memory: WebAssembly.Memory
  malloc(n: number): number
  free(p: number): void
  hb_blob_create(data: number, len: number, mode: number, user: number, destroy: number): number
  hb_blob_destroy(blob: number): void
  hb_blob_get_data(blob: number, lenPtr: number): number
  hb_blob_get_length(blob: number): number
  hb_face_create(blob: number, index: number): number
  hb_face_destroy(face: number): void
  hb_face_reference_blob(face: number): number
  hb_set_add(set: number, cp: number): void
  hb_subset_input_create_or_fail(): number
  hb_subset_input_destroy(input: number): void
  hb_subset_input_unicode_set(input: number): number
  hb_subset_or_fail(face: number, input: number): number
}

const HB_MEMORY_MODE_WRITABLE = 2
let hb: Promise<HbExports> | null = null

const instance = () =>
  (hb ??= fetch(wasmUrl)
    .then(r => r.arrayBuffer())
    .then(buf => WebAssembly.instantiate(buf))
    .then(r => r.instance.exports as unknown as HbExports))

/** Returns a standalone font containing only the given code points (plus whatever layout features need). */
export async function subsetFont(bytes: Uint8Array, codePoints: Iterable<number>, faceIndex = 0) {
  const e = await instance()
  const ptr = e.malloc(bytes.length)
  new Uint8Array(e.memory.buffer).set(bytes, ptr)
  const blob = e.hb_blob_create(ptr, bytes.length, HB_MEMORY_MODE_WRITABLE, 0, 0)
  const face = e.hb_face_create(blob, faceIndex)
  e.hb_blob_destroy(blob)
  const input = e.hb_subset_input_create_or_fail()
  const set = e.hb_subset_input_unicode_set(input)
  for (const cp of codePoints) e.hb_set_add(set, cp)
  const sub = e.hb_subset_or_fail(face, input)
  e.hb_subset_input_destroy(input)
  let out = new Uint8Array()
  if (sub) {
    const res = e.hb_face_reference_blob(sub)
    const off = e.hb_blob_get_data(res, 0)
    // read through a fresh view: wasm memory may have grown during subsetting
    out = new Uint8Array(e.memory.buffer, off, e.hb_blob_get_length(res)).slice()
    e.hb_blob_destroy(res)
    e.hb_face_destroy(sub)
  }
  e.hb_face_destroy(face)
  e.free(ptr)
  if (!out.length) throw new Error('This font could not be prepared for embedding.')
  return out
}
