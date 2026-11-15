// Spotify Web Playback SDK backend. The SDK registers this app as a Spotify
// Connect device; main starts tracks on it through the Web API (spotify:play).
// The SDK script loads lazily on the first Spotify load(), so local-only use
// never touches it. Facts and caveats: docs/research/spotify-playback-widevine.md
//
// Load sequence:
//   1. connect the SDK player once and wait for `ready` (device id), with timeouts;
//   2. ask main to play this track plus the queue's following Spotify tracks (the
//      "context"), so Spotify moves to the next one by itself with no gap;
//   3. wait for a player_state_changed playing this track. With `autoplay` (the
//      controller is about to call play()) it just keeps playing. Without it, mute,
//      pause, wait for the paused state, unmute (load() leaves the track paused).
// Gapless hand-off: when Spotify advances to the next context track on its own we
// report 'ended' but let it play; the controller's next load() of that track adopts it.

import type { Api } from '@shared/ipc'
import { spotifyUri } from '@shared/spotify'
import type { Track } from '@shared/types'
import { LoadAbortedError, type BackendEvent, type PlaybackBackend } from './backend'
import {
  loadSpotifySdk,
  type SdkLoader,
  type SpotifyPlaybackState,
  type SpotifyPlayer,
  type SpotifyTrack
} from './spotifySdk'

export const PLAYER_NAME = 'Unison'

export const MESSAGES = {
  connectTimeout:
    "Couldn't connect to Spotify (timed out). Check your connection and Spotify login, then try again.",
  connectFailed: "Couldn't connect to Spotify. Try logging in to Spotify again in Settings.",
  readyTimeout:
    'The Spotify player connected but never became ready. Spotify may be limiting this app; try again later.',
  startTimeout: "Spotify didn't start the track in time. Try again.",
  offline: 'The Spotify player went offline. Check your connection and try again.',
  premium: 'Spotify Premium is required to play Spotify tracks.',
  playback: 'Spotify refused playback. If tracks stop after a few seconds, run npm run vmp:sign.',
  authentication: 'Spotify sign-in failed. Log in to Spotify again in Settings.',
  initialization:
    "The Spotify player couldn't start. Widevine (DRM) may be missing or still installing; restart the app and try again.",
  unavailable: 'Spotify playback is not available here.'
} as const

export interface SpotifyBackendDeps {
  /** Loads the SDK and returns the `Spotify` namespace. Default injects the script tag. */
  loadSdk?: SdkLoader
  /** IPC invoke. Default window.api.invoke. */
  invoke?: Api['invoke']
  /** Clock for position interpolation. Default Date.now. */
  now?: () => number
  /** Timeout for player.connect(). Default 15s. */
  connectTimeoutMs?: number
  /** Timeout for the `ready` event after connect(). Default 15s. */
  readyTimeoutMs?: number
  /** Timeout for the requested track to start after spotify:play. Default 15s. */
  startTimeoutMs?: number
  /** How long to wait for the pause that ends a load to be confirmed. Default 3s, not fatal. */
  pauseConfirmMs?: number
  /** getCurrentState() resync interval while playing. Default 5s. */
  resyncMs?: number
}

/** A track that was playing and comes back paused at 0 within this of the end has ended. */
const END_TOLERANCE_MS = 2500
/** A "paused" state this soon after we started/resumed is re-checked, not trusted (often stale). */
const STALE_PAUSE_WINDOW_MS = 2500
/** Delay before asking getCurrentState() to confirm a suspicious state. */
const VERIFY_DELAY_MS = 600
/** Most tracks sent in one spotify:play (current + following). */
const MAX_CONTEXT = 50

const defaultInvoke: Api['invoke'] = (channel, ...args) => {
  if (typeof window === 'undefined' || !window.api) {
    return Promise.reject(new Error(MESSAGES.unavailable))
  }
  return window.api.invoke(channel, ...args)
}

/** Electron prefixes IPC rejections with "Error invoking remote method 'x': Error: ". */
function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
}

function withTimeout<T>(p: Promise<T>, ms: number, message: () => string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message())), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/** Call an SDK method that should return a promise, swallowing sync throws and rejections. */
function quietly(fn: () => Promise<unknown> | unknown): void {
  try {
    void Promise.resolve(fn()).catch(() => {})
  } catch {
    // ignore
  }
}

interface Snapshot {
  position: number
  paused: boolean
  /** now() when received. */
  at: number
}

interface StateWaiter {
  since: number
  pred: (s: SpotifyPlaybackState) => boolean
  resolve: (s: SpotifyPlaybackState) => void
}

interface PendingLoad {
  reject: (err: Error) => void
}

export interface SpotifyPlaybackBackend extends PlaybackBackend {
  /** Load the SDK and register the device now, so the first play doesn't wait for it. */
  warmUp(): void
}

export function createSpotifyBackend(deps: SpotifyBackendDeps = {}): SpotifyPlaybackBackend {
  const loadSdk = deps.loadSdk ?? loadSpotifySdk
  const invoke = deps.invoke ?? defaultInvoke
  const now = deps.now ?? (() => Date.now())
  const connectTimeoutMs = deps.connectTimeoutMs ?? 15_000
  const readyTimeoutMs = deps.readyTimeoutMs ?? 15_000
  const startTimeoutMs = deps.startTimeoutMs ?? 15_000
  const pauseConfirmMs = deps.pauseConfirmMs ?? 3_000
  const resyncMs = deps.resyncMs ?? 5_000

  const handlers = new Set<(e: BackendEvent) => void>()
  const emit = (e: BackendEvent): void => {
    for (const h of [...handlers]) h(e)
  }

  // SDK connection (survives loads and stop()).
  let player: SpotifyPlayer | null = null
  let deviceId: string | null = null
  let connecting: Promise<string> | null = null
  /** Set while connectDevice() waits for `ready`; SDK errors in that window reject it. */
  let readyWaiter: { resolve: (id: string) => void; reject: (err: Error) => void } | null = null
  let tokenError: string | null = null
  let activated = false

  // Volume.
  let volume = 1
  let muted = false
  /** True while a load has the SDK muted to hide the start-then-pause blip. */
  let loadMuted = false

  // Current track.
  let seq = 0
  let pending: PendingLoad | null = null
  let stopped = true
  /** True once a load succeeded (until stop() or the next load): events flow only then. */
  let loaded = false
  let current: Track | null = null
  /** ids and URIs that count as the current track (requested + relinked). */
  let ids = new Set<string>()
  let snap: Snapshot | null = null
  let lastState: SpotifyPlaybackState | null = null
  let stateCount = 0
  let waiters: StateWaiter[] = []
  let reportedPaused = true
  let reportedLoading = false
  let reportedDuration = 0
  /** Last duration a state gave for the current track (a later state may omit it). */
  let stateDuration = 0
  let endedFired = false
  /** The SDK no longer holds this track (it ended, or the device went inactive): play() restarts it. */
  let needsRestart = false
  let restartFrom = 0
  let resyncTimer: ReturnType<typeof setInterval> | null = null
  /** The controller wants the current track playing. Drives resync and stale-state checks. */
  let intendPlaying = false
  /** now() of the last start/resume we asked for. */
  let resumedAt = -Infinity
  let verifyTimer: ReturnType<typeof setTimeout> | null = null
  /** now() when lastState arrived. */
  let lastStateAt = 0
  /** Native ids sent in the last spotify:play, current first. */
  let context: string[] = []
  /** Spotify moved on its own to this context track; the next load() of it adopts it. */
  let advancedTo: string | null = null

  const effectiveVolume = (): number => (loadMuted || muted ? 0 : volume)
  const applyVolume = (): void => {
    const p = player
    if (p) quietly(() => p.setVolume(effectiveVolume()))
  }

  const isCurrent = (t: SpotifyTrack | null | undefined): boolean => {
    if (!t) return false
    const keys = [t.id, t.uri, t.linked_from?.id, t.linked_from?.uri]
    return keys.some((k) => typeof k === 'string' && ids.has(k))
  }
  const rememberIds = (t: SpotifyTrack | null | undefined): void => {
    if (!t) return
    for (const k of [t.id, t.uri]) if (typeof k === 'string' && k) ids.add(k)
  }

  const durationOfState = (s: SpotifyPlaybackState | null): number => {
    if (!s || !isCurrent(s.track_window?.current_track)) return 0
    if (typeof s.duration === 'number' && s.duration > 0) return s.duration
    const d = s.track_window.current_track?.duration_ms
    return typeof d === 'number' && d > 0 ? d : 0
  }
  const durationMs = (): number => {
    if (stopped || !current) return 0
    return (
      durationOfState(lastState) ||
      stateDuration ||
      (current.durationMs > 0 ? current.durationMs : 0)
    )
  }

  const positionMs = (): number => {
    if (stopped || !snap) return 0
    const pos = snap.paused ? snap.position : snap.position + Math.max(0, now() - snap.at)
    const max = durationMs()
    return Math.max(0, max > 0 ? Math.min(pos, max) : pos)
  }

  const clearResync = (): void => {
    if (resyncTimer !== null) clearInterval(resyncTimer)
    resyncTimer = null
  }
  const startResync = (): void => {
    clearResync()
    resyncTimer = setInterval(() => {
      const p = player
      if (!p || !loaded || stopped || pending || !intendPlaying || needsRestart) return
      p.getCurrentState().then(
        (s) => onState(p, s),
        () => {}
      )
    }, resyncMs)
  }

  const clearVerify = (): void => {
    if (verifyTimer !== null) clearTimeout(verifyTimer)
    verifyTimer = null
  }
  /** Ask Spotify for the real state shortly; the answer is trusted as-is. */
  const verifySoon = (): void => {
    if (verifyTimer !== null) return
    verifyTimer = setTimeout(() => {
      verifyTimer = null
      const p = player
      if (!p || stopped || pending) return
      p.getCurrentState().then(
        (st) => onState(p, st, true),
        () => {}
      )
    }, VERIFY_DELAY_MS)
  }

  /** Which context track (native id) this SDK track is, if any. */
  const contextMatch = (t: SpotifyTrack | null | undefined): string | null => {
    if (!t) return null
    for (const k of [t.id, t.uri, t.linked_from?.id, t.linked_from?.uri]) {
      if (typeof k !== 'string') continue
      const id = k.startsWith('spotify:track:') ? k.slice('spotify:track:'.length) : k
      if (context.includes(id)) return id
    }
    return null
  }

  const waitForState = (
    pred: (s: SpotifyPlaybackState) => boolean,
    since: number,
    ms: number,
    message: string
  ): Promise<SpotifyPlaybackState> =>
    new Promise<SpotifyPlaybackState>((resolve, reject) => {
      const waiter: StateWaiter = {
        since,
        pred,
        resolve: (s) => {
          clearTimeout(timer)
          resolve(s)
        }
      }
      const timer = setTimeout(() => {
        waiters = waiters.filter((w) => w !== waiter)
        reject(new Error(message))
      }, ms)
      waiters.push(waiter)
    })

  const hasEnded = (s: SpotifyPlaybackState, prev: Snapshot | null, prevPos: number): boolean => {
    const tw = s.track_window
    const cur = tw?.current_track ?? null
    // Spotify moved on to something else (autoplay/radio after our single URI).
    if (cur && !isCurrent(cur)) return true
    if (!s.paused || s.position > 0) return false
    // Finished: paused at 0 with our track in previous_tracks (observed shape).
    if ((tw?.previous_tracks ?? []).some(isCurrent)) return true
    // Fallback: it was playing near the end and is now paused at 0 (or emptied).
    const dur = durationMs()
    return prev !== null && !prev.paused && dur > 0 && prevPos >= dur - END_TOLERANCE_MS
  }

  const onState = (p: SpotifyPlayer, s: SpotifyPlaybackState | null, verified = false): void => {
    if (p !== player) return
    // Another backend took over (stop()), but a start already sent to Spotify can still
    // land afterwards and play over it. Silence anything that starts while stopped.
    if (stopped && s && !s.paused) {
      quietly(() => p.pause())
      return
    }
    if (
      s &&
      !verified &&
      s.paused &&
      intendPlaying &&
      loaded &&
      !pending &&
      now() - resumedAt < STALE_PAUSE_WINDOW_MS &&
      isCurrent(s.track_window?.current_track)
    ) {
      // Usually a late "paused" from before our resume: confirm instead of freezing the clock.
      verifySoon()
      return
    }
    stateCount++
    const prev = snap
    const prevPos = positionMs()
    if (!s) {
      // Not the active device any more (playback moved elsewhere).
      if (!loaded || stopped || pending || needsRestart) return
      needsRestart = true
      restartFrom = prevPos
      intendPlaying = false
      snap = { position: prevPos, paused: true, at: now() }
      clearResync()
      if (!reportedPaused) {
        reportedPaused = true
        emit({ type: 'paused' })
      }
      return
    }
    lastState = s
    lastStateAt = now()
    const sd = durationOfState(s)
    if (sd > 0 && !stopped && current) stateDuration = sd
    if (!stopped && current && isCurrent(s.track_window?.current_track)) {
      snap = { position: Math.max(0, s.position || 0), paused: s.paused, at: now() }
    }
    for (const w of [...waiters]) {
      if (stateCount > w.since && w.pred(s)) {
        waiters = waiters.filter((x) => x !== w)
        w.resolve(s)
      }
    }
    if (!loaded || stopped || pending || endedFired || needsRestart) return

    if (hasEnded(s, prev, prevPos)) {
      endedFired = true
      needsRestart = true
      restartFrom = 0
      reportedPaused = true
      reportedLoading = false
      snap = { position: 0, paused: true, at: now() }
      clearResync()
      const cur = s.track_window?.current_track
      const into = cur && !isCurrent(cur) ? contextMatch(cur) : null
      if (into && current && context.indexOf(into) > context.indexOf(current.nativeId)) {
        // Gapless: Spotify moved to the queue's next track. Keep it playing for load() to adopt.
        advancedTo = into
      } else {
        // Something we didn't ask for (autoplay/radio, or a stale queue): stop it.
        intendPlaying = false
        if (!s.paused) quietly(() => p.pause())
      }
      emit({ type: 'ended' })
      return
    }

    const d = durationOfState(s)
    if (d > 0 && d !== reportedDuration) {
      reportedDuration = d
      emit({ type: 'duration', durationMs: d })
    }
    const loading = s.loading === true && !s.paused
    if (s.paused !== reportedPaused) {
      reportedPaused = s.paused
      reportedLoading = loading
      if (s.paused) {
        intendPlaying = false
        clearResync()
        emit({ type: 'paused' })
      } else {
        intendPlaying = true
        startResync()
        emit(loading ? { type: 'waiting' } : { type: 'playing' })
      }
      return
    }
    if (loading !== reportedLoading) {
      reportedLoading = loading
      if (!s.paused) emit(loading ? { type: 'waiting' } : { type: 'playing' })
    }
  }

  /** Route an SDK error: a connect in progress, else a pending load, else (once loaded) an event. */
  const onSdkError = (p: SpotifyPlayer, message: string): void => {
    if (p !== player) return
    if (readyWaiter) {
      readyWaiter.reject(new Error(message))
      return
    }
    if (pending) {
      const pl = pending
      pending = null
      loadMuted = false
      quietly(() => p.pause())
      applyVolume()
      pl.reject(new Error(message))
      return
    }
    if (loaded && !stopped) emit({ type: 'error', message })
  }

  const createPlayer = async (): Promise<SpotifyPlayer> => {
    const sdk = await loadSdk()
    const p = new sdk.Player({
      name: PLAYER_NAME,
      getOAuthToken: (cb) => {
        invoke('spotify:getAccessToken').then(
          (token) => {
            tokenError = null
            cb(token)
          },
          (err: unknown) => {
            tokenError = errorMessage(err)
          }
        )
      },
      volume: effectiveVolume(),
      // The app owns the OS media session (mediaSession.ts).
      enableMediaSession: false
    })
    p.addListener('ready', ({ device_id }) => {
      if (p !== player) return
      deviceId = device_id
      readyWaiter?.resolve(device_id)
    })
    p.addListener('not_ready', () => {
      if (p !== player) return
      deviceId = null
    })
    p.addListener('player_state_changed', (s) => onState(p, s))
    p.addListener('initialization_error', (e) =>
      onSdkError(p, `${MESSAGES.initialization}${e?.message ? ` (${e.message})` : ''}`)
    )
    p.addListener('authentication_error', () => onSdkError(p, MESSAGES.authentication))
    p.addListener('account_error', () => onSdkError(p, MESSAGES.premium))
    p.addListener('playback_error', () => onSdkError(p, MESSAGES.playback))
    p.addListener('autoplay_failed', () => {
      // Not a broken track: report it as paused so the user can press play
      // (play() calls activateElement()).
      if (p !== player || !loaded || stopped || pending || reportedPaused) return
      reportedPaused = true
      snap = { position: positionMs(), paused: true, at: now() }
      clearResync()
      emit({ type: 'paused' })
    })
    return p
  }

  const connectDevice = async (): Promise<string> => {
    const p = player ?? (player = await createPlayer())
    const ready = new Promise<string>((resolve, reject) => {
      readyWaiter = { resolve, reject }
    })
    ready.catch(() => {}) // handled below; avoid an unhandled rejection if connect fails first
    try {
      const tokenProblem = (fallback: string) => (): string =>
        tokenError ? `Couldn't get a Spotify token: ${tokenError}` : fallback
      const ok = await Promise.race([
        withTimeout(p.connect(), connectTimeoutMs, tokenProblem(MESSAGES.connectTimeout)),
        // An SDK error (auth, account, init) during connect wins over a hanging connect().
        ready.then(() => true)
      ])
      if (!ok) throw new Error(tokenProblem(MESSAGES.connectFailed)())
      if (deviceId) return deviceId
      return await withTimeout(ready, readyTimeoutMs, () => MESSAGES.readyTimeout)
    } catch (err) {
      // Start over with a fresh player next time.
      if (player === p) {
        player = null
        deviceId = null
        quietly(() => p.disconnect())
      }
      throw err
    } finally {
      readyWaiter = null
    }
  }

  const ensureDevice = (): Promise<string> => {
    if (player && deviceId) return Promise.resolve(deviceId)
    if (!connecting) {
      connecting = connectDevice().finally(() => {
        connecting = null
      })
    }
    return connecting
  }

  const cancelPending = (): void => {
    const p = pending
    pending = null
    p?.reject(new LoadAbortedError())
  }

  const startOnDevice = async (id: string, nativeIds: string[], fromMs: number): Promise<void> => {
    context = nativeIds
    try {
      await invoke('spotify:play', id, nativeIds, Math.max(0, Math.floor(fromMs)))
    } catch (err) {
      throw new Error(errorMessage(err), { cause: err })
    }
  }

  return {
    warmUp() {
      ensureDevice().catch(() => {
        // Reported on the first real load instead.
      })
    },

    canPlay(track) {
      return track.provider === 'spotify'
    },

    load(track, startMs = 0, opts = {}) {
      cancelPending()
      if (track.provider !== 'spotify') {
        return Promise.reject(new Error(`Can't play ${track.provider} tracks here.`))
      }
      const autoplay = opts.autoplay === true
      const adopt = advancedTo
      advancedTo = null
      clearVerify()
      if (
        adopt === track.nativeId &&
        player &&
        deviceId &&
        !(startMs > 0) &&
        lastState &&
        contextMatch(lastState.track_window?.current_track) === track.nativeId
      ) {
        // Spotify is already playing this track from our context: take it over, no new request.
        const st = lastState
        const p = player
        seq++
        stopped = false
        loaded = true
        current = track
        ids = new Set([track.nativeId, spotifyUri(track.nativeId)])
        rememberIds(st.track_window.current_track)
        endedFired = false
        needsRestart = false
        reportedLoading = false
        stateDuration = 0
        reportedDuration = durationMs()
        const elapsed = st.paused ? 0 : Math.max(0, now() - lastStateAt)
        snap = { position: Math.max(0, (st.position || 0) + elapsed), paused: st.paused, at: now() }
        reportedPaused = st.paused
        intendPlaying = !st.paused
        resumedAt = now()
        clearResync()
        if (!st.paused) {
          if (autoplay) startResync()
          else {
            snap = { position: positionMs(), paused: true, at: now() }
            reportedPaused = true
            intendPlaying = false
            quietly(() => p.pause())
          }
        }
        return Promise.resolve()
      }
      const mySeq = ++seq
      stopped = false
      loaded = false
      current = track
      ids = new Set([track.nativeId, spotifyUri(track.nativeId)])
      endedFired = false
      needsRestart = false
      reportedPaused = true
      reportedLoading = false
      reportedDuration = 0
      stateDuration = 0
      const from = Number.isFinite(startMs) ? Math.max(0, startMs) : 0
      snap = { position: from, paused: true, at: now() }
      intendPlaying = false
      clearResync()
      // This track plus the queue's following run of Spotify tracks.
      const following: string[] = []
      for (const t of opts.upcoming ?? []) {
        if (t.provider !== 'spotify' || t.nativeId === track.nativeId) break
        if (following.length >= MAX_CONTEXT - 1) break
        following.push(t.nativeId)
      }

      return new Promise<void>((resolve, reject) => {
        const me: PendingLoad = { reject }
        pending = me
        const alive = (): void => {
          if (pending !== me || mySeq !== seq) throw new LoadAbortedError()
        }
        const run = async (): Promise<void> => {
          const id = await ensureDevice()
          alive()
          const p = player
          if (!p) throw new Error(MESSAGES.offline)
          if (!autoplay) {
            loadMuted = true
            applyVolume()
          }
          // Listen before asking: the start state can beat the IPC reply.
          const starting = waitForState(
            (s) => !s.paused && isCurrent(s.track_window?.current_track),
            stateCount,
            startTimeoutMs,
            MESSAGES.startTimeout
          )
          starting.catch(() => {}) // unobserved if spotify:play fails
          await startOnDevice(id, [track.nativeId, ...following], from)
          alive()
          const started = await starting
          alive()
          rememberIds(started.track_window.current_track)
          if (autoplay) return
          const beforePause = stateCount
          const confirmed = waitForState(
            (s) => s.paused && isCurrent(s.track_window?.current_track),
            beforePause,
            pauseConfirmMs,
            'pause not confirmed'
          ).catch(() => null)
          quietly(() => p.pause())
          await confirmed
          alive()
        }
        run().then(
          () => {
            if (pending !== me) return
            pending = null
            loadMuted = false
            applyVolume()
            loaded = true
            reportedDuration = durationMs()
            if (autoplay) {
              // Already playing; the controller's play() will be a no-op.
              snap = { position: snap?.position ?? from, paused: false, at: snap?.at ?? now() }
              reportedPaused = false
              intendPlaying = true
              resumedAt = now()
              startResync()
            } else {
              // Whatever the last state said, the track is paused now.
              snap = { position: snap?.position ?? from, paused: true, at: now() }
              reportedPaused = true
            }
            resolve()
          },
          (err: unknown) => {
            if (pending !== me) return
            pending = null
            loadMuted = false
            // The track may still start late; keep it quiet and paused.
            const p = player
            if (p) quietly(() => p.pause())
            applyVolume()
            reject(err instanceof Error ? err : new Error(errorMessage(err)))
          }
        )
      })
    },

    async play() {
      if (!loaded || stopped || pending || !current) return
      const p = player
      if (!activated && p) {
        activated = true
        try {
          await p.activateElement()
        } catch {
          // safeguard only
        }
      }
      if (needsRestart) {
        const track = current
        const mySeq = seq
        const id = await ensureDevice()
        if (mySeq !== seq || stopped) return
        needsRestart = false
        endedFired = false
        reportedPaused = true
        intendPlaying = true
        resumedAt = now()
        snap = { position: restartFrom, paused: true, at: now() }
        await startOnDevice(id, [track.nativeId], restartFrom)
        return
      }
      if (!p) throw new Error(MESSAGES.offline)
      if (intendPlaying && snap && !snap.paused) return // already playing (autoplay/adopted)
      // Count from now; a late "paused" state gets re-checked (STALE_PAUSE_WINDOW_MS).
      snap = { position: positionMs(), paused: false, at: now() }
      intendPlaying = true
      resumedAt = now()
      startResync()
      await p.resume()
      verifySoon()
    },

    pause() {
      if (!loaded || stopped || pending || needsRestart) return
      const p = player
      if (!p) return
      snap = { position: positionMs(), paused: true, at: now() }
      intendPlaying = false
      clearVerify()
      quietly(() => p.pause())
    },

    seek(ms) {
      if (!loaded || stopped || pending || !Number.isFinite(ms)) return
      const max = durationMs()
      const to = Math.max(0, max > 0 ? Math.min(ms, max) : ms)
      snap = { position: to, paused: snap?.paused ?? true, at: now() }
      if (needsRestart) {
        restartFrom = to
        return
      }
      const p = player
      if (p) quietly(() => p.seek(Math.floor(to)))
    },

    setVolume(v, m) {
      volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1))
      muted = m
      applyVolume()
    },

    getPositionMs() {
      return positionMs()
    },

    getDurationMs() {
      return durationMs()
    },

    stop() {
      cancelPending()
      seq++
      clearResync()
      clearVerify()
      intendPlaying = false
      advancedTo = null
      context = []
      const wasActive = !stopped
      stopped = true
      loaded = false
      current = null
      snap = null
      ids = new Set()
      loadMuted = false
      const p = player
      if (p && wasActive) {
        quietly(() => p.pause())
        applyVolume()
      }
    },

    on(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    }
  }
}
