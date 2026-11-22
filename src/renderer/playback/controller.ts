// The renderer playback controller. Owns the queue, picks a backend per track,
// and emits one immutable PlaybackState stream for the UI, the OS media session
// and (later) Discord RPC. Position is not part of the stream's ticks: read it
// live with getPositionMs() in a requestAnimationFrame loop.

import type { PlaybackState, PlaybackStatus, RepeatMode, SessionSnapshot } from '@shared/playback'
import { isPlayable, type Track } from '@shared/types'
import { isLoadAborted, type BackendEvent, type PlaybackBackend } from './backend'
import { createAudioBackend } from './audioBackend'
import { createSpotifyBackend } from './spotifyBackend'
import * as Q from './queue'

export interface PlaybackController {
  playTracks(tracks: Track[], startIndex: number): Promise<void>
  play(): Promise<void>
  pause(): void
  toggle(): Promise<void>
  seek(ms: number): void
  next(): Promise<void>
  previous(): Promise<void>
  setVolume(v: number): void
  setMuted(m: boolean): void
  setShuffle(on: boolean): void
  /** off -> all -> one -> off */
  cycleRepeat(): void
  playNext(tracks: Track[]): void
  addToQueue(tracks: Track[]): void
  moveInQueue(from: number, to: number): void
  removeFromQueue(uid: string): void
  clearQueue(): void
  /** Change a track's details everywhere in the queue (QoL 4: a fixed title). */
  updateTrack(trackId: string, patch: Partial<Track>): void
  /** Live position, for a requestAnimationFrame progress bar. */
  getPositionMs(): number
  /** Immutable snapshot. */
  getState(): PlaybackState
  subscribe(listener: (s: PlaybackState) => void): () => void
  /**
   * Put back a saved session (queue, current track at a position, volume, shuffle,
   * repeat) without starting playback. Ignored once something has been played.
   */
  restore(snapshot: SessionSnapshot): Promise<void>
  dispose(): void
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface ControllerDeps {
  /** Where volume/muted persist. Defaults to window.localStorage; null disables. */
  storage?: KeyValueStorage | null
  /** RNG and uid factory for the queue (tests). */
  queue?: Q.QueueDeps
  /** Delay before skipping past a broken track. Default 1000ms. */
  errorSkipDelayMs?: number
}

export const VOLUME_KEY = 'player.volume'
export const MUTED_KEY = 'player.muted'
/** previous() restarts the current track instead when past this position. */
export const RESTART_THRESHOLD_MS = 3000
const DEFAULT_VOLUME = 0.8
export const NONE_PLAYABLE_MESSAGE = 'None of these tracks can be played here.'

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

export function createPlaybackController(
  backends: PlaybackBackend[],
  deps: ControllerDeps = {}
): PlaybackController {
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage
  const queueDeps = deps.queue
  const errorSkipDelayMs = deps.errorSkipDelayMs ?? 1000

  let q: Q.QueueState = Q.emptyQueue
  let status: PlaybackStatus = 'idle'
  let repeat: RepeatMode = 'off'
  let durationMs = 0
  let error: string | undefined
  let volume = DEFAULT_VOLUME
  let muted = false
  let active: PlaybackBackend | null = null
  /** Whether the user wants sound: survives loads, so pause() during loading sticks. */
  let wantPlay = false
  /** Bumped on every load; async continuations from older loads are dropped. */
  let loadToken = 0
  /** The load token that already failed, so a track's error is handled once. */
  let failedToken = -1
  /** Consecutive broken tracks; skipping stops once this covers the whole context. */
  let consecutiveErrors = 0
  let skipTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  const listeners = new Set<(s: PlaybackState) => void>()

  // Restore persisted volume.
  try {
    const v = storage?.getItem(VOLUME_KEY)
    if (v != null && v !== '' && Number.isFinite(Number(v))) volume = clamp01(Number(v))
    const m = storage?.getItem(MUTED_KEY)
    if (m != null) muted = m === 'true'
  } catch {
    // storage unavailable: keep defaults
  }
  for (const b of backends) b.setVolume(volume, muted)

  const persistVolume = (): void => {
    try {
      storage?.setItem(VOLUME_KEY, String(volume))
      storage?.setItem(MUTED_KEY, String(muted))
    } catch {
      // ignore quota/security errors
    }
  }

  /** How many times the queue ran out on its own (see PlaybackState.endedAt). */
  let endedCount = 0

  const livePosition = (): number => (active && q.current ? active.getPositionMs() : 0)

  const snapshot = (positionMs: number): PlaybackState =>
    Object.freeze({
      status,
      current: q.current,
      queue: Object.freeze(q.upcoming.slice()) as PlaybackState['queue'],
      positionMs,
      durationMs,
      volume,
      muted,
      shuffle: q.shuffle,
      repeat,
      ...(error !== undefined ? { error } : {}),
      ...(endedCount > 0 ? { endedAt: endedCount } : {})
    })

  let state: PlaybackState = snapshot(0)

  const changed = (a: PlaybackState, b: PlaybackState): boolean =>
    a.status !== b.status ||
    a.current !== b.current ||
    a.durationMs !== b.durationMs ||
    a.volume !== b.volume ||
    a.muted !== b.muted ||
    a.shuffle !== b.shuffle ||
    a.repeat !== b.repeat ||
    a.error !== b.error ||
    a.endedAt !== b.endedAt ||
    a.queue.length !== b.queue.length ||
    a.queue.some((item, i) => item !== b.queue[i])

  /** Emit a new snapshot if anything changed. `seekedTo` forces an emit (seek). */
  const emit = (seekedTo?: number): void => {
    if (disposed) return
    const next = snapshot(seekedTo ?? livePosition())
    if (seekedTo === undefined && !changed(state, next)) return
    state = next
    for (const l of [...listeners]) l(state)
  }

  const clearSkipTimer = (): void => {
    if (skipTimer !== null) clearTimeout(skipTimer)
    skipTimer = null
  }

  /**
   * Step past unplayable tracks (availability preview/blocked/drm) without loading
   * them. Returns null when `step` runs out before reaching a playable track.
   */
  const skipUnplayable = (
    from: Q.QueueState | null,
    step: (s: Q.QueueState) => Q.QueueState | null
  ): Q.QueueState | null => {
    let s = from
    // Bounded: repeat 'all' wraps, so an all-unplayable context would loop.
    for (let left = s ? Q.contextSize(s) : 0; s?.current && !isPlayable(s.current.track); left--) {
      if (left <= 0) return null
      s = step(s)
    }
    return s
  }
  const nextPlayable = (mode: RepeatMode = repeat): Q.QueueState | null =>
    skipUnplayable(Q.next(q, mode, queueDeps), (s) => Q.next(s, mode, queueDeps))
  const previousPlayable = (): Q.QueueState | null => skipUnplayable(Q.previous(q), Q.previous)

  const backendFor = (track: Track): PlaybackBackend | undefined =>
    backends.find((b) => b.canPlay(track))

  const failTrack = (token: number, message: string): void => {
    if (token !== loadToken || token === failedToken || disposed) return
    failedToken = token
    clearSkipTimer()
    status = 'error'
    error = message
    consecutiveErrors++
    emit()
    // Skip ahead unless this is the last track, or every track in the context
    // has failed in a row (an all-broken queue with repeat 'all' must not loop).
    if (consecutiveErrors >= Q.contextSize(q)) return
    if (!nextPlayable()) return
    skipTimer = setTimeout(() => {
      skipTimer = null
      if (token !== loadToken || disposed) return
      const advanced = nextPlayable()
      if (!advanced) return
      q = advanced
      void load()
    }, errorSkipDelayMs)
  }

  /** Load q.current on the right backend, then play if wantPlay. */
  const load = async (startMs = 0): Promise<void> => {
    clearSkipTimer()
    const token = ++loadToken
    const item = q.current
    if (!item) {
      active?.stop()
      active = null
      status = 'idle'
      error = undefined
      durationMs = 0
      emit()
      return
    }
    if (!isPlayable(item.track)) {
      // Callers skip these; reaching one here (e.g. play() on it) never loads it.
      active?.stop()
      active = null
      wantPlay = false
      status = 'error'
      error = NONE_PLAYABLE_MESSAGE
      durationMs = item.track.durationMs
      emit()
      return
    }
    const backend = backendFor(item.track)
    if (active && active !== backend) active.stop()
    active = backend ?? null
    status = 'loading'
    error = undefined
    durationMs = item.track.durationMs
    emit()
    if (!backend) {
      failTrack(token, `Can't play ${item.track.provider} tracks yet.`)
      return
    }
    backend.setVolume(volume, muted)
    try {
      await backend.load(item.track, startMs, {
        autoplay: wantPlay,
        upcoming: repeat === 'one' ? [] : q.upcoming.map((u) => u.track)
      })
      if (token !== loadToken || disposed) return
      const d = backend.getDurationMs()
      if (d > 0) durationMs = d
      if (wantPlay) {
        await backend.play()
        if (token !== loadToken || disposed) return
        consecutiveErrors = 0
        if (wantPlay) {
          status = 'playing'
        } else {
          // pause() arrived while play() was pending
          backend.pause()
          status = 'paused'
        }
      } else {
        status = 'paused'
      }
      emit()
    } catch (err) {
      if (token !== loadToken || disposed) return
      if (isLoadAborted(err)) {
        // play() interrupted by pause(): not an error.
        if (status === 'loading') status = 'paused'
        emit()
        return
      }
      failTrack(token, err instanceof Error ? err.message : String(err))
    }
  }

  /** Reached the end with nothing to advance to: stay on the current item, paused at 0. */
  const stopAtEnd = (): void => {
    clearSkipTimer()
    wantPlay = false
    if (active && status !== 'error') {
      active.pause()
      active.seek(0)
      status = 'paused'
    }
    emit(0)
  }

  const resume = async (): Promise<void> => {
    const backend = active
    const token = loadToken
    if (!backend) return
    try {
      await backend.play()
      if (token !== loadToken || disposed || !wantPlay) return
      status = 'playing'
      error = undefined
      consecutiveErrors = 0
      emit()
    } catch (err) {
      if (token !== loadToken || disposed || isLoadAborted(err)) return
      failedToken = -1
      failTrack(token, err instanceof Error ? err.message : String(err))
    }
  }

  const onEnded = (): void => {
    if (repeat === 'one' && active) {
      active.seek(0)
      wantPlay = true
      void resume()
      return
    }
    const advanced = nextPlayable()
    if (!advanced) {
      // The last song finished by itself: say so, so a Jam can move on.
      endedCount++
      stopAtEnd()
      return
    }
    q = advanced
    wantPlay = true
    void load()
  }

  const onBackendEvent = (backend: PlaybackBackend, e: BackendEvent): void => {
    if (backend !== active || disposed) return
    switch (e.type) {
      case 'playing':
        if (status === 'loading' && !wantPlay) return
        status = 'playing'
        error = undefined
        consecutiveErrors = 0
        emit()
        return
      case 'paused':
        if (status !== 'playing') return
        status = 'paused'
        wantPlay = false
        emit()
        return
      case 'waiting':
        if (status !== 'playing') return
        status = 'loading'
        emit()
        return
      case 'ended':
        onEnded()
        return
      case 'error':
        failTrack(loadToken, e.message)
        return
      case 'duration':
        if (e.durationMs > 0) durationMs = e.durationMs
        emit()
        return
    }
  }

  const unsubs = backends.map((b) => b.on((e) => onBackendEvent(b, e)))

  const controller: PlaybackController = {
    async playTracks(tracks, startIndex) {
      q = Q.playTracks(q, tracks, startIndex, queueDeps)
      // An unplayable start track: start the next playable one after it instead.
      // If there is none, load() reports it on the start track.
      q = skipUnplayable(q, (s) => Q.next(s, 'off', queueDeps)) ?? q
      wantPlay = q.current !== null
      consecutiveErrors = 0
      await load()
    },

    async play() {
      wantPlay = true
      if (!q.current) {
        const advanced = nextPlayable('off')
        if (!advanced) {
          wantPlay = false
          return
        }
        q = advanced
        await load()
        return
      }
      if (status === 'loading') return // plays once loaded
      if (status === 'error' || status === 'idle' || !active) {
        failedToken = -1
        await load()
        return
      }
      await resume()
    },

    pause() {
      wantPlay = false
      clearSkipTimer()
      if (status === 'loading') {
        active?.pause() // load() settles on 'paused'
        return
      }
      if (status !== 'playing') return
      active?.pause()
      status = 'paused'
      emit()
    },

    async toggle() {
      if (status === 'playing' || (status === 'loading' && wantPlay)) controller.pause()
      else await controller.play()
    },

    seek(ms) {
      if (!active || !q.current || !Number.isFinite(ms)) return
      const max = durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY
      const to = Math.min(max, Math.max(0, ms))
      active.seek(to)
      emit(to)
    },

    async next() {
      const advanced = nextPlayable()
      if (!advanced) {
        stopAtEnd()
        return
      }
      q = advanced
      wantPlay = true
      await load()
    },

    async previous() {
      if (q.current && active && status !== 'error' && livePosition() > RESTART_THRESHOLD_MS) {
        controller.seek(0)
        return
      }
      const back = previousPlayable()
      if (!back) {
        if (status === 'error') return controller.play()
        controller.seek(0)
        return
      }
      q = back
      wantPlay = true
      await load()
    },

    setVolume(v) {
      if (!Number.isFinite(v)) return
      volume = clamp01(v)
      for (const b of backends) b.setVolume(volume, muted)
      persistVolume()
      emit()
    },

    setMuted(m) {
      muted = m
      for (const b of backends) b.setVolume(volume, muted)
      persistVolume()
      emit()
    },

    setShuffle(on) {
      q = Q.setShuffle(q, on, queueDeps)
      emit()
    },

    async restore(snap) {
      if (q.current || !snap.current) return
      volume = Math.min(1, Math.max(0, snap.volume))
      muted = snap.muted
      repeat = snap.repeat
      persistVolume()
      const items = [snap.current, ...snap.queue]
      q = {
        current: snap.current,
        upcoming: snap.queue,
        history: [],
        shuffle: snap.shuffle,
        // Saved in play order already; turning shuffle off keeps that order.
        order: snap.shuffle ? items.map((i) => i.uid) : [],
        pinned: []
      }
      wantPlay = false
      consecutiveErrors = 0
      await load(Math.max(0, snap.positionMs))
    },

    cycleRepeat() {
      repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'
      emit()
    },

    playNext(tracks) {
      q = Q.playNext(q, tracks, queueDeps)
      emit()
    },

    addToQueue(tracks) {
      q = Q.addToQueue(q, tracks, queueDeps)
      emit()
    },

    moveInQueue(from, to) {
      q = Q.move(q, from, to)
      emit()
    },

    removeFromQueue(uid) {
      q = Q.remove(q, uid)
      emit()
    },

    clearQueue() {
      q = Q.clear(q)
      emit()
    },

    updateTrack(trackId, patch) {
      q = Q.updateTrack(q, trackId, patch)
      emit()
    },

    getPositionMs() {
      return livePosition()
    },

    getState() {
      return state
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    dispose() {
      clearSkipTimer()
      loadToken++
      for (const u of unsubs) u()
      active?.stop()
      active = null
      listeners.clear()
      disposed = true
    }
  }

  return controller
}

/** The app-wide controller, on the audio-element and Spotify SDK backends. Bind the OS media session with bindMediaSession(playback). */
const spotifyBackend = createSpotifyBackend()

export const playback: PlaybackController = createPlaybackController([
  createAudioBackend(),
  spotifyBackend
])

/** Connect the Spotify player ahead of the first play (call once logged in). */
export function warmUpSpotify(): void {
  spotifyBackend.warmUp()
}
