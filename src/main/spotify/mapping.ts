// Spotify JSON -> shared domain types. Only the fields we read are typed.
import {
  trackId,
  type Album,
  type AlbumType,
  type Artist,
  type EntityRef,
  type LikedTrack,
  type Playlist,
  type Track
} from '@shared/types'

export interface SpImage {
  url: string
  width?: number | null
  height?: number | null
}

export interface SpTrack {
  id: string | null
  type?: string
  uri?: string
  name: string
  duration_ms: number
  is_local?: boolean
  artists?: SpArtistRef[]
  album?: SpAlbumRef
  external_ids?: { isrc?: string }
  external_urls?: { spotify?: string }
  track_number?: number
  disc_number?: number
}

export interface SpArtistRef {
  id?: string | null
  name: string
  external_urls?: { spotify?: string }
}

/** Album as embedded in a track (and the base of the full album object). */
export interface SpAlbumRef {
  id?: string | null
  name?: string
  images?: SpImage[]
  external_urls?: { spotify?: string }
  album_type?: string
  total_tracks?: number
  release_date?: string
  artists?: SpArtistRef[]
}

export interface SpAlbum extends SpAlbumRef {
  id: string
  copyrights?: { text?: string; type?: string }[]
  tracks?: { items?: (SpTrack | null)[]; next?: string | null; total?: number }
}

export interface SpArtist {
  id: string
  name?: string
  images?: SpImage[]
  external_urls?: { spotify?: string }
}

export interface SpSavedTrack {
  added_at: string
  track: SpTrack | null
}

export interface SpPlaylistItem {
  added_at?: string | null
  is_local?: boolean
  /** Current field (Feb 2026). */
  item?: SpTrack | null
  /** Deprecated name for `item`. */
  track?: SpTrack | null
}

export interface SpPlaylist {
  id: string
  name: string
  description?: string | null
  collaborative?: boolean
  images?: SpImage[] | null
  owner?: { id?: string; display_name?: string | null }
  /** Current field (Feb 2026). */
  items?: { total?: number } | null
  /** Deprecated name for `items`. */
  tracks?: { total?: number } | null
}

export const MAX_ART_PX = 640

/**
 * Largest image no wider than 640px. Images with unknown size (Spotify sends null
 * width/height for some playlist art) are used only if no sized image fits.
 */
export function pickImage(images: SpImage[] | null | undefined): string | undefined {
  const list = (images ?? []).filter((i) => i && typeof i.url === 'string' && i.url)
  if (list.length === 0) return undefined
  const size = (i: SpImage): number | undefined => i.width ?? i.height ?? undefined
  const fitting = list.filter((i) => {
    const s = size(i)
    return s !== undefined && s <= MAX_ART_PX
  })
  if (fitting.length > 0) return fitting.reduce((a, b) => (size(b)! > size(a)! ? b : a)).url
  const unsized = list.find((i) => size(i) === undefined)
  if (unsized) return unsized.url
  // Everything is bigger than 640: take the smallest.
  return list.reduce((a, b) => (size(b)! < size(a)! ? b : a)).url
}

/** Null for missing, local, episode or id-less items. */
export function mapTrack(raw: SpTrack | null | undefined): Track | null {
  if (!raw || raw.is_local || !raw.id) return null
  if (raw.type !== undefined && raw.type !== 'track') return null
  const track: Track = {
    id: trackId('spotify', raw.id),
    provider: 'spotify',
    nativeId: raw.id,
    title: raw.name ?? '',
    artists: (raw.artists ?? []).map((a) => a?.name).filter((n): n is string => !!n),
    durationMs: raw.duration_ms ?? 0
  }
  // Same filter as `artists`, so refs line up; any id-less artist drops all refs.
  const refs = (raw.artists ?? []).filter((a) => !!a?.name).map(artistRef)
  if (refs.length > 0 && !refs.includes(null)) track.artistRefs = refs as EntityRef[]
  if (raw.album?.name) track.album = raw.album.name
  const albumRef = mapAlbumRef(raw.album)
  if (albumRef) track.albumRef = albumRef
  track.url = raw.external_urls?.spotify || `https://open.spotify.com/track/${raw.id}`
  const art = pickImage(raw.album?.images)
  if (art) track.artworkUrl = art
  if (raw.external_ids?.isrc) track.isrc = raw.external_ids.isrc
  return track
}

/** Null when the artist has no id (then the track gets no refs, so order stays aligned). */
export function artistRef(raw: SpArtistRef | null | undefined): EntityRef | null {
  if (!raw?.id || !raw.name) return null
  return {
    id: trackId('spotify', raw.id),
    name: raw.name,
    url: raw.external_urls?.spotify || `https://open.spotify.com/artist/${raw.id}`
  }
}

export function mapAlbumRef(raw: SpAlbumRef | null | undefined): EntityRef | null {
  if (!raw?.id || !raw.name) return null
  return {
    id: trackId('spotify', raw.id),
    name: raw.name,
    url: raw.external_urls?.spotify || `https://open.spotify.com/album/${raw.id}`
  }
}

/** Singles with this many tracks or more are shown as EPs (a guess; see albumType). */
export const EP_MIN_TRACKS = 4

/**
 * Spotify has no EP type: its own client calls a "single" with roughly 4-6 tracks under
 * 30 minutes an EP. Only the track count is available here, so 4+ tracks = EP.
 */
export function albumType(raw: SpAlbumRef): AlbumType {
  const t = (raw.album_type ?? '').toLowerCase()
  if (t === 'compilation') return 'compilation'
  if (t === 'single') return (raw.total_tracks ?? 0) >= EP_MIN_TRACKS ? 'ep' : 'single'
  return 'album'
}

export function mapAlbum(raw: SpAlbumRef | null | undefined): Album | null {
  if (!raw?.id) return null
  const album: Album = {
    id: trackId('spotify', raw.id),
    provider: 'spotify',
    nativeId: raw.id,
    name: raw.name ?? '',
    type: albumType(raw),
    artists: (raw.artists ?? []).map(artistRef).filter((a): a is EntityRef => a !== null),
    trackCount: raw.total_tracks ?? 0,
    url: raw.external_urls?.spotify || `https://open.spotify.com/album/${raw.id}`
  }
  const art = pickImage(raw.images)
  if (art) album.artworkUrl = art
  if (raw.release_date) album.releaseDate = raw.release_date
  return album
}

export function mapArtist(raw: SpArtist | null | undefined): Artist | null {
  if (!raw?.id) return null
  const artist: Artist = {
    id: trackId('spotify', raw.id),
    provider: 'spotify',
    nativeId: raw.id,
    name: raw.name ?? '',
    url: raw.external_urls?.spotify || `https://open.spotify.com/artist/${raw.id}`
  }
  const img = pickImage(raw.images)
  if (img) artist.imageUrl = img
  return artist
}

/** `copyrights[].text`, prefixed with the C / P symbol unless the text already has it. */
export function mapCopyrights(raw: SpAlbum['copyrights']): string[] {
  const out: string[] = []
  for (const c of raw ?? []) {
    const text = c?.text?.trim()
    if (!text) continue
    const type = (c.type ?? '').toUpperCase()
    if (type === 'C' && !text.includes('©')) out.push(`© ${text}`)
    else if (type === 'P' && !text.includes('℗')) out.push(`℗ ${text}`)
    else out.push(text)
  }
  return out
}

export function mapSavedTrack(raw: SpSavedTrack | null): LikedTrack | null {
  if (!raw) return null
  const track = mapTrack(raw.track)
  return track ? { track, likedAt: raw.added_at } : null
}

export function mapPlaylistItem(raw: SpPlaylistItem | null): Track | null {
  if (!raw || raw.is_local) return null
  return mapTrack(raw.item ?? raw.track)
}

export function mapPlaylist(
  raw: SpPlaylist | null,
  currentUserId: string | undefined
): Playlist | null {
  if (!raw || !raw.id) return null
  const owned = !!currentUserId && raw.owner?.id === currentUserId
  const playlist: Playlist = {
    id: `spotify:${raw.id}`,
    source: 'spotify',
    nativeId: raw.id,
    name: raw.name ?? '',
    canEdit: owned || !!raw.collaborative
  }
  if (raw.description) playlist.description = raw.description
  const art = pickImage(raw.images)
  if (art) playlist.artworkUrl = art
  const owner = raw.owner?.display_name ?? raw.owner?.id
  if (owner) playlist.ownerName = owner
  const total = raw.items?.total ?? raw.tracks?.total
  if (typeof total === 'number') playlist.trackCount = total
  return playlist
}
