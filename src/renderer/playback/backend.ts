// Provider-neutral playback backend. The audio-element backend (local files now,
// SoundCloud later) and the Spotify Web Playback SDK backend (Phase 2) both fit this.

import type { Track } from '@shared/types'

export type BackendEvent =
  | { type: 'ended' }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'waiting' }
  | { type: 'error'; message: string }
  /** The real duration is known or changed; read it with getDurationMs(). */
  | { type: 'duration'; durationMs: number }

export interface LoadOptions {
  /**
   * The controller will call play() right after this load resolves. A backend may
   * start playing during load() instead of loading paused (play() is then a no-op).
   */
  autoplay?: boolean
  /**
   * What the queue plays after this track, in order. A backend may hand these to its
   * service so the next track starts without a gap; the following load() of that track
   * then adopts what is already playing. Empty when repeat-one is on.
   */
  upcoming?: Track[]
}

export interface PlaybackBackend {
  /** Can this backend play the track? (audio backend: provider 'local' now; SoundCloud later) */
  canPlay(track: Track): boolean
  /**
   * Load a track, resolving once it can start playing. Rejects with a readable
   * Error on failure (and does not also emit an 'error' event for that failure).
   * A newer load cancels an older pending one, which rejects with LoadAbortedError.
   */
  load(track: Track, startMs?: number, opts?: LoadOptions): Promise<void>
  play(): Promise<void>
  pause(): void
  seek(ms: number): void
  /** volume 0..1 */
  setVolume(volume: number, muted: boolean): void
  getPositionMs(): number
  /** 0 when unknown. */
  getDurationMs(): number
  /** Stop and release the current source. Events stop until the next load. */
  stop(): void
  /** Returns unsubscribe. Events: 'ended', 'playing', 'paused', 'waiting', 'error' (with message), 'duration' */
  on(handler: (e: BackendEvent) => void): () => void
}

/** Rejection reason for a load superseded by a newer load or a stop(). Not a real error. */
export class LoadAbortedError extends Error {
  constructor() {
    super('Load aborted')
    this.name = 'LoadAbortedError'
  }
}

export function isLoadAborted(err: unknown): boolean {
  return (
    err instanceof LoadAbortedError ||
    (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError')
  )
}
