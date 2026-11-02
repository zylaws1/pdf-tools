// Integration with ai-document's client folders. ai-document opens this app (embedded or in a tab) with
// "#/edit?file=<id>&api=<ai-document origin>&token=<file-edit token>[&embed=1]"; the file is loaded and
// saved through ai-document's /api/editor endpoints with that token. Without ?file= the app is standalone.

export interface LibraryLink {
  fileId: string
  api: string
  token: string
  embedded: boolean
}

const storageKey = (fileId: string) => `library-link:${fileId}`

/** Reads the link once; the token moves to sessionStorage and out of the address bar so it isn't copied or shared. */
export function readLibraryLink(): LibraryLink | null {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const fileId = params.get('file')
  if (!fileId) return null
  const embedded = params.get('embed') === '1' || window.parent !== window
  let api = params.get('api') ?? ''
  let token = params.get('token') ?? ''
  if (api && token) {
    sessionStorage.setItem(storageKey(fileId), JSON.stringify({ api, token }))
    window.history.replaceState(null, '', `#/edit?file=${encodeURIComponent(fileId)}${embedded ? '&embed=1' : ''}`)
  } else {
    const saved = sessionStorage.getItem(storageKey(fileId))
    if (saved) ({ api, token } = JSON.parse(saved) as { api: string; token: string })
  }
  try {
    api = /^https?:\/\//.test(api) ? new URL(api).origin : ''
  } catch {
    api = ''
  }
  return { fileId, api, token, embedded }
}

/** True when the page was opened as ai-document's embedded editor (no site chrome). */
export const isEmbedded = () => /[?&]embed=1\b/.test(window.location.hash) || window.parent !== window

function endpoint(link: LibraryLink, path: string) {
  if (!link.api || !link.token) throw new Error('This edit link is incomplete. Open the file again from its folder in AI Document.')
  return `${link.api}/api/editor/files/${encodeURIComponent(link.fileId)}${path}`
}

async function failure(res: Response, action: string) {
  if (res.status === 401) return new Error('This edit link has expired. Open the file again from its folder in AI Document.')
  const body = await res.json().catch(() => null)
  return new Error(body?.error || `Couldn't ${action} (error ${res.status}).`)
}

function filenameFrom(disposition: string | null) {
  if (!disposition) return null
  const star = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (star) return decodeURIComponent(star[1])
  return disposition.match(/filename="([^"]+)"/i)?.[1] ?? null
}

export async function fetchLibraryFile(link: LibraryLink) {
  const res = await fetch(endpoint(link, '/content'), { headers: { Authorization: `Bearer ${link.token}` } })
  if (!res.ok) throw await failure(res, 'open the file')
  const name = filenameFrom(res.headers.get('content-disposition')) ?? 'document.pdf'
  if (!/pdf/.test(res.headers.get('content-type') ?? '') && !/\.pdf$/i.test(name)) throw new Error(`"${name}" isn't a PDF, so it can't be edited here.`)
  return new File([await res.blob()], name, { type: 'application/pdf' })
}

export async function saveLibraryVersion(link: LibraryLink, bytes: Uint8Array, name: string) {
  const form = new FormData()
  form.append('file', new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name)
  form.append('note', 'Edited in PDF editor')
  const res = await fetch(endpoint(link, '/versions'), { method: 'POST', body: form, headers: { Authorization: `Bearer ${link.token}` } })
  if (!res.ok) throw await failure(res, 'save to the folder')
  notifyLibrary(link, { type: 'library:file-saved', fileId: link.fileId })
}

/** Messages the ai-document window that opened or embeds us; delivered only to that exact origin. */
export function notifyLibrary(link: LibraryLink, message: Record<string, unknown>) {
  if (!link.api) return
  const target = window.parent !== window ? window.parent : window.opener
  target?.postMessage(message, link.api)
}

export function leaveEditor(link: LibraryLink) {
  if (window.parent !== window) notifyLibrary(link, { type: 'library:close' })
  else window.close()
}
