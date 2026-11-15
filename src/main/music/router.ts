// Routes service-agnostic music calls to the right MusicProvider. Provider-neutral:
// SoundCloud (Phase 3) joins by adding an entry to the registry.
import type { ServiceProvider } from '@shared/ipc'
import type { FindResult } from '@shared/match'
import type { CatalogProvider, MusicProvider } from '@shared/provider'
import type { AlbumPage, Artist, ArtistPage, LikedTrack, Playlist, Track } from '@shared/types'

import type { LikeChecker } from '@shared/provider'
import { normalizeIsrc, rankMatches, searchQuery } from './match'
export type { LikeChecker }

/** Side effects the router triggers; wired in main/index.ts. */
export interface RouterHooks {
  /** After a service like/unlike succeeded: mirror it into the local likes table. */
  onLikeChange?(track: Track, liked: boolean): void
  /** `music:getPlaylistTracks` for `app:` playlists (stored locally). */
  getAppPlaylistTracks?(playlistId: string): Track[]
  /** Clock for the artist-info cache (tests). Default Date.now. */
  now?(): number
}

/** How long music:getArtistInfo reuses an answer. */
export const ARTIST_INFO_TTL_MS = 10 * 60_000
/** Most artists kept in that cache (oldest dropped first). */
export const ARTIST_INFO_CACHE_MAX = 500

/** Optional on catalog providers: just the artist, in one request. */
export interface ArtistInfoProvider {
  getArtistInfo(nativeId: string): Promise<Artist>
}

function hasArtistInfo(p: CatalogProvider): p is CatalogProvider & ArtistInfoProvider {
  return typeof (p as Partial<ArtistInfoProvider>).getArtistInfo === 'function'
}

export type ProviderRegistry = Partial<Record<ServiceProvider, MusicProvider>>

const SERVICE_NAMES: Record<ServiceProvider, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud'
}

export function isServiceProvider(v: unknown): v is ServiceProvider {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SERVICE_NAMES, v)
}

export function notConnectedMessage(provider: ServiceProvider): string {
  return `${SERVICE_NAMES[provider]} isn't connected. Connect it in Settings.`
}

function hasLikeChecker(p: MusicProvider): p is MusicProvider & LikeChecker {
  return typeof (p as Partial<LikeChecker>).isLiked === 'function'
}

function isCatalog(p: MusicProvider): p is MusicProvider & CatalogProvider {
  const c = p as Partial<CatalogProvider>
  return (
    typeof c.getArtist === 'function' &&
    typeof c.getAlbum === 'function' &&
    typeof c.getArtistTracks === 'function'
  )
}

function canSearchArtists(
  p: MusicProvider
): p is MusicProvider & Pick<CatalogProvider, 'searchArtists'> {
  return typeof (p as Partial<CatalogProvider>).searchArtists === 'function'
}

/** Splits `provider:rest` at the first colon. */
function splitId(id: string): { prefix: string; rest: string } | null {
  if (typeof id !== 'string') return null
  const i = id.indexOf(':')
  if (i <= 0 || i === id.length - 1) return null
  return { prefix: id.slice(0, i), rest: id.slice(i + 1) }
}

export interface MusicRouter {
  search(provider: ServiceProvider, query: string, page: number): Promise<Track[]>
  getLikes(provider: ServiceProvider): Promise<LikedTrack[]>
  like(track: Track): Promise<void>
  unlike(track: Track): Promise<void>
  isLiked(trackIds: string[]): Promise<Record<string, boolean>>
  getPlaylists(provider: ServiceProvider): Promise<Playlist[]>
  getPlaylistTracks(playlistId: string): Promise<Track[]>
  /** App ids (`spotify:<id>` / `soundcloud:<id>`); providers get the native id. */
  getArtist(artistId: string): Promise<ArtistPage>
  /** Just the artist (one request), cached ARTIST_INFO_TTL_MS per id. */
  getArtistInfo(artistId: string): Promise<Artist>
  getAlbum(albumId: string): Promise<AlbumPage>
  getArtistTracks(artistId: string): Promise<Track[]>
  /** Artist profiles matching a search on one service, best first, max 10. */
  searchArtists(provider: ServiceProvider, query: string): Promise<Artist[]>
  /** The same song on `service`: ISRC matches first, then title plus artist (see match.ts). */
  findOn(track: Track, service: ServiceProvider): Promise<FindResult>
}

const PROVIDERS = new Set<unknown>(['spotify', 'soundcloud', 'local'])

/** The fields findOn reads, checked because the track comes over IPC. */
function isTrackLike(t: unknown): t is Track {
  if (!t || typeof t !== 'object') return false
  const x = t as Partial<Track>
  return (
    typeof x.id === 'string' &&
    PROVIDERS.has(x.provider) &&
    typeof x.title === 'string' &&
    Array.isArray(x.artists) &&
    x.artists.every((a) => typeof a === 'string') &&
    (x.durationMs === undefined || typeof x.durationMs === 'number') &&
    (x.isrc === undefined || typeof x.isrc === 'string')
  )
}

export function createMusicRouter(
  providers: ProviderRegistry,
  hooks: RouterHooks = {}
): MusicRouter {
  function get(provider: unknown): MusicProvider {
    if (!isServiceProvider(provider)) {
      if (provider === 'local') throw new Error('Local files are not handled by music:* calls.')
      throw new Error(`Unknown music service: ${String(provider)}`)
    }
    const p = providers[provider]
    if (!p) throw new Error(notConnectedMessage(provider))
    return p
  }

  function forTrack(track: Track): MusicProvider {
    if (!track || typeof track !== 'object') throw new Error('No track given.')
    if (track.provider === 'local') throw new Error("Local files can't be liked on a service.")
    return get(track.provider)
  }

  function catalog(id: unknown, what: string): { p: CatalogProvider; nativeId: string } {
    const parts = typeof id === 'string' ? splitId(id) : null
    if (!parts) throw new Error(`Invalid ${what} id: ${String(id)}`)
    if (parts.prefix === 'local' || parts.prefix === 'app')
      throw new Error(`Local files and app playlists have no ${what} pages.`)
    const p = get(parts.prefix)
    if (!isCatalog(p))
      throw new Error(`${SERVICE_NAMES[parts.prefix as ServiceProvider]} has no ${what} pages.`)
    return { p, nativeId: parts.rest }
  }

  const now = (): number => (hooks.now ? hooks.now() : Date.now())
  // Promises, so calls for the same artist while one is in flight share it.
  const artistInfo = new Map<string, { at: number; value: Promise<Artist> }>()

  return {
    getArtistInfo: async (artistId) => {
      const { p, nativeId } = catalog(artistId, 'artist')
      if (!hasArtistInfo(p)) throw new Error("This service can't show artist details.")
      const key = artistId
      const hit = artistInfo.get(key)
      if (hit && now() - hit.at < ARTIST_INFO_TTL_MS) return hit.value
      artistInfo.delete(key)
      const value = p.getArtistInfo(nativeId)
      artistInfo.set(key, { at: now(), value })
      while (artistInfo.size > ARTIST_INFO_CACHE_MAX) {
        const oldest = artistInfo.keys().next().value
        if (oldest === undefined) break
        artistInfo.delete(oldest)
      }
      try {
        return await value
      } catch (err) {
        // Failures aren't cached: the next call asks again.
        if (artistInfo.get(key)?.value === value) artistInfo.delete(key)
        throw err
      }
    },
    getArtist: async (artistId) => {
      const { p, nativeId } = catalog(artistId, 'artist')
      return p.getArtist(nativeId)
    },
    getAlbum: async (albumId) => {
      const { p, nativeId } = catalog(albumId, 'album')
      return p.getAlbum(nativeId)
    },
    getArtistTracks: async (artistId) => {
      const { p, nativeId } = catalog(artistId, 'artist')
      return p.getArtistTracks(nativeId)
    },
    search: async (provider, query, page) => get(provider).search(query, page),
    searchArtists: async (provider, query) => {
      const p = get(provider)
      if (typeof query !== 'string') throw new Error('No search query given.')
      if (!canSearchArtists(p))
        throw new Error(`${SERVICE_NAMES[provider]} can't search for artists.`)
      if (!query.trim()) return []
      return p.searchArtists(query)
    },

    async findOn(track, service) {
      if (!isTrackLike(track)) throw new Error('Not a valid track.')
      if (!isServiceProvider(service)) throw new Error(`Unknown music service: ${String(service)}`)
      if (track.provider === service)
        throw new Error(`This track is already on ${SERVICE_NAMES[service]}.`)
      const p = get(service)
      const isrc = normalizeIsrc(track.isrc)
      const query = searchQuery(track)
      // Spotify's search takes `isrc:` as a field filter; SoundCloud has no ISRC search,
      // so there the ISRC only marks title-search results that carry the same one.
      const [byIsrc, byTitle] = await Promise.all([
        service === 'spotify' && isrc ? p.search(`isrc:${isrc}`, 0) : Promise.resolve([]),
        query ? p.search(query, 0) : Promise.resolve([])
      ])
      return { service, matches: rankMatches(track, [...byIsrc, ...byTitle]) }
    },
    getLikes: async (provider) => get(provider).getLikes(),
    // The service is written first; the local table only after it succeeds.
    like: async (track) => {
      await forTrack(track).like(track)
      hooks.onLikeChange?.(track, true)
    },
    unlike: async (track) => {
      await forTrack(track).unlike(track)
      hooks.onLikeChange?.(track, false)
    },
    getPlaylists: async (provider) => get(provider).getPlaylists(),

    async getPlaylistTracks(playlistId) {
      const parts = splitId(playlistId)
      if (!parts) throw new Error(`Invalid playlist id: ${String(playlistId)}`)
      if (parts.prefix === 'app') {
        if (!hooks.getAppPlaylistTracks) throw new Error('App playlists are not available.')
        return hooks.getAppPlaylistTracks(playlistId)
      }
      // Providers receive the full `source:nativeId` id, as the renderer knows it.
      return get(parts.prefix).getPlaylistTracks(playlistId)
    },

    /**
     * Groups ids by provider and asks each once. Ids for providers that aren't
     * connected, local files and malformed ids come back false: they can't be liked
     * on a service right now, and one missing service shouldn't fail a mixed list.
     */
    async isLiked(trackIds) {
      const out: Record<string, boolean> = {}
      const groups = new Map<ServiceProvider, Map<string, string[]>>()
      for (const id of Array.isArray(trackIds) ? trackIds : []) {
        out[id] = false
        const parts = splitId(id)
        if (!parts || !isServiceProvider(parts.prefix) || !providers[parts.prefix]) continue
        const group = groups.get(parts.prefix) ?? new Map<string, string[]>()
        groups.set(parts.prefix, group)
        group.set(parts.rest, [...(group.get(parts.rest) ?? []), id])
      }
      await Promise.all(
        [...groups].map(async ([provider, group]) => {
          const p = providers[provider]!
          if (!hasLikeChecker(p))
            throw new Error(`${SERVICE_NAMES[provider]} can't check likes yet.`)
          const result = await p.isLiked([...group.keys()])
          for (const [nativeId, ids] of group) for (const id of ids) out[id] = !!result[nativeId]
        })
      )
      return out
    }
  }
}
