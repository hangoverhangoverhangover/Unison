// MusicProvider over the Spotify Web API. Endpoints per docs/research/spotify-web-api.md.
import type {
  CatalogProvider,
  MusicProvider,
  PlaylistCreator,
  PlaylistEditor,
  TrackLookup
} from '@shared/provider'
import { spotifyUri } from '@shared/spotify'
import type {
  Album,
  AlbumPage,
  Artist,
  ArtistPage,
  LikedTrack,
  Playlist,
  Track
} from '@shared/types'
import { SpotifyApiError, type SpotifyApi } from './api'
import {
  mapAlbum,
  mapArtist,
  mapCopyrights,
  mapPlaylist,
  mapPlaylistItem,
  mapSavedTrack,
  mapTrack,
  type SpAlbum,
  type SpAlbumRef,
  type SpArtist,
  type SpPlaylist,
  type SpPlaylistItem,
  type SpSavedTrack,
  type SpTrack
} from './mapping'

/** Description of playlists made by "copy a playlist to the other service". */
export const CREATED_PLAYLIST_DESCRIPTION = 'Copied with Unison'

/** `/me/library` and `/me/library/contains` accept at most 40 URIs per call. */
export const LIBRARY_BATCH = 40
export const PAGE_LIMIT = 50
export const SEARCH_LIMIT = 10
export const SEARCH_MAX_OFFSET = 1000
/** `POST`/`DELETE /playlists/{id}/items` take at most 100 items per call. */
export const PLAYLIST_EDIT_BATCH = 100

/** `GET /artists/{id}/albums` accepts at most 10 per page since Feb 2026. */
export const ARTIST_ALBUMS_LIMIT = 10
/** `GET /albums/{id}/tracks` page size. */
export const ALBUM_TRACKS_LIMIT = 50
/** Albums whose tracks are fetched at once by getArtistTracks. */
export const ALBUM_CONCURRENCY = 3
export const TOP_TRACKS_MAX = 10
/** `GET /me/following` page size (the endpoint's maximum). */
export const FOLLOWING_LIMIT = 50
/** Most followed artists read; stops paging there. */
export const FOLLOWING_MAX = 2000

export const FOLLOW_SCOPE_MESSAGE =
  'Log in to Spotify again (Settings) to show the artists you follow.'

/** The login lacks `user-follow-read` (saved before the app asked for it). */
export class SpotifyFollowScopeError extends Error {
  constructor() {
    super(FOLLOW_SCOPE_MESSAGE)
    this.name = 'SpotifyFollowScopeError'
  }
}

interface SpFollowingPage {
  artists?: {
    items?: (SpArtist | null)[]
    next?: string | null
    cursors?: { after?: string | null } | null
  }
}

/** Spotify ids are base62. Checking keeps arbitrary strings out of URIs and paths. */
const ID_RE = /^[A-Za-z0-9]+$/

export function assertSpotifyId(id: string, what = 'track'): void {
  if (typeof id !== 'string' || !ID_RE.test(id))
    throw new Error(`Invalid Spotify ${what} id: ${id}`)
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Runs `fn` over `items`, `limit` at a time; results keep the input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Newest first; undated releases last. Stable for equal dates. */
function byReleaseDesc(a: Album, b: Album): number {
  const x = a.releaseDate ?? ''
  const y = b.releaseDate ?? ''
  return x < y ? 1 : x > y ? -1 : 0
}

/** Disc then track number; tracks without numbers keep API order. */
function byTrackNumber(a: SpTrack, b: SpTrack): number {
  return (
    (a.disc_number ?? 0) - (b.disc_number ?? 0) || (a.track_number ?? 0) - (b.track_number ?? 0)
  )
}

/** Album tracks are simplified (no `album`): map them with the album filled in. */
function mapAlbumTracks(items: (SpTrack | null)[], album: SpAlbumRef): Track[] {
  const ref: SpAlbumRef = {
    id: album.id,
    name: album.name,
    images: album.images,
    external_urls: album.external_urls
  }
  return items
    .filter((t): t is SpTrack => !!t)
    .sort(byTrackNumber)
    .map((t) => mapTrack({ ...t, album: ref }))
    .filter((t): t is Track => t !== null)
}

export class SpotifyPlaylistUnreadableError extends Error {
  constructor() {
    super(
      "Spotify won't let this app read that playlist. In Development Mode, apps can only open playlists you own or collaborate on."
    )
    this.name = 'SpotifyPlaylistUnreadableError'
  }
}

export interface SpotifyProviderDeps {
  api: SpotifyApi
  /** Current user's Spotify `id` (for playlist ownership). */
  getUserId: () => Promise<string | undefined>
}

export class SpotifyProvider
  implements MusicProvider, PlaylistEditor, PlaylistCreator, CatalogProvider, TrackLookup
{
  /**
   * How `PUT`/`DELETE /me/library` wants its URIs. Learned on the first 400 and then
   * reused so we don't pay a failed request on every like.
   */
  private libraryMode: 'query' | 'body' = 'query'

  constructor(private readonly deps: SpotifyProviderDeps) {}

  private get api(): SpotifyApi {
    return this.deps.api
  }

  async search(query: string, page: number): Promise<Track[]> {
    const q = query.trim()
    if (!q) return []
    const offset = Math.max(0, Math.floor(page)) * SEARCH_LIMIT
    if (offset > SEARCH_MAX_OFFSET) return []
    const res = await this.api.get<{ tracks?: { items?: (SpTrack | null)[] } }>('/search', {
      q,
      type: 'track',
      limit: SEARCH_LIMIT,
      offset
    })
    return (res?.tracks?.items ?? []).map(mapTrack).filter((t): t is Track => t !== null)
  }

  /** `GET /search?type=artist`, best first (search returns at most 10 per type). */
  async searchArtists(query: string): Promise<Artist[]> {
    const q = typeof query === 'string' ? query.trim() : ''
    if (!q) return []
    const res = await this.api.get<{ artists?: { items?: (SpArtist | null)[] } }>('/search', {
      q,
      type: 'artist',
      limit: SEARCH_LIMIT
    })
    return (res?.artists?.items ?? [])
      .map(mapArtist)
      .filter((a): a is Artist => a !== null)
      .slice(0, SEARCH_LIMIT)
  }

  /**
   * Artists the user follows, sorted by name. `GET /me/following?type=artist` pages by
   * cursor (`after` = last artist id), 50 per page, stopping at FOLLOWING_MAX. Needs the
   * optional `user-follow-read` scope; a 403 about scopes becomes SpotifyFollowScopeError.
   */
  async getFollowedArtists(): Promise<Artist[]> {
    const seen = new Set<string>()
    const out: Artist[] = []
    let after: string | undefined
    for (;;) {
      let page: SpFollowingPage | undefined
      try {
        page = await this.api.get<SpFollowingPage>('/me/following', {
          type: 'artist',
          limit: FOLLOWING_LIMIT,
          after
        })
      } catch (err) {
        if (
          err instanceof SpotifyApiError &&
          err.status === 403 &&
          /scope/i.test(`${err.spotifyMessage ?? ''} ${err.message}`)
        )
          throw new SpotifyFollowScopeError()
        throw err
      }
      const items = page?.artists?.items ?? []
      for (const raw of items) {
        const artist = mapArtist(raw)
        if (!artist || seen.has(artist.id)) continue
        seen.add(artist.id)
        out.push(artist)
        if (out.length >= FOLLOWING_MAX) break
      }
      const next = page?.artists?.cursors?.after
      if (
        out.length >= FOLLOWING_MAX ||
        items.length === 0 ||
        !page?.artists?.next ||
        !next ||
        next === after
      )
        break
      after = next
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }

  /** All saved tracks, newest first (`GET /me/tracks` is already in that order). */
  async getLikes(): Promise<LikedTrack[]> {
    const items = await this.api.getAllPages<SpSavedTrack>('/me/tracks', { limit: PAGE_LIMIT })
    const likes = items.map(mapSavedTrack).filter((l): l is LikedTrack => l !== null)
    // Stable sort keeps API order for equal timestamps.
    return likes.sort((a, b) => (a.likedAt < b.likedAt ? 1 : a.likedAt > b.likedAt ? -1 : 0))
  }

  async like(track: Track): Promise<void> {
    return this.writeLibrary('PUT', [this.nativeIdOf(track)])
  }

  async unlike(track: Track): Promise<void> {
    return this.writeLibrary('DELETE', [this.nativeIdOf(track)])
  }

  /** Keyed by native id. `GET /me/library/contains`, 40 URIs per call. */
  async isLiked(nativeIds: string[]): Promise<Record<string, boolean>> {
    const ids = [...new Set(nativeIds)]
    ids.forEach((id) => assertSpotifyId(id))
    const out: Record<string, boolean> = {}
    for (const batch of chunks(ids, LIBRARY_BATCH)) {
      const res = await this.api.get<boolean[]>('/me/library/contains', {
        uris: batch.map(spotifyUri).join(',')
      })
      batch.forEach((id, i) => (out[id] = Array.isArray(res) && res[i] === true))
    }
    return out
  }

  async getPlaylists(): Promise<Playlist[]> {
    const [items, userId] = await Promise.all([
      this.api.getAllPages<SpPlaylist>('/me/playlists', { limit: PAGE_LIMIT }),
      this.deps.getUserId()
    ])
    return items.map((p) => mapPlaylist(p, userId)).filter((p): p is Playlist => p !== null)
  }

  /** Accepts the app playlist id (`spotify:<id>`) or the bare Spotify id. */
  async getPlaylistTracks(id: string): Promise<Track[]> {
    const nativeId = id.startsWith('spotify:') ? id.slice('spotify:'.length) : id
    assertSpotifyId(nativeId, 'playlist')
    let items: (SpPlaylistItem | null)[]
    try {
      items = await this.api.getAllPages<SpPlaylistItem>(
        `/playlists/${encodeURIComponent(nativeId)}/items`,
        { limit: PAGE_LIMIT, additional_types: 'track' }
      )
    } catch (err) {
      if (err instanceof SpotifyApiError && err.status === 403)
        throw new SpotifyPlaylistUnreadableError()
      throw err
    }
    return items.map(mapPlaylistItem).filter((t): t is Track => t !== null)
  }

  /**
   * `GET /artists/{id}`, every release (albums, singles, compilations; 10 per page) and
   * top tracks. `GET /artists/{id}/top-tracks` was removed in Feb 2026, so top tracks are
   * the first search hits for `artist:"<name>"` that credit this artist, in search order.
   */
  async getArtist(nativeId: string): Promise<ArtistPage> {
    assertSpotifyId(nativeId, 'artist')
    const raw = await this.api.get<SpArtist>(`/artists/${encodeURIComponent(nativeId)}`)
    const artist = mapArtist(raw)
    if (!artist) throw new Error("Spotify didn't return that artist.")
    const [releases, topTracks] = await Promise.all([
      this.getReleases(nativeId, 'album,single,compilation'),
      this.getTopTracks(nativeId, artist.name)
    ])
    return { artist, topTracks, releases, playlists: [] }
  }

  /** Just the artist: one `GET /artists/{id}` call. */
  async getArtistInfo(nativeId: string): Promise<Artist> {
    assertSpotifyId(nativeId, 'artist')
    const artist = mapArtist(
      await this.api.get<SpArtist>(`/artists/${encodeURIComponent(nativeId)}`)
    )
    if (!artist) throw new Error("Spotify didn't return that artist.")
    return artist
  }

  /** `GET /albums/{id}` plus any further pages of its tracks (embedded page holds 50). */
  async getAlbum(nativeId: string): Promise<AlbumPage> {
    assertSpotifyId(nativeId, 'album')
    const raw = await this.api.get<SpAlbum>(`/albums/${encodeURIComponent(nativeId)}`)
    const album = mapAlbum(raw)
    if (!raw || !album) throw new Error("Spotify didn't return that album.")
    const items: (SpTrack | null)[] = [...(raw.tracks?.items ?? [])]
    let next = raw.tracks?.next ?? null
    for (let i = 0; next && i < 100; i++) {
      const page = await this.api.get<{ items?: (SpTrack | null)[]; next?: string | null }>(next)
      items.push(...(page?.items ?? []))
      next = page?.next ?? null
    }
    return {
      album,
      tracks: mapAlbumTracks(items, raw),
      copyrights: mapCopyrights(raw.copyrights)
    }
  }

  /**
   * Every track on the artist's albums and singles (compilations left out), releases
   * newest first and track order inside each, deduped by track id.
   */
  async getArtistTracks(nativeId: string): Promise<Track[]> {
    assertSpotifyId(nativeId, 'artist')
    const releases = await this.getReleases(nativeId, 'album,single')
    const perAlbum = await mapLimit(releases, ALBUM_CONCURRENCY, async (album) => {
      const items = await this.api.getAllPages<SpTrack>(
        `/albums/${encodeURIComponent(album.nativeId)}/tracks`,
        { limit: ALBUM_TRACKS_LIMIT }
      )
      return mapAlbumTracks(items, {
        id: album.nativeId,
        name: album.name,
        images: album.artworkUrl ? [{ url: album.artworkUrl }] : [],
        external_urls: album.url ? { spotify: album.url } : undefined
      })
    })
    const seen = new Set<string>()
    const out: Track[] = []
    for (const t of perAlbum.flat()) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
    }
    return out
  }

  /** One `GET /tracks/{id}` per track (the batch endpoint was removed in Feb 2026). */
  async getTracks(nativeIds: string[]): Promise<Track[]> {
    const ids = [...new Set(nativeIds.filter((id) => /^[A-Za-z0-9]{22}$/.test(id)))]
    const found = await mapLimit(ids, ALBUM_CONCURRENCY, async (id) => {
      try {
        return mapTrack(await this.api.get<SpTrack>(`/tracks/${id}`))
      } catch (err) {
        console.warn(`[spotify] track ${id} lookup failed:`, (err as Error).message)
        return null
      }
    })
    return found.filter((t): t is Track => t !== null)
  }

  private async getReleases(artistId: string, groups: string): Promise<Album[]> {
    const items = await this.api.getAllPages<SpAlbumRef>(
      `/artists/${encodeURIComponent(artistId)}/albums`,
      { include_groups: groups, limit: ARTIST_ALBUMS_LIMIT }
    )
    const seen = new Set<string>()
    const out: Album[] = []
    for (const raw of items) {
      const a = mapAlbum(raw)
      if (!a || seen.has(a.id)) continue
      seen.add(a.id)
      out.push(a)
    }
    return out.sort(byReleaseDesc)
  }

  private async getTopTracks(artistId: string, name: string): Promise<Track[]> {
    if (!name.trim()) return []
    const res = await this.api.get<{ tracks?: { items?: (SpTrack | null)[] } }>('/search', {
      q: `artist:"${name.replace(/"/g, '')}"`,
      type: 'track',
      limit: SEARCH_LIMIT
    })
    return (res?.tracks?.items ?? [])
      .filter((t) => !!t && (t.artists ?? []).some((a) => a?.id === artistId))
      .map(mapTrack)
      .filter((t): t is Track => t !== null)
      .slice(0, TOP_TRACKS_MAX)
  }

  /**
   * `POST /me/playlists` `{ name, public: false, description }`, then the tracks in order
   * through addToPlaylist (100 per call). `POST /users/{id}/playlists` was removed in
   * Feb 2026. Every track is checked before anything is created.
   */
  async createPlaylist(name: string, tracks: Track[]): Promise<Playlist> {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('A playlist needs a name.')
    tracks.forEach((t) => this.nativeIdOf(t))
    const [raw, userId] = await Promise.all([
      this.api.request<SpPlaylist>('POST', '/me/playlists', {
        body: { name: trimmed, public: false, description: CREATED_PLAYLIST_DESCRIPTION }
      }),
      this.deps.getUserId()
    ])
    const created = mapPlaylist(raw, userId)
    if (!created) throw new Error("Spotify didn't return the new playlist.")
    assertSpotifyId(created.nativeId, 'playlist')
    try {
      await this.addToPlaylist(created.id, tracks)
    } catch (err) {
      throw new Error(
        `Created the Spotify playlist "${trimmed}", but adding its tracks failed: ${(err as Error).message}`,
        { cause: err }
      )
    }
    return { ...created, canEdit: true, trackCount: tracks.length }
  }

  /** `POST /playlists/{id}/items` `{ uris }`, 100 per call, appended in order. */
  async addToPlaylist(playlistId: string, tracks: Track[]): Promise<void> {
    const path = this.playlistItemsPath(playlistId)
    const uris = tracks.map((t) => spotifyUri(this.nativeIdOf(t)))
    for (const batch of chunks(uris, PLAYLIST_EDIT_BATCH))
      await this.api.request('POST', path, { body: { uris: batch } })
  }

  /**
   * `DELETE /playlists/{id}/items` `{ items: [{ uri }] }`, 100 per call. Without a
   * `snapshot_id` or positions Spotify removes every occurrence of each URI.
   */
  async removeFromPlaylist(playlistId: string, tracks: Track[]): Promise<void> {
    const path = this.playlistItemsPath(playlistId)
    const uris = [...new Set(tracks.map((t) => spotifyUri(this.nativeIdOf(t))))]
    for (const batch of chunks(uris, PLAYLIST_EDIT_BATCH))
      await this.api.request('DELETE', path, { body: { items: batch.map((uri) => ({ uri })) } })
  }

  private playlistItemsPath(playlistId: string): string {
    if (typeof playlistId !== 'string' || !playlistId.startsWith('spotify:'))
      throw new Error(`Not a Spotify playlist: ${String(playlistId)}`)
    const nativeId = playlistId.slice('spotify:'.length)
    assertSpotifyId(nativeId, 'playlist')
    return `/playlists/${encodeURIComponent(nativeId)}/items`
  }

  private nativeIdOf(track: Track): string {
    if (!track || track.provider !== 'spotify')
      throw new Error(`Not a Spotify track: ${String(track?.id)}`)
    assertSpotifyId(track.nativeId)
    return track.nativeId
  }

  /**
   * Save or remove library items. The research doc couldn't confirm the request shape:
   * the endpoint reference documents `uris` as a comma-separated query parameter, while
   * the Feb 2026 migration guide shows a JSON body `{ uris: [...] }`. Send the query
   * string first (as the reference says); on 400 retry once with the JSON body and
   * remember whichever worked.
   */
  private async writeLibrary(method: 'PUT' | 'DELETE', nativeIds: string[]): Promise<void> {
    for (const batch of chunks(nativeIds, LIBRARY_BATCH)) {
      const uris = batch.map(spotifyUri)
      const viaQuery = (): Promise<unknown> =>
        this.api.request(method, '/me/library', { query: { uris: uris.join(',') } })
      const viaBody = (): Promise<unknown> =>
        this.api.request(method, '/me/library', { body: { uris } })
      const [first, second] =
        this.libraryMode === 'query' ? [viaQuery, viaBody] : [viaBody, viaQuery]
      try {
        await first()
      } catch (err) {
        if (!(err instanceof SpotifyApiError) || err.status !== 400) throw err
        await second()
        this.libraryMode = this.libraryMode === 'query' ? 'body' : 'query'
      }
    }
  }
}
