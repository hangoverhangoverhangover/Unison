// SoundCloud api-v2 JSON -> shared domain types, plus the pure helpers the provider
// relies on (availability, transcoding choice, artwork size, waveform, URL expiry).
// Field facts: docs/research/soundcloud-api.md sections 7, 8 and 10.
import type { TrackComment } from '@shared/provider'
import type { FeedItem } from '@shared/soundcloud'
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

export interface ScUser {
  id: number | string
  username?: string
  avatar_url?: string | null
  permalink?: string
  permalink_url?: string | null
  followers_count?: number | null
  verified?: boolean
  track_count?: number | null
  /** Profile banner(s). */
  visuals?: { visuals?: ({ visual_url?: string | null } | null)[] | null } | null
}

export interface ScTranscoding {
  url: string
  preset?: string
  duration?: number
  snipped?: boolean
  format?: { protocol?: string; mime_type?: string }
  quality?: string
  is_legacy_transcoding?: boolean
}

export interface ScTrack {
  id: number | string
  kind?: string
  title?: string
  duration?: number
  full_duration?: number
  artwork_url?: string | null
  user?: ScUser | null
  user_id?: number | string
  publisher_metadata?: { artist?: string | null; isrc?: string | null } | null
  media?: { transcodings?: ScTranscoding[] | null } | null
  policy?: string
  streamable?: boolean
  track_authorization?: string
  secret_token?: string | null
  waveform_url?: string | null
  downloadable?: boolean
  has_downloads_left?: boolean
  commentable?: boolean
  permalink_url?: string
  description?: string | null
  genre?: string | null
  /** Space-separated; multi-word tags are in double quotes. */
  tag_list?: string | null
  playback_count?: number | null
  likes_count?: number | null
  reposts_count?: number | null
  comment_count?: number | null
  created_at?: string | null
}

export interface ScPlaylist {
  id: number | string
  kind?: string
  title?: string
  description?: string | null
  artwork_url?: string | null
  user?: ScUser | null
  user_id?: number | string
  track_count?: number
  tracks?: ScTrack[] | null
  secret_token?: string | null
  is_album?: boolean
  /** 'album' | 'ep' | 'single' | 'compilation', or '' for plain playlists. */
  set_type?: string | null
  release_date?: string | null
  published_at?: string | null
  display_date?: string | null
  permalink_url?: string | null
}

export interface ScLike {
  created_at?: string
  kind?: string
  track?: ScTrack | null
}

/** One entry of `stream` or `stream/users/:id/reposts` (shape confirmed live 2026-11-12). */
export interface ScStreamItem {
  type?: string
  created_at?: string | null
  /** Who posted or reposted it. */
  user?: ScUser | null
  uuid?: string
  track?: ScTrack | null
  playlist?: ScPlaylist | null
}

export interface ScComment {
  id: number | string
  body?: string
  timestamp?: number | null
  created_at?: string
  user?: ScUser | null
  user_id?: number | string
}

export type Availability = 'preview' | 'blocked' | 'drm'

function protocolOf(t: ScTranscoding): string {
  return (t.format?.protocol ?? '').toLowerCase()
}

/** `ctr-encrypted-hls` (Widevine/PlayReady), `cbc-encrypted-hls` (FairPlay), or any future `*-encrypted-*`. */
export function isEncrypted(t: ScTranscoding): boolean {
  const p = protocolOf(t)
  return p.startsWith('ctr-') || p.startsWith('cbc-') || p.includes('encrypted')
}

/** Clear (unencrypted) protocols plain hls.js or `<audio>` can play. */
function isClear(t: ScTranscoding): boolean {
  const p = protocolOf(t)
  return (p === 'hls' || p === 'progressive') && !isEncrypted(t)
}

function transcodingsOf(raw: ScTrack): ScTranscoding[] {
  const list = raw.media?.transcodings
  return Array.isArray(list) ? list.filter((t) => t && typeof t.url === 'string' && t.url) : []
}

/**
 * Why a track can't be played in full, or undefined when it can.
 * - blocked: `policy: BLOCK`, `streamable: false`, or no transcodings at all (BLOCK shape
 *   is inferred; no sample was found).
 * - preview: `policy: SNIP`, or the only playable transcodings are `snipped` 30 s clips.
 * - drm: the full track exists only as `ctr-`/`cbc-encrypted-hls`.
 */
export function classifyAvailability(raw: ScTrack): Availability | undefined {
  const policy = (raw.policy ?? '').toUpperCase()
  const list = transcodingsOf(raw)
  if (policy === 'BLOCK' || raw.streamable === false || list.length === 0) return 'blocked'
  if (policy === 'SNIP') return 'preview'
  if (list.some((t) => isClear(t) && !t.snipped)) return undefined
  if (list.some((t) => isEncrypted(t) && !t.snipped)) return 'drm'
  if (list.some((t) => t.snipped)) return 'preview'
  return 'blocked'
}

/** Higher is better; undefined means never use it. */
function transcodingScore(t: ScTranscoding): number | undefined {
  if (t.snipped || !isClear(t)) return undefined
  const preset = (t.preset ?? '').toLowerCase()
  const mime = (t.format?.mime_type ?? '').toLowerCase()
  const quality = (t.quality ?? '').toLowerCase()
  if (protocolOf(t) === 'progressive') return 60
  // Adaptive master playlist; yt-dlp calls it broken, so it's the last resort.
  if (preset.startsWith('abr') || mime.includes('mpegurl')) return 50
  if (preset.startsWith('aac') || mime.includes('mp4a')) {
    if (quality === 'hq') return 110
    if (preset.includes('160')) return 100
    return 90
  }
  if (preset.startsWith('mp3') || mime.includes('mpeg')) return 80
  if (preset.startsWith('opus') || mime.includes('ogg')) return 70
  return 55
}

/**
 * Best clear full-length transcoding: HLS AAC 160 > HLS AAC 96 > HLS MP3 > progressive.
 * Never a snipped preview, never an encrypted one.
 */
export function pickTranscoding(raw: ScTrack): ScTranscoding | undefined {
  let best: ScTranscoding | undefined
  let bestScore = -1
  for (const t of transcodingsOf(raw)) {
    const s = transcodingScore(t)
    if (s !== undefined && s > bestScore) {
      best = t
      bestScore = s
    }
  }
  return best
}

/**
 * Best full-length Widevine stream (`ctr-encrypted-hls`, CENC fMP4) for tracks with no
 * clear transcoding. FairPlay `cbc-` streams are Safari-only and never chosen.
 */
export function pickEncryptedTranscoding(raw: ScTrack): ScTranscoding | undefined {
  let best: ScTranscoding | undefined
  let bestScore = -1
  for (const t of transcodingsOf(raw)) {
    if (t.format?.protocol !== 'ctr-encrypted-hls' || t.snipped || typeof t.url !== 'string')
      continue
    const preset = String(t.preset ?? '')
    const s = preset.includes('160')
      ? 3
      : preset.includes('96')
        ? 2
        : preset.startsWith('aac')
          ? 1
          : 0
    if (s > bestScore) {
      best = t
      bestScore = s
    }
  }
  return best
}

/** SoundCloud's Widevine license server; the web player appends the stream's token. */
export const WIDEVINE_LICENSE_URL =
  'https://license.media-streaming.soundcloud.cloud/playback/widevine'

const ART_SIZES =
  'mini|tiny|small|badge|t67x67|large|t300x300|crop|t500x500|t120x120|t200x200|t240x240'

/** `...-large.jpg` (100 px) -> `...-t500x500.jpg`. `-original` and unknown names are left alone. */
export function upsizeArtwork(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return url.replace(new RegExp(`-(?:${ART_SIZES})\\.(jpg|jpeg|png)(?=$|\\?)`), '-t500x500.$1')
}

function idString(id: number | string | undefined | null): string | undefined {
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  if (typeof id === 'string' && /^\d+$/.test(id)) return id
  return undefined
}

/** A playlist entry that only has `{id, kind, monetization_model, policy}`. */
export function isStub(raw: ScTrack): boolean {
  return typeof raw.title !== 'string' || !raw.user
}

/** Null for missing, non-track or id-less objects. */
export function mapTrack(raw: ScTrack | null | undefined): Track | null {
  if (!raw || typeof raw !== 'object') return null
  if (raw.kind !== undefined && raw.kind !== 'track') return null
  const id = idString(raw.id)
  if (!id) return null
  const artist = raw.publisher_metadata?.artist?.trim() || raw.user?.username || ''
  const track: Track = {
    id: trackId('soundcloud', id),
    provider: 'soundcloud',
    nativeId: id,
    title: raw.title ?? '',
    artists: artist ? [artist] : [],
    durationMs: raw.full_duration ?? raw.duration ?? 0
  }
  const art = upsizeArtwork(raw.artwork_url) ?? upsizeArtwork(raw.user?.avatar_url)
  if (art) track.artworkUrl = art
  const isrc = raw.publisher_metadata?.isrc
  if (isrc) track.isrc = isrc
  if (raw.permalink_url) track.url = raw.permalink_url
  // The ref always points at the uploader's profile, even when the display artist
  // comes from publisher_metadata.
  const userId = idString(raw.user?.id) ?? idString(raw.user_id)
  if (userId && artist) {
    const ref: EntityRef = { id: trackId('soundcloud', userId), name: artist }
    if (raw.user?.permalink_url) ref.url = raw.user.permalink_url
    track.artistRefs = [ref]
  }
  const availability = classifyAvailability(raw)
  if (availability) track.availability = availability
  const uploader = raw.user?.username?.trim()
  if (uploader) track.uploader = uploader
  return titleCleaner ? titleCleaner(track) : track
}

/** Set at startup (QoL 4): tidies archive titles; see main/titles. Tests leave it unset. */
let titleCleaner: ((track: Track) => Track) | null = null
export function setTitleCleaner(fn: ((track: Track) => Track) | null): void {
  titleCleaner = fn
}

export function mapLike(raw: ScLike | null | undefined): LikedTrack | null {
  if (!raw || (raw.kind !== undefined && raw.kind !== 'like')) return null
  const track = mapTrack(raw.track)
  if (!track) return null
  return { track, likedAt: raw.created_at ?? '' }
}

export function mapPlaylist(
  raw: ScPlaylist | null | undefined,
  currentUserId: string | undefined
): Playlist | null {
  if (!raw || typeof raw !== 'object') return null
  if (raw.kind !== undefined && raw.kind !== 'playlist') return null
  const id = idString(raw.id)
  if (!id) return null
  const ownerId = idString(raw.user_id) ?? idString(raw.user?.id)
  const playlist: Playlist = {
    id: `soundcloud:${id}`,
    source: 'soundcloud',
    nativeId: id,
    name: raw.title ?? '',
    canEdit: !!currentUserId && ownerId === currentUserId
  }
  if (raw.description) playlist.description = raw.description
  const firstArt = (raw.tracks ?? []).find((t) => t?.artwork_url)?.artwork_url
  const art = upsizeArtwork(raw.artwork_url) ?? upsizeArtwork(firstArt)
  if (art) playlist.artworkUrl = art
  if (raw.user?.username) playlist.ownerName = raw.user.username
  if (typeof raw.track_count === 'number') playlist.trackCount = raw.track_count
  return playlist
}

export function userRef(raw: ScUser | null | undefined): EntityRef | null {
  const id = idString(raw?.id)
  if (!raw || !id) return null
  const ref: EntityRef = { id: trackId('soundcloud', id), name: raw.username ?? '' }
  if (raw.permalink_url) ref.url = raw.permalink_url
  return ref
}

/** A user profile as an artist: avatar upsized to 500 px, first visual as the banner. */
export function mapUser(raw: ScUser | null | undefined): Artist | null {
  const id = idString(raw?.id)
  if (!raw || !id) return null
  const artist: Artist = {
    id: trackId('soundcloud', id),
    provider: 'soundcloud',
    nativeId: id,
    name: raw.username ?? ''
  }
  const avatar = upsizeArtwork(raw.avatar_url)
  if (avatar) artist.imageUrl = avatar
  const banner = (raw.visuals?.visuals ?? []).find((v) => v?.visual_url)?.visual_url
  if (banner) artist.bannerUrl = banner
  if (typeof raw.followers_count === 'number') artist.followers = raw.followers_count
  if (typeof raw.verified === 'boolean') artist.verified = raw.verified
  if (raw.permalink_url) artist.url = raw.permalink_url
  return artist
}

const SET_TYPES = new Set<AlbumType>(['album', 'ep', 'single', 'compilation'])

/** set_type when it's a release type; plain sets are 'playlist' unless is_album. */
export function setType(raw: ScPlaylist): AlbumType {
  const t = (raw.set_type ?? '').toLowerCase() as AlbumType
  if (SET_TYPES.has(t)) return t
  return raw.is_album ? 'album' : 'playlist'
}

/** `2012-06-12T00:00:00Z` -> `2012-06-12`; anything else is passed through. */
function releaseDateOf(raw: ScPlaylist): string | undefined {
  const d = raw.release_date || raw.published_at || raw.display_date
  if (!d) return undefined
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(d)
  return m ? m[1] : d
}

/** Any set (album, EP, single, compilation or plain playlist) as an Album. */
export function mapSet(raw: ScPlaylist | null | undefined): Album | null {
  if (!raw || typeof raw !== 'object') return null
  if (raw.kind !== undefined && raw.kind !== 'playlist') return null
  const id = idString(raw.id)
  if (!id) return null
  const owner = userRef(raw.user)
  const album: Album = {
    id: trackId('soundcloud', id),
    provider: 'soundcloud',
    nativeId: id,
    name: raw.title ?? '',
    type: setType(raw),
    artists: owner ? [owner] : [],
    trackCount: typeof raw.track_count === 'number' ? raw.track_count : (raw.tracks ?? []).length
  }
  const firstArt = (raw.tracks ?? []).find((t) => t?.artwork_url)?.artwork_url
  const art =
    upsizeArtwork(raw.artwork_url) ?? upsizeArtwork(firstArt) ?? upsizeArtwork(raw.user?.avatar_url)
  if (art) album.artworkUrl = art
  const date = releaseDateOf(raw)
  if (date) album.releaseDate = date
  if (raw.permalink_url) album.url = raw.permalink_url
  return album
}

/** Untimed comments (`timestamp: null`) have no position in the track and are skipped. */
export function mapComment(raw: ScComment | null | undefined): TrackComment | null {
  if (!raw || typeof raw.timestamp !== 'number') return null
  const id = idString(raw.id)
  if (!id) return null
  const userId = idString(raw.user?.id) ?? idString(raw.user_id) ?? ''
  const author: TrackComment['author'] = { id: userId, username: raw.user?.username ?? '' }
  const avatar = raw.user?.avatar_url
  if (avatar) author.avatarUrl = avatar
  return {
    id,
    body: raw.body ?? '',
    timestampMs: raw.timestamp,
    createdAt: raw.created_at ?? '',
    author
  }
}

/**
 * `threaded=1` lists every comment, each thread as its top-level comment followed by
 * its replies; `threaded=0` lists only top-level comments. A comment missing from
 * `topLevelIds` is a reply to the top-level comment before it.
 */
export function threadComments(
  list: TrackComment[],
  topLevelIds: ReadonlySet<string>
): TrackComment[] {
  const out: TrackComment[] = []
  let parent: TrackComment | undefined
  for (const c of list) {
    if (parent && !topLevelIds.has(c.id)) {
      ;(parent.replies ??= []).push(c)
    } else {
      parent = { ...c }
      out.push(parent)
    }
  }
  for (const p of out) {
    if (p.replies) p.replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  return out.sort((a, b) => a.timestampMs - b.timestampMs)
}

/** `"hip hop" lofi chill` -> ['hip hop', 'lofi', 'chill']. */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  return [...raw.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2])!.trim()).filter(Boolean)
}

/** `{width, height, samples: int[0..height]}` -> samples scaled to 0..1. */
export function normalizeWaveform(raw: unknown): number[] {
  if (!raw || typeof raw !== 'object') return []
  const { samples, height } = raw as { samples?: unknown; height?: unknown }
  if (!Array.isArray(samples)) return []
  const nums = samples.map((s) => (typeof s === 'number' && Number.isFinite(s) ? s : 0))
  const h =
    typeof height === 'number' && height > 0 ? height : Math.max(0, ...nums.map(Math.abs)) || 1
  return nums.map((s) => Math.min(1, Math.max(0, s / h)))
}

/**
 * When a signed media URL stops working, epoch ms. CloudFront URLs carry `expires=<s>`;
 * canned-policy URLs carry a base64 `Policy` with `DateLessThan.AWS:EpochTime`.
 */
export function signedUrlExpiry(url: string): number | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  const expires = Number(u.searchParams.get('expires') ?? u.searchParams.get('Expires'))
  if (Number.isFinite(expires) && expires > 0) return expires * 1000
  const policy = u.searchParams.get('Policy')
  if (policy) {
    try {
      const b64 = policy.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/')
      const doc = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as {
        Statement?: { Condition?: { DateLessThan?: Record<string, unknown> } }[]
      }
      const t = Number(doc.Statement?.[0]?.Condition?.DateLessThan?.['AWS:EpochTime'])
      if (Number.isFinite(t) && t > 0) return t * 1000
    } catch {
      // Not a canned policy; expiry unknown.
    }
  }
  return undefined
}

/** True when a resolved stream URL is one of SoundCloud's 30 s preview clips. */
export function isPreviewUrl(url: string): boolean {
  return /\/preview\//.test(url) || /\/(preview|playlist)\/0\/30\//.test(url)
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/**
 * Old SoundCloud descriptions contain HTML (`<a href>`, `&nbsp;`). Turn it into plain
 * text: links become their text (plus the URL when it differs), other tags go, line
 * breaks stay. The renderer only ever shows this as text.
 */
export function plainText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(
      /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, text: string) => {
        const t = text.replace(/<[^>]+>/g, '').trim()
        return !t || t === href ? href : `${t} (${href})`
      }
    )
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code =
          e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

const FEED_TYPES: Record<string, Pick<FeedItem, 'kind' | 'type'>> = {
  track: { kind: 'track', type: 'post' },
  'track-repost': { kind: 'track', type: 'repost' },
  playlist: { kind: 'playlist', type: 'post' },
  'playlist-repost': { kind: 'playlist', type: 'repost' }
}

/**
 * A stream entry as a FeedItem. `by` is the entry's `user` (the poster or reposter),
 * falling back to `fallbackBy` and then the object's owner. Unknown types (promoted
 * entries and the like), undated entries and entries without a playable object are null.
 */
export function mapFeedItem(
  raw: ScStreamItem | null | undefined,
  fallbackBy?: ScUser | null
): FeedItem | null {
  if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') return null
  const shape = FEED_TYPES[raw.type]
  if (!shape) return null
  const ms = typeof raw.created_at === 'string' ? Date.parse(raw.created_at) : NaN
  if (!Number.isFinite(ms)) return null
  const obj = shape.kind === 'track' ? raw.track : raw.playlist
  const byRaw = raw.user ?? fallbackBy ?? obj?.user
  const byId = idString(byRaw?.id)
  if (!obj || !byRaw || !byId) return null
  const item: FeedItem = {
    id: '',
    kind: shape.kind,
    type: shape.type,
    createdAt: new Date(ms).toISOString(),
    by: { id: trackId('soundcloud', byId), name: byRaw.username ?? '' }
  }
  const avatar = upsizeArtwork(byRaw.avatar_url)
  if (avatar) item.by.avatarUrl = avatar
  if (shape.kind === 'track') {
    const track = mapTrack(raw.track)
    if (!track) return null
    item.track = track
    item.id = `${raw.type}:${track.nativeId}:${byId}:${item.createdAt}`
  } else {
    const set = mapSet(raw.playlist)
    if (!set) return null
    item.set = set
    item.id = `${raw.type}:${set.nativeId}:${byId}:${item.createdAt}`
  }
  return item
}
