import type { Track } from './types'

export type RepeatMode = 'off' | 'all' | 'one'

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

/** One entry in the queue. `uid` is unique per entry, so a track can be queued twice. */
export interface QueueItem {
  uid: string
  track: Track
}

/**
 * The single state stream the UI, OS media session and (later) Discord RPC read.
 * `positionMs` is a snapshot taken at the last state change, not a ticking value;
 * read live position from `PlaybackController.getPositionMs()` in a rAF loop.
 */
export interface PlaybackState {
  status: PlaybackStatus
  current: QueueItem | null
  /** Upcoming items in play order (shuffle already applied). */
  queue: QueueItem[]
  positionMs: number
  durationMs: number
  /** 0..1 */
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  error?: string
}

/** A hardware media key, caught system-wide by main while the app has a track loaded. */
export type MediaKey = 'playpause' | 'next' | 'previous' | 'stop'

/** Saved on change and restored on launch (QoL round 2). */
export interface SessionSnapshot {
  /** Current track first, then the queue in play order. */
  current: QueueItem | null
  queue: QueueItem[]
  positionMs: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  /** ISO 8601 of the save. */
  savedAt: string
}

/** Small now-playing summary for the tray (sent whenever it changes). */
export interface NowPlaying {
  title: string
  artists: string
  playing: boolean
}

/** Audio settings for the audio-element backend (SoundCloud and local; not Spotify or DRM). */
export interface AudioSettings {
  /** Even out loudness between tracks. */
  levelling: boolean
  /** Fade between tracks, ms (0 = off, max 12000). */
  crossfadeMs: number
  eq: {
    enabled: boolean
    /** Gain per band in dB, -12..12, for EQ_BANDS_HZ. */
    gains: number[]
  }
}

/** Ten-band graphic EQ centre frequencies. */
export const EQ_BANDS_HZ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

export const DEFAULT_AUDIO: AudioSettings = {
  levelling: false,
  crossfadeMs: 0,
  eq: { enabled: false, gains: EQ_BANDS_HZ.map(() => 0) }
}
