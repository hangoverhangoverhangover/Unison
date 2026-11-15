export interface ByteRange {
  start: number
  /** Inclusive. */
  end: number
}

/**
 * Parse a single-range `Range` header against a file size.
 * Returns null when there is no header (serve the whole file), a range to
 * serve with 206, or 'unsatisfiable' for anything malformed or out of bounds (416).
 */
export function parseRange(
  header: string | null | undefined,
  size: number
): ByteRange | null | 'unsatisfiable' {
  if (header == null) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '') || size <= 0) return 'unsatisfiable'
  const [, a = '', b = ''] = m
  if (a === '') {
    const suffix = Number(b)
    if (suffix === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(a)
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  if (start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}
