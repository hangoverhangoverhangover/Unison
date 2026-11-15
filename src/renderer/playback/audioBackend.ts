// HTMLAudioElement backend. Plays local files through the media:// protocol
// (served by main with Range support) and SoundCloud streams: clear HLS through
// hls.js (Media Source Extensions on the same element), progressive URLs directly.
//
// SoundCloud stream URLs are signed and expire (about 2 h for HLS, see
// docs/research/soundcloud-api.md section 8). When hls.js reports a fatal 401/403/
// 404/410, or the known expiry has passed before play()/seek(), the backend fetches
// a fresh URL once and resumes at the same position, keeping paused/playing state.
//
// Audio processing (QoL round 2, see audioGraph.ts): on first play a Web Audio graph
// is created and the playing element is routed through it for EQ, volume levelling and
// crossfades. Each element is a "deck"; crossfading uses a second wired deck. Elements
// that must stay out of the graph play on a separate plain (never wired) deck:
// - DRM (EME/Widevine) SoundCloud streams: protected media in a MediaElementSource is
//   silent, and a wired element can't be unwired. EQ/levelling/crossfade don't apply.
// - Progressive/local sources that fail to load with crossOrigin="anonymous" (a CDN
//   without CORS headers): retried once on the plain deck, again without the graph.
// If the AudioContext can't be created, everything plays on one plain element as before.

import type { Api } from '@shared/ipc'
import { localAudioUrl } from '@shared/library'
import { DEFAULT_AUDIO, type AudioSettings } from '@shared/playback'
import type { StreamInfo } from '@shared/provider'
import { isPlayable, type Track } from '@shared/types'
import { LoadAbortedError, type BackendEvent, type PlaybackBackend } from './backend'
import {
  createAudioGraph,
  sanitizeAudioSettings,
  type AudioContextLike,
  type AudioGraph,
  type DeckChannel
} from './audioGraph'
import { onAudioSettings } from './audioSettingsBus'
import {
  HLS_ERROR_TYPES,
  HLS_EVENTS,
  hlsErrorMessage,
  isExpiredUrlError,
  loadHlsJs,
  type HlsConstructor,
  type HlsErrorData,
  type HlsInstance,
  type HlsLoader
} from './hlsSource'

// MediaError codes (the MediaError global isn't available outside the DOM).
const MEDIA_ERR_ABORTED = 1
const MEDIA_ERR_NETWORK = 2
const MEDIA_ERR_DECODE = 3
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

export function mediaErrorMessage(error: MediaError | null): string {
  switch (error?.code) {
    case MEDIA_ERR_ABORTED:
      return 'Playback was aborted.'
    case MEDIA_ERR_NETWORK:
      return "Couldn't read the file. It may have been moved or deleted."
    case MEDIA_ERR_DECODE:
      return 'The file is damaged or uses an unsupported encoding.'
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This file can't be played. It may be missing or in an unsupported format."
    default:
      return error?.message ? `Playback failed: ${error.message}` : 'Playback failed.'
  }
}

function streamErrorMessage(error: MediaError | null): string {
  switch (error?.code) {
    case MEDIA_ERR_NETWORK:
      return "Couldn't load the SoundCloud stream. Check your connection and try again."
    case MEDIA_ERR_DECODE:
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "The SoundCloud stream couldn't be played."
    default:
      return mediaErrorMessage(error)
  }
}

export const MESSAGES = {
  unavailable: 'SoundCloud playback is not available here.',
  hlsUnsupported: "This system can't play SoundCloud streams (Media Source Extensions missing).",
  preview: 'SoundCloud only serves a short preview of this track.',
  refreshFailed: "The SoundCloud stream expired and couldn't be refreshed",
  expiredAgain: 'The SoundCloud stream keeps expiring. Try playing the track again.'
} as const

/** A URL is treated as expired this long before its stated expiry. */
const EXPIRY_MARGIN_MS = 15_000
/** A second expired-URL error this soon after a refresh is reported, not retried. */
const REFRESH_COOLDOWN_MS = 30_000
/** The next track is prepared this long before its crossfade is due. */
export const CROSSFADE_PREPARE_LEAD_MS = 5000
/** Shorter than this (the next track got ready too late), no fade: plain hand-off. */
export const CROSSFADE_MIN_MS = 1000

const defaultInvoke: Api['invoke'] = (channel, ...args) => {
  if (typeof window === 'undefined' || !window.api) {
    return Promise.reject(new Error(MESSAGES.unavailable))
  }
  return window.api.invoke(channel, ...args)
}

const defaultLoadSettings = (): Promise<AudioSettings | null> =>
  typeof window === 'undefined' || !window.api
    ? Promise.resolve(null)
    : window.api.invoke('audio:get')

const defaultCreateContext = (): (() => AudioContextLike) | null =>
  typeof AudioContext === 'function' ? () => new AudioContext() : null

/** Electron prefixes IPC rejections with "Error invoking remote method 'x': Error: ". */
function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
}

export interface AudioBackendDeps {
  /** Default `new Audio()`, created on first load (and for a second/plain deck when needed). */
  makeElement?: () => HTMLAudioElement
  /** IPC invoke. Default window.api.invoke. */
  invoke?: Api['invoke']
  /** Loads the hls.js constructor. Default dynamic import('hls.js'). */
  loadHls?: HlsLoader
  /** Clock for URL expiry. Default Date.now. */
  now?: () => number
  /**
   * Creates the AudioContext, on first play. null disables the graph (plays like a plain
   * element). Default `new AudioContext()` where it exists.
   */
  createContext?: (() => AudioContextLike) | null
  /** Live settings source. Default the Settings bus (onAudioSettings). */
  onSettings?: (listener: (s: AudioSettings) => void) => () => void
  /** Saved settings, read once at creation. Default invoke('audio:get'); null skips. */
  loadSettings?: (() => Promise<AudioSettings | null>) | null
}

/** What the element should be pointed at. */
type Target =
  | { kind: 'file'; url: string }
  | { kind: 'hls'; url: string; Hls: HlsConstructor; drm?: StreamInfo['drm'] }

interface PendingLoad {
  cancel: () => void
}

interface Refresh {
  positionMs: number
  play: boolean
  cancel: () => void
  done: Promise<void>
}

/** One audio element and the source loaded on it. */
interface Deck {
  el: HTMLAudioElement
  /** Set once the element is routed through the graph (permanent). */
  channel: DeckChannel | null
  hls: HlsInstance | null
  /** recoverMediaError() is tried once per source. */
  mediaRecovered: boolean
  track: Track | null
  /** The current SoundCloud stream, once loaded. */
  stream: StreamInfo | null
  refreshing: Refresh | null
  lastRefreshAt: number
  /** The loaded source may go through the graph (not DRM, loaded with CORS). */
  graphOk: boolean
}

interface Crossfade {
  phase: 'preparing' | 'ready' | 'fading'
  from: Deck
  to: Deck
  track: Track
  /** 'ended' for the outgoing track was reported (the fade is running). */
  endedSent: boolean
  /** The controller's load() of `track` took `to` over. */
  adopted: boolean
  cancelOpen: () => void
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Elements are created lazily on first load, so the controller module (and its
 * `playback` singleton) can be imported where there is no DOM, e.g. in tests.
 */
export function createAudioBackend(
  depsOrMakeElement: AudioBackendDeps | (() => HTMLAudioElement) = {}
): PlaybackBackend {
  const deps: AudioBackendDeps =
    typeof depsOrMakeElement === 'function' ? { makeElement: depsOrMakeElement } : depsOrMakeElement
  const makeElement = deps.makeElement ?? ((): HTMLAudioElement => new Audio())
  const invoke = deps.invoke ?? defaultInvoke
  const loadHls = deps.loadHls ?? loadHlsJs
  const now = deps.now ?? Date.now
  const createContext =
    deps.createContext === undefined ? defaultCreateContext() : deps.createContext
  const subscribeSettings = deps.onSettings ?? onAudioSettings
  const loadSettings = deps.loadSettings === undefined ? defaultLoadSettings : deps.loadSettings

  const handlers = new Set<(e: BackendEvent) => void>()
  const decks: Deck[] = []
  /** The deck the controller's current track plays on. */
  let cur: Deck | null = null
  let seq = 0
  let pending: PendingLoad | null = null
  /** True after stop() until the next load: element events are ignored. */
  let stopped = true
  let volume = 1
  let muted = false
  /** What follows the current track (from load opts). */
  let upcoming: Track[] = []
  let graph: AudioGraph | null = null
  let graphFailed = false
  let settings: AudioSettings = DEFAULT_AUDIO
  let xfade: Crossfade | null = null
  /** No crossfade out of the current source (next is DRM, failed, too short...). */
  let xfadeBlocked = false

  const emit = (e: BackendEvent): void => {
    for (const h of [...handlers]) h(e)
  }
  const elementDuration = (audio: HTMLAudioElement): number =>
    Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 0
  const durationOf = (d: Deck): number => {
    const ms = elementDuration(d.el)
    if (ms > 0 || d.track?.provider !== 'soundcloud') return ms
    return d.track.durationMs > 0 ? d.track.durationMs : 0
  }
  const isExpired = (s: StreamInfo): boolean =>
    s.expiresAt !== undefined && now() >= s.expiresAt - EXPIRY_MARGIN_MS
  const graphPossible = (): boolean => createContext !== null && !graphFailed
  const loadError = (d: Deck): Error =>
    new Error(
      d.track?.provider === 'soundcloud'
        ? streamErrorMessage(d.el.error)
        : mediaErrorMessage(d.el.error)
    )

  /** Wired elements play at full level; the graph's master applies volume instead. */
  const applyVolume = (d: Deck): void => {
    d.el.volume = d.channel ? 1 : volume
    d.el.muted = d.channel ? false : muted
  }

  const newDeck = (): Deck => {
    const audio = makeElement()
    audio.preload = 'auto'
    const d: Deck = {
      el: audio,
      channel: null,
      hls: null,
      mediaRecovered: false,
      track: null,
      stream: null,
      refreshing: null,
      lastRefreshAt: Number.NEGATIVE_INFINITY,
      graphOk: false
    }
    applyVolume(d)
    // Persistent listeners. Only the current deck reports. While a load or a URL
    // refresh is pending its promise reports the outcome, so element events about the
    // old/new source are suppressed.
    const quiet = (): boolean => stopped || d !== cur || pending !== null || d.refreshing !== null
    audio.addEventListener('playing', () => {
      if (!quiet()) emit({ type: 'playing' })
    })
    audio.addEventListener('pause', () => {
      if (!quiet()) emit({ type: 'paused' })
    })
    audio.addEventListener('waiting', () => {
      if (!quiet()) emit({ type: 'waiting' })
    })
    audio.addEventListener('ended', () => {
      // The outgoing deck of a fade: its 'ended' was reported when the fade began.
      if (xfade?.phase === 'fading' && d === xfade.from) {
        if (xfade.endedSent) {
          finishFade()
          return
        }
        cancelXfade() // ended before the fade could start: plain hand-off
      }
      if (!quiet()) emit({ type: 'ended' })
    })
    audio.addEventListener('error', () => {
      if (quiet()) return
      emit({ type: 'error', message: loadError(d).message })
    })
    audio.addEventListener('durationchange', () => {
      if (stopped || d !== cur) return
      const ms = elementDuration(audio)
      if (ms > 0) emit({ type: 'duration', durationMs: ms })
    })
    audio.addEventListener('timeupdate', () => {
      if (!quiet()) checkCrossfade()
    })
    decks.push(d)
    return d
  }

  const destroyHls = (d: Deck): void => {
    const h = d.hls
    d.hls = null
    h?.destroy()
  }

  const cancelPending = (): void => {
    const p = pending
    pending = null
    p?.cancel()
  }

  const cancelRefresh = (d: Deck | null): void => {
    const r = d?.refreshing
    if (!d || !r) return
    d.refreshing = null
    r.cancel()
  }

  /** Stop a deck and drop its source. */
  const release = (d: Deck): void => {
    cancelRefresh(d)
    destroyHls(d)
    d.track = null
    d.stream = null
    d.graphOk = false
    d.el.pause()
    d.el.removeAttribute('src')
    d.el.load()
  }

  /** Make `d` the current deck, releasing the previous one. */
  const makeCurrent = (d: Deck): void => {
    const old = cur
    cur = d
    if (old && old !== d) release(old)
  }

  /** Create the graph (first play) and route `d` through it when its source allows. */
  const ensureGraphFor = (d: Deck): void => {
    if (!d.graphOk || !graphPossible()) return
    if (!graph && createContext) {
      try {
        graph = createAudioGraph(createContext())
        graph.apply(settings)
        graph.setVolume(volume, muted)
      } catch {
        graph = null
        graphFailed = true
        return
      }
    }
    if (!graph) return
    if (!d.channel) {
      try {
        d.channel = graph.connect(d.el)
      } catch {
        d.graphOk = false
        return
      }
      applyVolume(d)
    }
    graph.resume()
  }

  /**
   * The deck for a new source. Plain sources (DRM, no CORS) need an element that was
   * never wired; graph sources prefer a wired one. At most two wired decks + one plain.
   */
  const deckFor = (mode: 'graph' | 'plain'): Deck => {
    if (mode === 'plain') {
      if (cur && !cur.channel) return cur
      return decks.find((d) => !d.channel) ?? newDeck()
    }
    if (cur?.channel) return cur
    return decks.find((d) => d.channel) ?? cur ?? newDeck()
  }

  /** Point `d` at track `t` (as current), with or without the graph. */
  const takeDeck = (t: Track, mode: 'graph' | 'plain'): Deck => {
    const d = deckFor(graphPossible() ? mode : 'plain')
    makeCurrent(d)
    cancelRefresh(d)
    destroyHls(d)
    d.track = t
    d.stream = null
    d.lastRefreshAt = Number.NEGATIVE_INFINITY
    d.graphOk = mode === 'graph' && graphPossible()
    // MediaElementSource is silent for cross-origin media without CORS.
    d.el.crossOrigin = d.graphOk ? 'anonymous' : null
    d.channel?.setGain(1, false)
    return d
  }

  /** hls.js errors after a successful load. */
  const onHlsRuntimeError = (d: Deck, h: HlsInstance, data: HlsErrorData): void => {
    if (h !== d.hls || d !== cur || stopped || d.refreshing || !data.fatal) return // non-fatal: hls.js recovers
    if (
      data.type === HLS_ERROR_TYPES.NETWORK &&
      d.stream &&
      (isExpiredUrlError(data) || isExpired(d.stream))
    ) {
      void refresh(d)
      return
    }
    if (data.type === HLS_ERROR_TYPES.MEDIA && !d.mediaRecovered) {
      d.mediaRecovered = true
      h.recoverMediaError()
      return
    }
    destroyHls(d)
    emit({ type: 'error', message: hlsErrorMessage(data) })
  }

  /**
   * Point a deck at a target and settle once it can play (for HLS: manifest
   * parsed and canplay). Rejects with a readable Error. cancel() detaches listeners
   * without settling.
   */
  const openTarget = (
    d: Deck,
    target: Target,
    startMs: number
  ): { done: Promise<void>; cancel: () => void } => {
    const audio = d.el
    let cleanup = (): void => {}
    const done = new Promise<void>((resolve, reject) => {
      let manifestParsed = target.kind !== 'hls'
      let canPlay = false
      let live = true
      const finish = (): void => {
        if (!manifestParsed || !canPlay) return
        cleanup()
        // hls.js seeks to its startPosition itself.
        if (target.kind === 'file' && startMs > 0) audio.currentTime = startMs / 1000
        resolve()
      }
      const onReady = (): void => {
        canPlay = true
        finish()
      }
      const onError = (): void => {
        cleanup()
        reject(loadError(d))
      }
      cleanup = () => {
        live = false
        audio.removeEventListener('canplay', onReady)
        audio.removeEventListener('error', onError)
      }
      audio.addEventListener('canplay', onReady)
      audio.addEventListener('error', onError)
      if (target.kind === 'hls') {
        const h = new target.Hls({
          startPosition: startMs > 0 ? startMs / 1000 : -1,
          enableWorker: false,
          ...(target.drm
            ? {
                emeEnabled: true,
                drmSystems: { [target.drm.keySystem]: { licenseUrl: target.drm.licenseUrl } },
                // Software Widevine (castLabs ECS, VMP-signed).
                drmSystemOptions: { audioRobustness: 'SW_SECURE_CRYPTO' }
              }
            : {})
        })
        d.hls = h
        d.mediaRecovered = false
        h.on(HLS_EVENTS.MANIFEST_PARSED, () => {
          if (!live) return
          manifestParsed = true
          finish()
        })
        h.on(HLS_EVENTS.ERROR, (_event, data) => {
          if (!live) {
            onHlsRuntimeError(d, h, data)
            return
          }
          if (!data.fatal || h !== d.hls) return
          cleanup()
          reject(new Error(hlsErrorMessage(data)))
        })
        h.attachMedia(audio)
        h.loadSource(target.url)
      } else {
        audio.src = target.url
        audio.load()
      }
    })
    return { done, cancel: () => cleanup() }
  }

  const fetchStream = async (t: Track): Promise<StreamInfo> => {
    let s: StreamInfo
    try {
      s = await invoke('soundcloud:getStream', t.nativeId)
    } catch (err) {
      throw new Error(errorMessage(err), { cause: err })
    }
    if (s.preview) throw new Error(MESSAGES.preview)
    return s
  }

  const targetFor = async (s: StreamInfo): Promise<Target> => {
    if (s.protocol === 'progressive') return { kind: 'file', url: s.url }
    const Hls = await loadHls()
    if (!Hls.isSupported()) throw new Error(MESSAGES.hlsUnsupported)
    return { kind: 'hls', url: s.url, Hls, drm: s.drm }
  }

  /** Re-resolve the stream URL and resume at the same position. Reports failure as 'error'. */
  const refresh = (d: Deck, positionMs?: number, play?: boolean): Promise<void> => {
    const audio = d.el
    const t = d.track
    if (!t || stopped || d !== cur) return Promise.resolve()
    if (d.refreshing) {
      if (positionMs !== undefined) d.refreshing.positionMs = positionMs
      if (play !== undefined) d.refreshing.play = play
      return d.refreshing.done
    }
    if (now() - d.lastRefreshAt < REFRESH_COOLDOWN_MS) {
      destroyHls(d)
      emit({ type: 'error', message: MESSAGES.expiredAgain })
      return Promise.resolve()
    }
    const mySeq = seq
    let innerCancel = (): void => {}
    const r: Refresh = {
      positionMs: positionMs ?? audio.currentTime * 1000,
      play: play ?? !audio.paused,
      cancel: () => innerCancel(),
      done: Promise.resolve()
    }
    d.refreshing = r
    d.lastRefreshAt = now()
    destroyHls(d)
    if (r.play) emit({ type: 'waiting' })
    r.done = (async () => {
      try {
        const s = await fetchStream(t)
        if (mySeq !== seq || d.refreshing !== r) return
        const target = await targetFor(s)
        if (mySeq !== seq || d.refreshing !== r) return
        const o = openTarget(d, target, r.positionMs)
        innerCancel = o.cancel
        await o.done
        if (mySeq !== seq || d.refreshing !== r) return
        d.stream = s
        d.refreshing = null
        d.lastRefreshAt = now()
        if (target.kind === 'hls') {
          // hls.js applies startPosition; nudge if the element reports otherwise.
          if (Math.abs(audio.currentTime * 1000 - r.positionMs) > 1000) {
            audio.currentTime = r.positionMs / 1000
          }
        }
      } catch (err) {
        if (mySeq !== seq) return
        if (d.refreshing === r) d.refreshing = null
        destroyHls(d)
        emit({ type: 'error', message: `${MESSAGES.refreshFailed}: ${errorMessage(err)}` })
        return
      }
      // A rejected play() (e.g. interrupted by pause()) is not a stream failure;
      // real media failures arrive as element 'error' events.
      if (r.play) await audio.play().catch(() => undefined)
      else emit({ type: 'paused' })
    })()
    return r.done
  }

  const canPlay = (t: Track): boolean => t.provider === 'local' || t.provider === 'soundcloud'

  // ---- Crossfade ----

  /** Stop any crossfade. The current deck keeps playing at full gain; the other is dropped. */
  const cancelXfade = (): void => {
    const x = xfade
    if (!x) return
    xfade = null
    x.cancelOpen()
    if (x.timer !== null) clearTimeout(x.timer)
    const other = x.adopted ? x.from : x.to
    if (other !== cur) release(other)
    if (cur && cur !== other) cur.channel?.setGain(1, true)
  }

  /** The fade ran its course: drop the outgoing deck. */
  const finishFade = (): void => {
    const x = xfade
    if (!x || x.phase !== 'fading') return
    if (!x.adopted) {
      // The controller moved elsewhere without telling us (it would have called
      // load/seek/pause, which cancel): keep what it thinks is current.
      cancelXfade()
      return
    }
    if (x.timer !== null) clearTimeout(x.timer)
    xfade = null
    release(x.from)
    x.to.channel?.setGain(1, true)
  }

  /** A wired deck other than the current one, for the incoming track. */
  const idleWiredDeck = (): Deck | null => {
    const found = decks.find((d) => d !== cur && d.channel)
    if (found) return found
    if (!graph) return null
    const d = newDeck()
    try {
      d.channel = graph.connect(d.el)
    } catch {
      return null
    }
    applyVolume(d)
    return d
  }

  const prepare = (from: Deck, next: Track): void => {
    const to = idleWiredDeck()
    if (!to) {
      xfadeBlocked = true
      return
    }
    release(to)
    const x: Crossfade = {
      phase: 'preparing',
      from,
      to,
      track: next,
      endedSent: false,
      adopted: false,
      cancelOpen: () => undefined,
      timer: null
    }
    xfade = x
    to.track = next
    to.graphOk = true
    to.el.crossOrigin = 'anonymous'
    to.channel?.setGain(0, false)
    void (async () => {
      try {
        let target: Target
        if (next.provider === 'local') {
          target = { kind: 'file', url: localAudioUrl(next.nativeId) }
        } else {
          const s = await fetchStream(next)
          if (xfade !== x) return
          // Protected media can't go through the graph: no fade, normal hand-off.
          if (s.drm) throw new Error('DRM stream')
          target = await targetFor(s)
          if (xfade !== x) return
          to.stream = s
        }
        const o = openTarget(to, target, 0)
        x.cancelOpen = o.cancel
        await o.done
        if (xfade !== x) return
        x.phase = 'ready'
        checkCrossfade()
      } catch {
        if (xfade !== x) return
        xfadeBlocked = true
        cancelXfade()
      }
    })()
  }

  const startFade = async (x: Crossfade, remainingMs: number): Promise<void> => {
    const fadeMs = Math.min(settings.crossfadeMs, remainingMs)
    // Too late for a real fade: the deck stays ready and the next load() adopts it
    // (paused) after the normal 'ended'.
    if (fadeMs < CROSSFADE_MIN_MS) return
    x.phase = 'fading'
    try {
      await x.to.el.play()
    } catch {
      if (xfade !== x) return
      xfadeBlocked = true
      cancelXfade()
      return
    }
    if (xfade !== x || cur !== x.from || stopped) return
    x.from.channel?.fade('out', fadeMs)
    x.to.channel?.fade('in', fadeMs)
    graph?.resetLevelling()
    x.timer = setTimeout(finishFade, fadeMs + 250)
    x.endedSent = true
    // The controller advances now and its load() of x.track adopts the playing deck.
    emit({ type: 'ended' })
  }

  /** On the current deck's timeupdate: prepare or start a crossfade when due. */
  const checkCrossfade = (): void => {
    const d = cur
    const fadeSetting = settings.crossfadeMs
    if (!d || fadeSetting <= 0 || !graph || !d.channel || !d.graphOk) return
    if (d.el.paused || pending || d.refreshing) return
    const dur = elementDuration(d.el)
    if (dur <= 0) return
    const remaining = dur - d.el.currentTime * 1000
    if (xfade) {
      if (xfade.from === d && xfade.phase === 'ready' && remaining <= fadeSetting) {
        void startFade(xfade, remaining)
      }
      return
    }
    if (xfadeBlocked || remaining > fadeSetting + CROSSFADE_PREPARE_LEAD_MS) return
    // The controller skips unplayable tracks; the first playable one is what comes next.
    const next = upcoming.find(isPlayable)
    if (!next || !canPlay(next) || next.availability === 'drm' || dur < fadeSetting * 2) {
      xfadeBlocked = true
      return
    }
    prepare(d, next)
  }

  /** load() of the track a crossfade prepared: take its deck over instead of reloading. */
  const adopt = (t: Track, startMs: number, autoplay: boolean): boolean => {
    const x = xfade
    if (!x || startMs > 0 || x.track.id !== t.id) return false
    if (x.phase === 'fading' && x.endedSent && !x.adopted) {
      x.adopted = true
      cur = x.to
      if (!autoplay) {
        cancelXfade()
        x.to.el.pause()
      }
      return true
    }
    if (x.phase === 'ready') {
      xfade = null
      makeCurrent(x.to)
      x.to.channel?.setGain(1, false)
      graph?.resetLevelling()
      return true
    }
    return false
  }

  // ---- Settings ----

  let settingsFromBus = false
  const applySettings = (s: AudioSettings): void => {
    settings = sanitizeAudioSettings(s)
    graph?.apply(settings)
    if (settings.crossfadeMs <= 0 && xfade && xfade.phase !== 'fading') cancelXfade()
  }
  subscribeSettings((s) => {
    settingsFromBus = true
    applySettings(s)
  })
  loadSettings?.()
    .then((s) => {
      if (s && !settingsFromBus) applySettings(s)
    })
    .catch(() => undefined)

  return {
    canPlay,

    load(t, startMs = 0, opts = {}) {
      cancelPending()
      if (canPlay(t) && adopt(t, startMs, opts.autoplay === true)) {
        seq++
        stopped = false
        upcoming = opts.upcoming ?? []
        xfadeBlocked = false
        return Promise.resolve()
      }
      cancelXfade()
      cancelRefresh(cur)
      if (!canPlay(t)) {
        return Promise.reject(new Error(`Can't play ${t.provider} tracks here.`))
      }
      const mySeq = ++seq
      stopped = false
      upcoming = opts.upcoming ?? []
      xfadeBlocked = false
      graph?.resetLevelling()
      if (cur) {
        destroyHls(cur)
        cur.track = t
        cur.stream = null
        cur.lastRefreshAt = Number.NEGATIVE_INFINITY
      }
      return new Promise<void>((resolve, reject) => {
        let innerCancel = (): void => {}
        pending = {
          cancel: () => {
            innerCancel()
            reject(new LoadAbortedError())
          }
        }
        // A newer load bumps `seq`; a stale continuation must never touch it.
        const open = (d: Deck, target: Target): Promise<void> => {
          const o = openTarget(d, target, startMs)
          innerCancel = o.cancel
          return o.done
        }
        /** Through the graph if possible; a file source that fails with CORS is retried plain. */
        const openGraphOrPlain = async (target: Target, s: StreamInfo | null): Promise<void> => {
          const d = takeDeck(t, 'graph')
          d.stream = s
          if (!d.graphOk || target.kind !== 'file') return open(d, target)
          try {
            await open(d, target)
          } catch {
            if (mySeq !== seq) return
            const p = takeDeck(t, 'plain')
            p.stream = s
            await open(p, target)
          }
        }
        const settle = (p: Promise<void>): void => {
          p.then(
            () => {
              if (mySeq !== seq) return
              pending = null
              resolve()
            },
            (err: unknown) => {
              if (mySeq !== seq) return
              pending = null
              if (cur) destroyHls(cur)
              reject(err instanceof Error ? err : new Error(String(err)))
            }
          )
        }
        if (t.provider === 'local') {
          settle(openGraphOrPlain({ kind: 'file', url: localAudioUrl(t.nativeId) }, null))
          return
        }
        settle(
          (async () => {
            const s = await fetchStream(t)
            if (mySeq !== seq) return
            const target = await targetFor(s)
            if (mySeq !== seq) return
            if (s.drm) {
              const d = takeDeck(t, 'plain')
              d.stream = s
              await open(d, target)
              return
            }
            await openGraphOrPlain(target, s)
          })()
        )
      })
    },

    async play() {
      const d = cur
      if (!d || stopped) return
      if (d.refreshing) {
        d.refreshing.play = true
        return d.refreshing.done
      }
      if (d.stream && isExpired(d.stream)) return refresh(d, d.el.currentTime * 1000, true)
      ensureGraphFor(d)
      await d.el.play()
    },

    pause() {
      // A fade in progress stops: the incoming track pauses, the outgoing is dropped.
      if (xfade?.phase === 'fading') cancelXfade()
      if (cur?.refreshing) cur.refreshing.play = false
      cur?.el.pause()
    },

    seek(ms) {
      const d = cur
      if (!d || stopped || !Number.isFinite(ms)) return
      cancelXfade()
      const max = durationOf(d)
      const clamped = Math.max(0, max > 0 ? Math.min(ms, max) : ms)
      if (d.refreshing) {
        d.refreshing.positionMs = clamped
        return
      }
      if (d.stream && isExpired(d.stream)) {
        void refresh(d, clamped, !d.el.paused)
        return
      }
      d.el.currentTime = clamped / 1000
    },

    setVolume(v, m) {
      volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1))
      muted = m
      for (const d of decks) applyVolume(d)
      graph?.setVolume(volume, muted)
    },

    getPositionMs() {
      const d = cur
      if (!d || stopped) return 0
      return d.refreshing ? d.refreshing.positionMs : d.el.currentTime * 1000
    },

    getDurationMs() {
      return cur && !stopped ? durationOf(cur) : 0
    },

    stop() {
      cancelPending()
      cancelXfade()
      seq++
      for (const d of decks) {
        cancelRefresh(d)
        destroyHls(d)
        d.track = null
        d.stream = null
      }
      if (stopped || !cur) {
        stopped = true
        return
      }
      stopped = true
      cur.el.pause()
      cur.el.removeAttribute('src')
      cur.el.load()
    },

    on(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    }
  }
}
