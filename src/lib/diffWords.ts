export interface DiffToken {
  text: string
  type: 'same' | 'removed' | 'added'
}

/** Word-level diff (classic LCS) so a review UI can show exactly what changed, not just two whole strings. */
export function diffWords(a: string, b: string): { before: DiffToken[]; after: DiffToken[] } {
  const split = (s: string) => s.match(/\s+|[^\s]+/g) ?? []
  const A = split(a)
  const B = split(b)
  const n = A.length
  const m = B.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const before: DiffToken[] = []
  const after: DiffToken[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      before.push({ text: A[i], type: 'same' })
      after.push({ text: B[j], type: 'same' })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      before.push({ text: A[i], type: 'removed' })
      i++
    } else {
      after.push({ text: B[j], type: 'added' })
      j++
    }
  }
  while (i < n) {
    before.push({ text: A[i], type: 'removed' })
    i++
  }
  while (j < m) {
    after.push({ text: B[j], type: 'added' })
    j++
  }
  return { before, after }
}
