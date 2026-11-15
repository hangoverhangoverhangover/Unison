// Phase 8 contracts: "Find on the other service" and the mini player. Owned by the main agent.
import type { PlaybackStatus, RepeatMode } from './playback'
import type { Track } from './types'

/** Why a candidate counts as the same song. */
export type MatchReason = 'isrc' | 'title-artist'

export interface TrackMatch {
  track: Track
  reason: MatchReason
}

export interface FindResult {
  /** The service that was searched. */
  service: 'spotify' | 'soundcloud'
  /** Best first: ISRC matches, then title-plus-artist matches. Empty when nothing matched. */
  matches: TrackMatch[]
}

/** What the mini player shows. Sent by the main window only while the mini player is open. */
export interface MiniState {
  track: Track | null
  status: PlaybackStatus
  /** Position at `at` (epoch ms); the mini player extrapolates while playing. */
  positionMs: number
  at: number
  durationMs: number
  shuffle: boolean
  repeat: RepeatMode
  /** Something is queued after the current track. */
  hasNext: boolean
}

/** Controls the mini player sends to the main window's playback controller. */
export type MiniCommand =
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
