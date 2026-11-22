// Player page (QoL 4): your own pictures and videos behind the playing song, each for
// every song, one artist or one album.
import type { Track } from './types'

export type PlayerMediaScope =
  | { type: 'all' }
  | { type: 'artist'; name: string }
  | { type: 'album'; name: string; artist?: string }

export interface PlayerMedia {
  /** 40 hex characters; the file is player-media/<id>.<ext>. */
  id: string
  kind: 'image' | 'video'
  ext: string
  /** Original file name, for the list in Settings. */
  name: string
  size: number
  scope: PlayerMediaScope
  addedAt: number
}

export const PLAYER_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const
export const PLAYER_VIDEO_EXTS = ['mp4', 'webm'] as const

export function playerMediaUrl(m: Pick<PlayerMedia, 'id'>): string {
  return `media://player/${m.id}`
}

const key = (s: string): string =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * What can show for this song, best first: album matches, then artist matches, then
 * the ones for every song. Empty when nothing fits.
 */
export function mediaFor(items: readonly PlayerMedia[], track: Track | null): PlayerMedia[] {
  if (!track) return items.filter((m) => m.scope.type === 'all')
  const artists = new Set(track.artists.map(key))
  const album = track.album ? key(track.album) : ''
  const albums: PlayerMedia[] = []
  const byArtist: PlayerMedia[] = []
  const all: PlayerMedia[] = []
  for (const m of items) {
    const s = m.scope
    if (s.type === 'album') {
      if (album && key(s.name) === album && (!s.artist || artists.has(key(s.artist))))
        albums.push(m)
    } else if (s.type === 'artist') {
      if (artists.has(key(s.name))) byArtist.push(m)
    } else all.push(m)
  }
  return albums.length ? albums : byArtist.length ? byArtist : all
}

/** One of the matches, the same one for the whole song (changes with the next song). */
export function pickFor(matches: readonly PlayerMedia[], trackId: string): PlayerMedia | null {
  if (matches.length === 0) return null
  let h = 0
  for (const c of trackId) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return matches[h % matches.length]!
}

/** Artist details for the Player page (from Last.fm and the service). */
export interface ArtistInfo {
  name: string
  bio?: string
  tags?: string[]
  listeners?: number
  imageUrl?: string
  links: { label: string; url: string }[]
}
