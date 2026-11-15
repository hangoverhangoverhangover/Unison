// "Artist - Title" from a file name, for "fill tags from file names".

/** Separators between artist and title, earliest occurrence wins. */
const SEPARATORS = [' - ', ' – ', ' — '] as const // hyphen, en dash, em dash

/** Downloads are named `Artist - Title [123456].ext`; that trailing id is dropped. */
const TRAILING_ID = /\s*\[\d+\]\s*$/

export type FilenameParse = { artist: string; title: string } | { skipped: string }

/**
 * Split a file name (without extension) into artist and title on the first separator.
 * Conservative: only the bracketed numeric id is stripped; everything else is kept as is.
 */
export function parseFileName(fileName: string): FilenameParse {
  const name = fileName.replace(TRAILING_ID, '').trim()
  let at = -1
  let sepLength = 0
  for (const sep of SEPARATORS) {
    const i = name.indexOf(sep)
    if (i !== -1 && (at === -1 || i < at)) {
      at = i
      sepLength = sep.length
    }
  }
  if (at === -1) return { skipped: "No ' - ' in the file name" }
  const artist = name.slice(0, at).trim()
  const title = name.slice(at + sepLength).trim()
  if (!artist) return { skipped: 'Nothing before the dash' }
  if (!title) return { skipped: 'Nothing after the dash' }
  return { artist, title }
}
