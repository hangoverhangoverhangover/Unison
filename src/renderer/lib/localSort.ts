import type { Track } from '@shared/types'

export type LocalSort = 'unsorted' | 'artist' | 'album'

export const LOCAL_SORTS: { key: LocalSort; label: string }[] = [
  { key: 'unsorted', label: 'Unsorted' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' }
]

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
const cmp = (a: string | undefined, b: string | undefined): number => {
  // Missing values sort last.
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return collator.compare(a, b)
}

/**
 * Unsorted: file order (by path, so folders stay together). Artist: artist, then
 * album, then title. Album: album, then artist, then title. Returns a new array.
 */
export function sortLocal(tracks: Track[], by: LocalSort): Track[] {
  const out = [...tracks]
  if (by === 'unsorted') return out.sort((a, b) => cmp(a.localPath, b.localPath))
  if (by === 'artist') {
    return out.sort(
      (a, b) => cmp(a.artists[0], b.artists[0]) || cmp(a.album, b.album) || cmp(a.title, b.title)
    )
  }
  return out.sort(
    (a, b) => cmp(a.album, b.album) || cmp(a.artists[0], b.artists[0]) || cmp(a.title, b.title)
  )
}
