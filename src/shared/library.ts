// Local library contracts (Phase 1). Owned by the main agent.

/**
 * Custom protocol for local media. Never expose raw file:// to the renderer.
 *   media://local/<nativeId>   audio bytes, supports HTTP Range (seeking)
 *   media://art/<artHash>      cached embedded artwork image
 */
export const MEDIA_SCHEME = 'media'

export function localAudioUrl(nativeId: string): string {
  return `${MEDIA_SCHEME}://local/${nativeId}`
}

export function artworkUrl(artHash: string): string {
  return `${MEDIA_SCHEME}://art/${artHash}`
}

/** Extensions the scanner picks up (lowercase, with dot). */
export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav'] as const

/** Likes reconciliation with the services (startup + every 30 min). */
export interface LikesSyncStatus {
  syncing: boolean
  /** ISO time of the last successful reconcile per service, null if never. */
  lastSyncedAt: { spotify: string | null; soundcloud: string | null }
  /** Last reconcile error per service (cleared by the next success). */
  errors: { spotify?: string; soundcloud?: string }
}

export type ScanStatus =
  { state: 'idle'; trackCount: number } | { state: 'scanning'; scanned: number; total: number }

/**
 * How the sidebar shows playlists (QoL round). Ids are playlist app ids
 * (`app:<uuid>`, `spotify:<id>`, `soundcloud:<id>`).
 */
export interface PlaylistPrefs {
  /** Sidebar order. Playlists missing from it go first, newest app playlists on top. */
  order: string[]
  /** Kept out of the sidebar; still listed in the Library tab. */
  hidden: string[]
}
