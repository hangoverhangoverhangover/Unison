import type { Track } from '@shared/types'

/** Lowercase, accents removed, punctuation folded to spaces. */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Tracks whose title, artists or album contain every word of the query, with their
 * positions in the full list (playlists remove by position).
 */
export function filterTracks(
  tracks: Track[],
  query: string
): { tracks: Track[]; positions: number[] } | null {
  const words = fold(query).split(' ').filter(Boolean)
  if (words.length === 0) return null
  const out: Track[] = []
  const positions: number[] = []
  tracks.forEach((t, i) => {
    const hay = fold(`${t.title} ${t.artists.join(' ')} ${t.album ?? ''}`)
    if (words.every((w) => hay.includes(w))) {
      out.push(t)
      positions.push(i)
    }
  })
  return { tracks: out, positions }
}
