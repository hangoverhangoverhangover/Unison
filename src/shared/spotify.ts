// Spotify-specific contracts (Phase 2). Owned by the main agent.
// Reference: docs/research/spotify-web-api.md

/** Loopback redirect. Port is chosen at runtime; register `http://127.0.0.1/callback` (no port). */
export const SPOTIFY_REDIRECT_PATH = '/callback'

export const SPOTIFY_SCOPES = [
  'streaming', // Web Playback SDK
  'user-read-email', // the SDK's own tutorial requires these two alongside streaming
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state', // transfer + play on the SDK device
  'user-library-read', // GET /me/tracks, /me/library/contains
  'user-library-modify', // PUT/DELETE /me/library
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public'
] as const

/**
 * Requested at login with SPOTIFY_SCOPES, but never required: a saved login without them
 * stays connected, and only the features that need them ask the user to log in again.
 */
export const SPOTIFY_OPTIONAL_SCOPES = [
  'user-follow-read' // GET /me/following (spotify:getFollowings)
] as const

export type SpotifyStatus =
  | { state: 'disconnected'; hasKey: boolean }
  /**
   * User must log in again. `refresh`: refresh token expired (6 months) or revoked.
   * `permissions`: the saved login predates scopes the app now needs.
   */
  | { state: 'expired'; reason: 'refresh' | 'permissions' }
  | { state: 'connected'; displayName: string; accountId: string }

export function spotifyUri(nativeId: string): string {
  return `spotify:track:${nativeId}`
}

/** Settings → Spotify → Client ID (QoL: bring your own Spotify developer app). */
export interface SpotifyClientIdSetting {
  /** The ID entered in Settings ('' = none; the build/config one is used). */
  clientId: string
  /** Where the ID the app will use comes from. */
  source: 'settings' | 'build' | 'none'
  /** The saved ID differs from the one running now: restart to apply. */
  needsRestart: boolean
}
