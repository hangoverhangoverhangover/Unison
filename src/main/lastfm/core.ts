// Last.fm pure helpers: request signing, what to scrobble, the offline queue and how to
// treat errors. No Electron, no network: see ./service.ts for those.
import { createHash } from 'crypto'
import { stripArchiveNoise } from '@shared/scTitle'
import type { LastfmArtist } from '@shared/lastfm'
import type { Track } from '@shared/types'

/** Scrobbles sent per request (Last.fm's batch limit). */
export const BATCH = 50
/** Most scrobbles kept waiting while offline. */
export const MAX_QUEUE = 1000
/** Last.fm ignores scrobbles much older than this; older ones are dropped. */
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/** One scrobble waiting to be sent. timestamp: UTC seconds when the track started. */
export interface QueuedScrobble {
  artist: string
  track: string
  timestamp: number
  album?: string
  durationS?: number
}

/**
 * api_sig: every parameter except format/callback (and api_sig itself), sorted by
 * name, as name+value with no separators, then the shared secret; MD5 hex of the
 * UTF-8 bytes.
 */
export function apiSig(params: Record<string, string>, secret: string): string {
  const body = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback' && k !== 'api_sig')
    .sort()
    .map((k) => k + params[k])
    .join('')
  return createHash('md5')
    .update(body + secret, 'utf8')
    .digest('hex')
}

/**
 * SoundCloud and local files always; Spotify only when asked (Spotify's own Last.fm
 * link already scrobbles it). A track needs an artist and a title.
 */
export function shouldScrobble(track: Track, scrobbleSpotify: boolean): boolean {
  if (track.provider === 'spotify' && !scrobbleSpotify) return false
  return !!track.artists[0]?.trim() && !!track.title.trim()
}

export function toQueued(track: Track, startedAt: number): QueuedScrobble {
  const q: QueuedScrobble = {
    // Several artists from your own title fix go as one string, like collabs; otherwise
    // the main artist (Spotify lists features as extra artists).
    artist:
      track.titleGuess === 'user'
        ? track.artists
            .map((a) => a.trim())
            .filter(Boolean)
            .join(', ')
        : track.artists[0]!.trim(),
    // Archive labels like "(unreleased)" or "[CDQ]" don't belong on Last.fm.
    track:
      track.provider === 'soundcloud' ? stripArchiveNoise(track.title.trim()) : track.title.trim(),
    timestamp: Math.floor(startedAt / 1000)
  }
  if (track.album?.trim()) q.album = track.album.trim()
  if (track.durationMs > 0) q.durationS = Math.round(track.durationMs / 1000)
  return q
}

/** Add to the waiting list: oldest first, too-old ones dropped, newest MAX_QUEUE kept. */
export function enqueue(
  queue: QueuedScrobble[],
  items: QueuedScrobble[],
  now: number
): QueuedScrobble[] {
  const cutoff = Math.floor((now - MAX_AGE_MS) / 1000)
  return [...queue, ...items]
    .filter((s) => s.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_QUEUE)
}

/** track.scrobble parameters for up to BATCH items: artist[i], track[i], timestamp[i], ... */
export function batchParams(items: QueuedScrobble[]): Record<string, string> {
  const out: Record<string, string> = {}
  items.slice(0, BATCH).forEach((s, i) => {
    out[`artist[${i}]`] = s.artist
    out[`track[${i}]`] = s.track
    out[`timestamp[${i}]`] = String(s.timestamp)
    if (s.album) out[`album[${i}]`] = s.album
    if (s.durationS) out[`duration[${i}]`] = String(s.durationS)
  })
  return out
}

/**
 * What to do after a Last.fm error code: 11 (offline), 16 (temporary) and 29 (rate
 * limit) are worth retrying later; 9 means the session was revoked (log in again);
 * anything else won't get better by retrying.
 */
export function classifyError(code: number): 'retry' | 'reauth' | 'drop' {
  if (code === 11 || code === 16 || code === 29) return 'retry'
  if (code === 9) return 'reauth'
  return 'drop'
}

export type { LastfmArtist }

/** Last.fm's bios are HTML ending in a "Read more on Last.fm" link; keep plain text. */
export function plainBio(html: string): string {
  return html
    .replace(/<a\b[^>]*>\s*Read more on Last\.fm\s*<\/a>\.?/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The artist.getInfo reply, or null when it has no artist. */
export function parseArtistInfo(json: Record<string, unknown>): LastfmArtist | null {
  const a = json.artist as Record<string, unknown> | undefined
  if (!a || typeof a.name !== 'string') return null
  const out: LastfmArtist = { name: a.name, tags: [] }
  if (typeof a.url === 'string') out.url = a.url
  const bio = (a.bio as { summary?: unknown } | undefined)?.summary
  if (typeof bio === 'string' && plainBio(bio)) out.bio = plainBio(bio)
  const tags = (a.tags as { tag?: unknown } | undefined)?.tag
  if (Array.isArray(tags))
    out.tags = tags
      .map((t) => (t as { name?: unknown })?.name)
      .filter((n): n is string => typeof n === 'string')
      .slice(0, 5)
  const listeners = Number((a.stats as { listeners?: unknown } | undefined)?.listeners)
  if (Number.isFinite(listeners) && listeners > 0) out.listeners = listeners
  return out
}
