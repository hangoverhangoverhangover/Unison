// Cross-service tools (QoL round 2): copy a playlist, find duplicates. Owned by the main agent.
import type { Track } from './types'

/**
 * How sure a match is. Every match is shown to the user to confirm (user's rule:
 * even exact artist + title matches are prompted).
 * - isrc: same ISRC.
 * - exact: same artist and same title after cleanup (feat./remaster tags, a leading
 *   "<artist> - " on SoundCloud archive uploads).
 * - close: titles contain each other / artist matches loosely.
 */
export type MatchConfidence = 'isrc' | 'exact' | 'close'

/** A song being added that a playlist already has (QoL 4). */
export interface AlreadyInPlaylist {
  /** The song being added. */
  track: Track
  /** The playlist's copy. */
  match: Track
  /** The very same track (same id), not just the same song on another service. */
  sameTrack: boolean
}

export interface TransferCandidate {
  /** The track in the source playlist. */
  source: Track
  /** Best match on the target service, best first (max 5). Empty = not found. */
  matches: { track: Track; confidence: MatchConfidence }[]
}

export interface TransferPlan {
  sourcePlaylistId: string
  target: 'spotify' | 'soundcloud'
  candidates: TransferCandidate[]
}

/** What the user confirmed: one chosen target track per source track (or skipped). */
export interface TransferRequest {
  target: 'spotify' | 'soundcloud'
  /** New playlist's name. */
  name: string
  /** Target tracks in source order. */
  tracks: Track[]
}

export interface TransferResult {
  /** App id of the playlist created on the target (`spotify:<id>` / `soundcloud:<id>`). */
  playlistId: string
  added: number
}

/** Tracks that look like the same song across Liked Songs and local files. */
export interface DuplicateGroup {
  /** Stable key for the group (for "not duplicates" dismissals). */
  key: string
  confidence: MatchConfidence
  tracks: Track[]
}
