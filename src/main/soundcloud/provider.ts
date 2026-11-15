// SoundCloudProvider over the web session's api-v2. Endpoints per
// docs/research/soundcloud-api.md (sections 4-11). Nothing here needs an API key.
import {
  UnplayableTrackError,
  type CatalogProvider,
  type OfficialDownload,
  type PlaylistCreator,
  type PlaylistEditor,
  type SoundCloudProvider,
  type StreamInfo,
  type TrackComment,
  type TrackLookup
} from '@shared/provider'
import type { ScTrackPage } from '@shared/soundcloud'
import type {
  Album,
  AlbumPage,
  Artist,
  ArtistPage,
  LikedTrack,
  Playlist,
  Track
} from '@shared/types'
import {
  SoundCloudApiError,
  SoundCloudDataDomeError,
  SoundCloudLoginExpiredError,
  SoundCloudNotConnectedError,
  type SoundCloudApi
} from './api'
import type { ScFetch } from './clientId'
import {
  classifyAvailability,
  isPreviewUrl,
  isStub,
  mapComment,
  parseTags,
  plainText,
  threadComments,
  mapLike,
  mapPlaylist,
  mapSet,
  mapTrack,
  mapUser,
  normalizeWaveform,
  pickEncryptedTranscoding,
  pickTranscoding,
  WIDEVINE_LICENSE_URL,
  signedUrlExpiry,
  type Availability,
  type ScComment,
  type ScLike,
  type ScPlaylist,
  type ScTrack,
  type ScUser
} from './mapping'

export const SEARCH_LIMIT = 20
/** CatalogProvider.searchArtists returns at most this many profiles. */
export const ARTIST_SEARCH_LIMIT = 10
/** Sets returned by searchSets. */
const SET_SEARCH_LIMIT = 10
export const LIKES_PAGE_LIMIT = 200
/** `GET /tracks?ids=` returns 400 above 50 ids. */
export const HYDRATE_BATCH = 50
export const LIKED_IDS_TTL_MS = 60_000
export const TRACK_CACHE_TTL_MS = 5 * 60_000
const TRACK_CACHE_MAX = 2000
export const COMMENTS_PAGE_LIMIT = 200
export const COMMENTS_MAX_PAGES = 10
export const TOP_TRACKS_LIMIT = 10
export const USER_TRACKS_PAGE_LIMIT = 200
/** Safety stop for getArtistTracks. */
export const ARTIST_TRACKS_MAX = 2000
/** SoundCloud's track limit for one set. */
export const PLAYLIST_MAX_TRACKS = 500
/** Re-resolve a signed stream URL this long before it really expires. */
export const STREAM_EXPIRY_MARGIN_MS = 5 * 60_000

export const UNPLAYABLE_MESSAGES: Record<Availability, string> = {
  preview: 'This track is preview-only on SoundCloud.',
  blocked: "This track isn't available on SoundCloud.",
  drm: "This track is protected (DRM) and can't play here yet."
}

const ID_RE = /^\d+$/

export function assertScId(id: string, what = 'track'): void {
  if (typeof id !== 'string' || !ID_RE.test(id))
    throw new Error(`Invalid SoundCloud ${what} id: ${String(id)}`)
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

function idOf(raw: { id?: unknown } | null | undefined): string | undefined {
  const id = raw?.id
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  if (typeof id === 'string' && ID_RE.test(id)) return id
  return undefined
}

export interface ScUserRef {
  id: string
  username: string
}

export interface WebProviderDeps {
  api: SoundCloudApi
  /** The logged-in user; throws the not-connected / expired error otherwise. */
  requireUser: () => Promise<ScUserRef>
  /** Plain session fetch for wave.sndcdn.com (no auth, no client_id). */
  fetch: ScFetch
  now?: () => number
}

/** Newest first; undated releases last. Stable for equal dates. */
function byReleaseDesc(a: Album, b: Album): number {
  const x = a.releaseDate ?? ''
  const y = b.releaseDate ?? ''
  return x < y ? 1 : x > y ? -1 : 0
}

export class SoundCloudWebProvider
  implements SoundCloudProvider, PlaylistEditor, PlaylistCreator, CatalogProvider, TrackLookup
{
  private likedIds: { at: number; ids: Set<string> } | null = null
  private readonly tracks = new Map<string, { at: number; raw: ScTrack }>()
  private readonly now: () => number

  constructor(private readonly deps: WebProviderDeps) {
    this.now = deps.now ?? Date.now
  }

  private get api(): SoundCloudApi {
    return this.deps.api
  }

  /** Forget per-user caches (logout / account switch). */
  reset(): void {
    this.likedIds = null
    this.tracks.clear()
  }

  async search(query: string, page: number): Promise<Track[]> {
    const q = typeof query === 'string' ? query.trim() : ''
    if (!q) return []
    const offset = Math.max(0, Math.floor(Number(page) || 0)) * SEARCH_LIMIT
    const res = await this.api.get<{ collection?: (ScTrack | null)[] }>(
      'search/tracks',
      { q, limit: SEARCH_LIMIT, offset, linked_partitioning: 1 },
      'optional'
    )
    return this.mapTracks(res?.collection ?? [])
  }

  /** `search/users`, best first. Public data: works logged out. */
  async searchArtists(query: string): Promise<Artist[]> {
    const q = typeof query === 'string' ? query.trim() : ''
    if (!q) return []
    const res = await this.api.get<{ collection?: (ScUser | null)[] }>(
      'search/users',
      { q, limit: ARTIST_SEARCH_LIMIT },
      'optional'
    )
    const seen = new Set<string>()
    const out: Artist[] = []
    for (const raw of res?.collection ?? []) {
      const a = mapUser(raw)
      if (!a || seen.has(a.id)) continue
      seen.add(a.id)
      out.push(a)
      if (out.length >= ARTIST_SEARCH_LIMIT) break
    }
    return out
  }

  /** `search/playlists` (plain playlists and albums), mapped like profile releases. */
  async searchSets(query: string): Promise<Album[]> {
    const q = typeof query === 'string' ? query.trim() : ''
    if (!q) return []
    const res = await this.api.get<{ collection?: (ScPlaylist | null)[] }>(
      'search/playlists',
      { q, limit: SET_SEARCH_LIMIT },
      'optional'
    )
    const seen = new Set<string>()
    const out: Album[] = []
    for (const raw of res?.collection ?? []) {
      const set = mapSet(raw)
      // Empty sets can't be played; skip them.
      if (!set || set.trackCount === 0 || seen.has(set.id)) continue
      seen.add(set.id)
      out.push(set)
      if (out.length >= SET_SEARCH_LIMIT) break
    }
    return out
  }

  /** `users/{me}/track_likes`, every page, newest first. */
  async getLikes(): Promise<LikedTrack[]> {
    const me = await this.deps.requireUser()
    const items = await this.api.getAll<ScLike>(
      `users/${me.id}/track_likes`,
      { limit: LIKES_PAGE_LIMIT },
      'required'
    )
    const likes: LikedTrack[] = []
    for (const item of items) {
      const like = mapLike(item)
      if (!like) continue
      if (item?.track) this.remember(item.track)
      likes.push(like)
    }
    this.likedIds = { at: this.now(), ids: new Set(likes.map((l) => l.track.nativeId)) }
    return likes.sort((a, b) => (a.likedAt < b.likedAt ? 1 : a.likedAt > b.likedAt ? -1 : 0))
  }

  async like(track: Track): Promise<void> {
    const id = this.nativeIdOf(track)
    const me = await this.deps.requireUser()
    await this.api.request('PUT', `users/${me.id}/track_likes/${id}`, { auth: 'required' })
    this.likedIds?.ids.add(id)
  }

  async unlike(track: Track): Promise<void> {
    const id = this.nativeIdOf(track)
    const me = await this.deps.requireUser()
    await this.api.request('DELETE', `users/${me.id}/track_likes/${id}`, { auth: 'required' })
    this.likedIds?.ids.delete(id)
  }

  /** Router LikeChecker. `me/track_likes/ids`, cached for a minute. */
  async isLiked(nativeIds: string[]): Promise<Record<string, boolean>> {
    const ids = await this.getLikedIds()
    const out: Record<string, boolean> = {}
    for (const id of nativeIds) out[id] = ids.has(id)
    return out
  }

  /**
   * Own playlists plus liked playlists and albums from `me/library/all`. If that call
   * fails (shape unverified), falls back to `users/{me}/playlists_without_albums` plus
   * `users/{me}/playlist_likes`. Deduped by id, library order kept.
   */
  async getPlaylists(): Promise<Playlist[]> {
    const me = await this.deps.requireUser()
    let raws: ScPlaylist[]
    try {
      raws = extractPlaylists(
        await this.api.getAll<unknown>('me/library/all', { limit: 200 }, 'required')
      )
    } catch (err) {
      if (!(err instanceof SoundCloudApiError) || err.status === 403 || err.status === 429)
        throw err
      console.warn('[soundcloud] me/library/all failed; using playlist endpoints:', err.message)
      const [own, liked] = await Promise.all([
        this.api.getAll<unknown>(
          `users/${me.id}/playlists_without_albums`,
          { limit: 200 },
          'required'
        ),
        this.api
          .getAll<unknown>(`users/${me.id}/playlist_likes`, { limit: 200 }, 'required')
          .catch((e: unknown) => {
            console.warn('[soundcloud] playlist_likes failed:', e)
            return []
          })
      ])
      raws = extractPlaylists([...own, ...liked])
    }
    const seen = new Set<string>()
    const out: Playlist[] = []
    for (const raw of raws) {
      const p = mapPlaylist(raw, me.id)
      if (!p || seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
    return out
  }

  /** `playlists/{id}`, stubs hydrated through `tracks?ids=` 50 at a time, order kept. */
  async getPlaylistTracks(id: string): Promise<Track[]> {
    const nativeId = id.startsWith('soundcloud:') ? id.slice('soundcloud:'.length) : id
    assertScId(nativeId, 'playlist')
    await this.deps.requireUser()
    return (await this.loadSet(nativeId, 'required')).tracks
  }

  /**
   * Profile, top tracks, releases (`users/{id}/albums`, every page, newest first) and
   * the user's other playlists. Public data: works logged out.
   */
  /** Just the profile: one `users/{id}` call (works logged out). */
  async getArtistInfo(nativeId: string): Promise<Artist> {
    assertScId(nativeId, 'user')
    const artist = mapUser(await this.api.get<ScUser>(`users/${nativeId}`, undefined, 'optional'))
    if (!artist) throw new Error("SoundCloud didn't return that user.")
    return artist
  }

  async getArtist(nativeId: string): Promise<ArtistPage> {
    assertScId(nativeId, 'user')
    const [user, top, sets, lists] = await Promise.all([
      this.api.get<ScUser>(`users/${nativeId}`, undefined, 'optional'),
      this.api.get<{ collection?: (ScTrack | null)[] }>(
        `users/${nativeId}/toptracks`,
        { limit: TOP_TRACKS_LIMIT },
        'optional'
      ),
      this.api.getAll<ScPlaylist>(`users/${nativeId}/albums`, { limit: 50 }, 'optional'),
      this.api.getAll<ScPlaylist>(
        `users/${nativeId}/playlists_without_albums`,
        { limit: 50 },
        'optional'
      )
    ])
    const artist = mapUser(user)
    if (!artist) throw new Error("SoundCloud didn't return that user.")
    const seen = new Set<string>()
    const releases: Album[] = []
    for (const raw of sets) {
      // The ownerless sets in this listing are the user's own; fill the owner for art/artists.
      const a = mapSet(raw && !raw.user && user ? { ...raw, user } : raw)
      if (!a || seen.has(a.id)) continue
      seen.add(a.id)
      releases.push(a)
    }
    releases.sort(byReleaseDesc)
    const playlists: Playlist[] = []
    for (const raw of extractPlaylists(lists)) {
      const p = mapPlaylist(raw, undefined)
      if (p && !playlists.some((x) => x.id === p.id)) playlists.push(p)
    }
    const page: ArtistPage = {
      artist,
      topTracks: this.mapTracks(top?.collection ?? []).slice(0, TOP_TRACKS_LIMIT),
      releases,
      playlists
    }
    if (typeof user?.track_count === 'number') page.trackCount = user.track_count
    return page
  }

  /** Any public set (album, EP, single or plain playlist) with its tracks hydrated, in order. */
  async getAlbum(nativeId: string): Promise<AlbumPage> {
    assertScId(nativeId, 'playlist')
    const { playlist, tracks } = await this.loadSet(nativeId, 'optional')
    const album = mapSet(playlist)
    if (!album) throw new Error("SoundCloud didn't return that set.")
    return { album, tracks, copyrights: [] }
  }

  /**
   * Every upload (`users/{id}/tracks`, 200 per page, following next_href to the end),
   * capped at ARTIST_TRACKS_MAX. Deduped by id, API order (newest first).
   */
  async getArtistTracks(nativeId: string): Promise<Track[]> {
    assertScId(nativeId, 'user')
    const out: Track[] = []
    const seen = new Set<string>()
    let next: string | null = this.api
      .url(`users/${nativeId}/tracks`, {
        limit: USER_TRACKS_PAGE_LIMIT,
        linked_partitioning: 1
      })
      .toString()
    while (next) {
      const page: { collection?: (ScTrack | null)[]; next_href?: string | null } | undefined =
        await this.api.get(next, undefined, 'optional')
      const list = Array.isArray(page?.collection) ? page.collection : []
      for (const t of this.mapTracks(list)) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        out.push(t)
        if (out.length >= ARTIST_TRACKS_MAX) {
          console.warn(
            `[soundcloud] users/${nativeId}/tracks: stopped at ${ARTIST_TRACKS_MAX} tracks`
          )
          return out
        }
      }
      // An empty page ends it even if SoundCloud still sends a next_href.
      next = list.length > 0 ? (page?.next_href ?? null) : null
    }
    return out
  }

  /** Tracks by id through `tracks?ids=`, 50 at a time; works logged out. */
  async getTracks(nativeIds: string[]): Promise<Track[]> {
    const ids = [...new Set(nativeIds.filter((id) => /^\d+$/.test(id)))]
    const out: Track[] = []
    for (const batch of chunks(ids, HYDRATE_BATCH)) {
      const res = await this.api.get<ScTrack[] | { collection?: ScTrack[] }>(
        'tracks',
        { ids: batch.join(',') },
        'optional'
      )
      for (const raw of Array.isArray(res) ? res : (res?.collection ?? [])) {
        this.remember(raw)
        const mapped = mapTrack(raw)
        if (mapped) out.push(mapped)
      }
    }
    return out
  }

  /** `playlists/{id}` with stubs hydrated through `tracks?ids=` 50 at a time, order kept. */
  private async loadSet(
    nativeId: string,
    auth: 'optional' | 'required'
  ): Promise<{ playlist: ScPlaylist | undefined; tracks: Track[] }> {
    const playlist = await this.api.get<ScPlaylist>(
      `playlists/${nativeId}`,
      { representation: 'full' },
      auth
    )
    const entries = (playlist?.tracks ?? []).filter((t): t is ScTrack => !!t && !!idOf(t))
    const full = new Map<string, ScTrack>()
    const stubs: string[] = []
    for (const t of entries) {
      const tid = idOf(t)!
      if (isStub(t)) stubs.push(tid)
      else full.set(tid, t)
    }
    const missing = [...new Set(stubs.filter((s) => !full.has(s)))]
    for (const batch of chunks(missing, HYDRATE_BATCH)) {
      const query: Record<string, string> = { ids: batch.join(','), playlistId: nativeId }
      if (playlist?.secret_token) query.playlistSecretToken = playlist.secret_token
      const res = await this.api.get<ScTrack[] | { collection?: ScTrack[] }>('tracks', query, auth)
      const list = Array.isArray(res) ? res : (res?.collection ?? [])
      for (const t of list) {
        const tid = idOf(t)
        if (tid) full.set(tid, t)
      }
    }
    const out: Track[] = []
    for (const t of entries) {
      const raw = full.get(idOf(t)!)
      if (!raw) continue
      this.remember(raw)
      const mapped = mapTrack(raw)
      if (mapped) out.push(mapped)
    }
    return { playlist, tracks: out }
  }

  /**
   * Appends to the playlist: reads its current track id list, then writes the whole new
   * list back. Unverified with a login (see writePlaylistTracks).
   */
  async addToPlaylist(playlistId: string, tracks: Track[]): Promise<void> {
    const add = tracks.map((t) => this.nativeIdOf(t))
    if (add.length === 0) return
    const nativeId = this.playlistNativeId(playlistId)
    const current = await this.readPlaylistTrackIds(nativeId)
    await this.writePlaylistTracks(nativeId, [...current, ...add])
  }

  /** Removes every occurrence of these tracks. Unverified with a login. */
  async removeFromPlaylist(playlistId: string, tracks: Track[]): Promise<void> {
    const drop = new Set(tracks.map((t) => this.nativeIdOf(t)))
    if (drop.size === 0) return
    const nativeId = this.playlistNativeId(playlistId)
    const current = await this.readPlaylistTrackIds(nativeId)
    const next = current.filter((id) => !drop.has(id))
    if (next.length === current.length) return
    await this.writePlaylistTracks(nativeId, next)
  }

  /**
   * A new private playlist with these tracks, in order, in one call: `POST playlists`
   * with `{ playlist: { title, sharing: 'private', tracks: [id, ...] } }` (numeric ids).
   * From the web client (2026-11-12): `playlistCreate` is `post` on `playlists`, and the
   * playlist model saves as JSON wrapped in its resource type, with `tracks` plucked to
   * ids. Not tried live (it would create a playlist). Every track is checked first.
   */
  async createPlaylist(name: string, tracks: Track[]): Promise<Playlist> {
    const title = typeof name === 'string' ? name.trim() : ''
    if (!title) throw new Error('A playlist needs a name.')
    if (!Array.isArray(tracks)) throw new Error('No tracks to add.')
    const ids = tracks.map((t) => this.nativeIdOf(t))
    if (ids.length > PLAYLIST_MAX_TRACKS)
      throw new Error(
        `SoundCloud playlists hold at most ${PLAYLIST_MAX_TRACKS} tracks; this one has ${ids.length}.`
      )
    let me: ScUserRef
    try {
      me = await this.deps.requireUser()
    } catch (err) {
      if (
        err instanceof SoundCloudNotConnectedError &&
        !(err instanceof SoundCloudLoginExpiredError)
      )
        throw new SoundCloudNotConnectedError(
          'Log in to SoundCloud in Settings to create playlists.'
        )
      throw err
    }
    const raw = await this.api.request<ScPlaylist>('POST', 'playlists', {
      body: { playlist: { title, sharing: 'private', tracks: ids.map(Number) } },
      auth: 'required'
    })
    const created = mapPlaylist(raw, me.id)
    if (!created) throw new Error("SoundCloud didn't return the new playlist.")
    return { ...created, name: created.name || title, canEdit: true, trackCount: ids.length }
  }

  async getStreamUrl(nativeId: string): Promise<StreamInfo> {
    assertScId(nativeId)
    const raw = await this.getTrack(nativeId, 'optional')
    const clear = pickTranscoding(raw)
    // No clear stream: fall back to the Widevine one (played through EME in the renderer).
    const transcoding = clear ?? pickEncryptedTranscoding(raw)
    if (!transcoding) {
      const why = classifyAvailability(raw) ?? 'blocked'
      throw new UnplayableTrackError(why, UNPLAYABLE_MESSAGES[why])
    }
    const encrypted = !clear
    const query: Record<string, string> = {}
    if (raw.track_authorization) query.track_authorization = raw.track_authorization
    if (raw.secret_token) query.secret_token = raw.secret_token
    let res: { url?: string; licenseAuthToken?: string } | undefined
    try {
      res = await this.api.get<{ url?: string; licenseAuthToken?: string }>(
        transcoding.url,
        query,
        'optional'
      )
    } catch (err) {
      // Stale track_authorization is a guess; drop the cached track and let the caller retry.
      this.tracks.delete(nativeId)
      if (err instanceof SoundCloudApiError && err.status === 404)
        throw new UnplayableTrackError('blocked', UNPLAYABLE_MESSAGES.blocked)
      throw err
    }
    const url = res?.url
    if (typeof url !== 'string' || !/^https:\/\//.test(url))
      throw new Error("SoundCloud didn't return a stream URL for this track.")
    if (isPreviewUrl(url)) throw new UnplayableTrackError('preview', UNPLAYABLE_MESSAGES.preview)
    const info: StreamInfo = {
      url,
      protocol: transcoding.format?.protocol === 'progressive' ? 'progressive' : 'hls',
      mimeType:
        transcoding.format?.mime_type ??
        (transcoding.format?.protocol === 'progressive'
          ? 'audio/mpeg'
          : 'application/vnd.apple.mpegurl'),
      preview: false
    }
    if (encrypted) {
      const token = res?.licenseAuthToken
      if (typeof token !== 'string' || token === '')
        throw new UnplayableTrackError('drm', UNPLAYABLE_MESSAGES.drm)
      info.drm = {
        keySystem: 'com.widevine.alpha',
        licenseUrl: `${WIDEVINE_LICENSE_URL}?license_token=${encodeURIComponent(token)}`
      }
    }
    const expires = signedUrlExpiry(url)
    if (expires !== undefined) {
      const left = expires - this.now()
      info.expiresAt = expires - Math.min(STREAM_EXPIRY_MARGIN_MS, Math.max(0, left / 4))
    }
    return info
  }

  /** Timed comments, oldest position first. Untested with a login. */
  async getComments(trackNativeId: string): Promise<TrackComment[]> {
    assertScId(trackNativeId)
    // Reading comments works logged out (api-v2 with client_id only). `threaded=1`
    // returns every comment, each thread in order (parent, then its replies);
    // `threaded=0` returns only top-level comments, which tells the two apart.
    const fetch = async (threaded: 0 | 1): Promise<TrackComment[]> =>
      (
        await this.api.getAll<ScComment>(
          `tracks/${trackNativeId}/comments`,
          { threaded, filter_replies: 0, limit: COMMENTS_PAGE_LIMIT },
          'optional',
          COMMENTS_MAX_PAGES
        )
      )
        .map(mapComment)
        .filter((c): c is TrackComment => c !== null)
    const [all, top] = await Promise.all([fetch(1), fetch(0)])
    const topIds = new Set(top.map((c) => c.id))
    // If the full list got cut off by the page cap, fall back to top-level only.
    return threadComments(all.length >= top.length ? all : top, topIds)
  }

  /** The track's page: description, stats, tags and uploader. Works logged out. */
  async getTrackPage(trackNativeId: string): Promise<ScTrackPage> {
    assertScId(trackNativeId)
    const raw = await this.getTrack(trackNativeId, 'optional')
    const track = mapTrack(raw)
    const uploader = mapUser(raw.user)
    if (!track || !uploader) throw new Error("Couldn't load this SoundCloud track.")
    const page: ScTrackPage = {
      track,
      tags: parseTags(raw.tag_list),
      uploader: {
        ...uploader,
        ...(typeof raw.user?.track_count === 'number' ? { trackCount: raw.user.track_count } : {})
      }
    }
    const description = raw.description ? plainText(raw.description) : ''
    if (description) page.description = description
    if (raw.created_at) page.createdAt = raw.created_at
    if (raw.genre?.trim()) page.genre = raw.genre.trim()
    if (typeof raw.playback_count === 'number') page.plays = raw.playback_count
    if (typeof raw.likes_count === 'number') page.likes = raw.likes_count
    if (typeof raw.reposts_count === 'number') page.reposts = raw.reposts_count
    if (typeof raw.comment_count === 'number') page.commentCount = raw.comment_count
    return page
  }

  /**
   * Posts a public comment. Comments can't be undone from this app, so only call this
   * from an explicit, confirmed user action; nothing calls it automatically.
   * The web client's endpoint map declares `commentCreate` with `query: {body, timestamp}`,
   * so both go in the query string with an empty POST body (a JSON body got 400).
   */
  async postComment(
    trackNativeId: string,
    body: string,
    timestampMs: number
  ): Promise<TrackComment> {
    assertScId(trackNativeId)
    const text = typeof body === 'string' ? body.trim() : ''
    if (!text) throw new Error('Write a comment first.')
    await this.deps.requireUser()
    const res = await this.api.request<ScComment>('POST', `tracks/${trackNativeId}/comments`, {
      query: { body: text, timestamp: String(Math.max(0, Math.round(Number(timestampMs) || 0))) },
      auth: 'required'
    })
    const mapped = mapComment(res)
    if (!mapped) throw new Error('SoundCloud accepted the comment but returned no comment.')
    return mapped
  }

  /** Peaks from `waveform_url` (wave.sndcdn.com JSON), scaled to 0..1. Empty when there's none. */
  async getWaveform(trackNativeId: string): Promise<number[]> {
    assertScId(trackNativeId)
    // Public data; works logged out.
    const raw = await this.getTrack(trackNativeId, 'optional')
    let url = raw.waveform_url
    if (!url) return []
    url = url.replace(/\.png(?=$|\?)/, '.json')
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !/(^|\.)sndcdn\.com$/.test(parsed.hostname))
      throw new Error(`Unexpected waveform host: ${parsed.hostname}`)
    const res = await this.deps.fetch(parsed.toString(), {
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) throw new Error(`Couldn't load the waveform (${res.status}).`)
    return normalizeWaveform(await res.json())
  }

  /** `tracks/{id}/download` -> `{redirectUri}`. Null when the artist hasn't enabled it. Untested with a login. */
  async getOfficialDownload(trackNativeId: string): Promise<OfficialDownload | null> {
    assertScId(trackNativeId)
    await this.deps.requireUser()
    const raw = await this.getTrack(trackNativeId, 'required')
    if (raw.downloadable !== true || raw.has_downloads_left !== true) return null
    let res: { redirectUri?: string } | undefined
    try {
      res = await this.api.get<{ redirectUri?: string }>(
        `tracks/${trackNativeId}/download`,
        undefined,
        'required'
      )
    } catch (err) {
      if (err instanceof SoundCloudDataDomeError) throw err
      if (err instanceof SoundCloudApiError && (err.status === 403 || err.status === 404))
        return null
      throw err
    }
    const url = res?.redirectUri
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) return null
    const out: OfficialDownload = { url }
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
    if (/\.[a-z0-9]{2,5}$/i.test(name)) out.filename = name
    return out
  }

  private playlistNativeId(playlistId: string): string {
    if (typeof playlistId !== 'string' || !playlistId.startsWith('soundcloud:'))
      throw new Error(`Not a SoundCloud playlist: ${String(playlistId)}`)
    const nativeId = playlistId.slice('soundcloud:'.length)
    assertScId(nativeId, 'playlist')
    return nativeId
  }

  /**
   * The playlist's full track id list, in order, stubs included (`playlists/{id}` lists
   * every entry, but only the first few as full objects). Refuses when the list came back
   * empty although `track_count` says there are tracks: writing it back would wipe the set.
   */
  private async readPlaylistTrackIds(nativeId: string): Promise<string[]> {
    await this.deps.requireUser()
    const playlist = await this.api.get<ScPlaylist>(
      `playlists/${nativeId}`,
      { representation: 'full' },
      'required'
    )
    if (!playlist || idOf(playlist) !== nativeId)
      throw new Error("SoundCloud didn't return that playlist.")
    const ids = (playlist.tracks ?? []).map((t) => idOf(t)).filter((id): id is string => !!id)
    const count = typeof playlist.track_count === 'number' ? playlist.track_count : 0
    if (ids.length === 0 && count > 0)
      throw new Error(
        "SoundCloud didn't send this playlist's track list, so it wasn't changed (that would empty it). Try again later."
      )
    return ids
  }

  /**
   * Replace the playlist's tracks with this id list, the way soundcloud.com's own editor
   * saves a set: `PUT playlists/{id}` with `{ playlist: { tracks: [id, ...] } }` (numeric
   * ids). Unverified with a login: the method, path and body shape are a best guess from
   * the web client's behaviour; nothing in the research doc confirms them.
   */
  private async writePlaylistTracks(nativeId: string, ids: string[]): Promise<void> {
    await this.api.request('PUT', `playlists/${nativeId}`, {
      body: { playlist: { tracks: ids.map(Number) } },
      auth: 'required'
    })
  }

  private nativeIdOf(track: Track): string {
    if (!track || track.provider !== 'soundcloud')
      throw new Error(`Not a SoundCloud track: ${String(track?.id)}`)
    assertScId(track.nativeId)
    return track.nativeId
  }

  private async getLikedIds(): Promise<Set<string>> {
    if (this.likedIds && this.now() - this.likedIds.at < LIKED_IDS_TTL_MS) return this.likedIds.ids
    await this.deps.requireUser()
    const ids = new Set<string>()
    // Shape unverified: accept `{collection: [ids]}` pages or a bare array.
    let next: string | null = this.api.url('me/track_likes/ids', { limit: 5000 }).toString()
    for (let i = 0; next && i < 100; i++) {
      const res: unknown = await this.api.get(next, undefined, 'required')
      const list = Array.isArray(res)
        ? res
        : Array.isArray((res as { collection?: unknown })?.collection)
          ? (res as { collection: unknown[] }).collection
          : []
      for (const v of list) {
        const id = typeof v === 'number' || typeof v === 'string' ? String(v) : idOf(v as object)
        if (id && ID_RE.test(id)) ids.add(id)
      }
      const href = Array.isArray(res) ? null : (res as { next_href?: unknown })?.next_href
      next = typeof href === 'string' && href ? href : null
    }
    this.likedIds = { at: this.now(), ids }
    return ids
  }

  private mapTracks(raws: (ScTrack | null)[]): Track[] {
    const out: Track[] = []
    for (const raw of raws) {
      const t = mapTrack(raw)
      if (!t || !raw) continue
      this.remember(raw)
      out.push(t)
    }
    return out
  }

  private remember(raw: ScTrack): void {
    const id = idOf(raw)
    if (!id || isStub(raw) || !raw.media) return
    if (this.tracks.size >= TRACK_CACHE_MAX) {
      const oldest = this.tracks.keys().next().value
      if (oldest !== undefined) this.tracks.delete(oldest)
    }
    this.tracks.delete(id)
    this.tracks.set(id, { at: this.now(), raw })
  }

  private async getTrack(id: string, auth: 'optional' | 'required'): Promise<ScTrack> {
    const hit = this.tracks.get(id)
    if (hit && this.now() - hit.at < TRACK_CACHE_TTL_MS) return hit.raw
    let raw: ScTrack | undefined
    try {
      raw = await this.api.get<ScTrack>(`tracks/${id}`, undefined, auth)
    } catch (err) {
      if (err instanceof SoundCloudApiError && err.status === 404)
        throw new UnplayableTrackError('blocked', UNPLAYABLE_MESSAGES.blocked)
      throw err
    }
    if (!raw || !idOf(raw)) throw new UnplayableTrackError('blocked', UNPLAYABLE_MESSAGES.blocked)
    this.remember(raw)
    return raw
  }
}

/**
 * Playlist objects out of library/playlist collections. Items are either playlists
 * themselves or wrappers like `{type: 'playlist-like', playlist: {...}}`; system
 * playlists (stations, "Weekly") and anything without a numeric id are skipped.
 */
export function extractPlaylists(items: unknown[]): ScPlaylist[] {
  const out: ScPlaylist[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const candidate = (
      o.kind === 'playlist' ? o : typeof o.playlist === 'object' && o.playlist ? o.playlist : null
    ) as ScPlaylist | null
    if (!candidate || candidate.kind !== 'playlist' || !idOf(candidate)) continue
    out.push(candidate)
  }
  return out
}
