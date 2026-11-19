// Last.fm scrobbling (QoL 3). Each user adds their own Last.fm API account (key +
// shared secret) in Settings; nothing secret ships with the app.
import type { Track } from './types'

export interface LastfmStatus {
  /** An API key and shared secret are saved. */
  hasKeys: boolean
  /** Last 4 characters of the saved API key, to recognise it. */
  keyHint?: string
  state: 'disconnected' | 'authorizing' | 'connected' | 'expired'
  /** Last.fm username while connected. */
  username?: string
  /** Also scrobble Spotify (off: Spotify's own Last.fm link already scrobbles). */
  scrobbleSpotify: boolean
  /** Scrobbles waiting to be sent (offline, or Last.fm was down). */
  pending: number
  /** The last problem, readable. */
  error?: string
}

/** A finished listen, ready to scrobble. */
export interface ScrobbleReport {
  track: Track
  /** Epoch ms when the track started playing. */
  startedAt: number
}

/** Last.fm's rule: tracks of 30 s or less never scrobble. */
export const SCROBBLE_MIN_TRACK_MS = 30_000
/** ... and a longer track counts after half of it, or 4 minutes, whichever comes first. */
export const SCROBBLE_MAX_WAIT_MS = 240_000

/** How long a track must have actually played before it scrobbles, or null if never. */
export function scrobbleAfterMs(durationMs: number): number | null {
  if (!(durationMs > SCROBBLE_MIN_TRACK_MS)) return null
  return Math.min(durationMs / 2, SCROBBLE_MAX_WAIT_MS)
}

/** Where to create a Last.fm API account (key + shared secret). */
export const LASTFM_API_ACCOUNT_URL = 'https://www.last.fm/api/account/create'
