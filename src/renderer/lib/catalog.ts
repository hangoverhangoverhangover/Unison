import type { Album, AlbumType } from '@shared/types'

export const ALBUM_TYPE_LABEL: Record<AlbumType, string> = {
  album: 'Album',
  single: 'Single',
  ep: 'EP',
  compilation: 'Compilation',
  playlist: 'Playlist'
}

/** "2026" from "2026-03-27" / "2026-03-27T00:00:00Z" / "2026". */
export function releaseYear(date: string | undefined): string | undefined {
  const m = date?.match(/^(\d{4})/)
  return m?.[1]
}

/** "March 27, 2026" when the date has a day, else the year. */
export function releaseDateLong(date: string | undefined): string | undefined {
  if (!date) return undefined
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return releaseYear(date)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  })
}

/** Card caption under a release cover: "Single, 2026". */
export function releaseCaption(a: Album): string {
  const year = releaseYear(a.releaseDate)
  return year ? `${ALBUM_TYPE_LABEL[a.type]}, ${year}` : ALBUM_TYPE_LABEL[a.type]
}

/** Discography filter: albums vs singles and EPs (compilations go with albums). */
export function isAlbumLike(a: Album): boolean {
  return a.type === 'album' || a.type === 'compilation'
}
