import type { Artist, Track } from '@shared/types'
import { filterTracks, fold } from './filter'

/** Alternate between lists (best of each first), keeping each list's own order. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  const longest = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]!)
    }
  }
  return out
}

export type TopResult = { kind: 'artist'; artist: Artist } | { kind: 'track'; track: Track } | null

/**
 * The search page's "Top result": an artist named exactly like the query (verified
 * ones first), else the first song, else the first artist.
 */
export function pickTopResult(query: string, artists: Artist[], tracks: Track[]): TopResult {
  const q = fold(query)
  const exact = artists.filter((a) => fold(a.name) === q)
  const best = exact.find((a) => a.verified) ?? exact[0]
  if (best) return { kind: 'artist', artist: best }
  if (tracks[0]) return { kind: 'track', track: tracks[0] }
  if (artists[0]) return { kind: 'artist', artist: artists[0] }
  return null
}

/** Local library matches (title, artists or album contain every word), at most `limit`. */
export function searchLocal(tracks: Track[], query: string, limit: number): Track[] {
  return filterTracks(tracks, query)?.tracks.slice(0, limit) ?? []
}
