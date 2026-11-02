// Files dropped on the home page, handed to the tool that opens next.
let pending: File[] | null = null

export const setPendingFiles = (files: File[]) => {
  pending = files
}

export const takePendingFiles = () => {
  const files = pending
  pending = null
  return files
}
