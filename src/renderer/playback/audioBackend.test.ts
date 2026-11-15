import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localAudioUrl } from '@shared/library'
import { DEFAULT_AUDIO, type AudioSettings } from '@shared/playback'
import type { StreamInfo } from '@shared/provider'
import type { Provider, Track } from '@shared/types'
import type { Api } from '@shared/ipc'
import { createAudioBackend, MESSAGES, type AudioBackendDeps } from './audioBackend'
import { createPlaybackController } from './controller'
import { FakeAudioContext } from './webAudioFakes'
import { LoadAbortedError, type BackendEvent, type PlaybackBackend } from './backend'
import type { HlsConfigLike, HlsErrorData, HlsInstance } from './hlsSource'

class FakeAudio extends EventTarget {
  src = ''
  preload = ''
  crossOrigin: string | null = null
  volume = 1
  muted = false
  currentTime = 0
  duration = Number.NaN
  paused = true
  error: { code: number; message: string } | null = null
  loads = 0
  plays = 0
  load(): void {
    this.loads++
  }
  async play(): Promise<void> {
    this.plays++
    this.paused = false
    this.fire('playing')
  }
  pause(): void {
    this.paused = true
    this.fire('pause')
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }
  fire(type: string): void {
    this.dispatchEvent(new Event(type))
  }
}

class FakeHls implements HlsInstance {
  static instances: FakeHls[] = []
  static supported = true
  static isSupported(): boolean {
    return FakeHls.supported
  }
  listeners = new Map<string, ((event: string, data: HlsErrorData) => void)[]>()
  media: unknown = null
  url = ''
  destroyed = false
  recovers = 0
  constructor(public config: HlsConfigLike) {
    FakeHls.instances.push(this)
  }
  attachMedia(media: HTMLMediaElement): void {
    this.media = media
  }
  loadSource(url: string): void {
    this.url = url
  }
  on(event: string, listener: (event: string, data: HlsErrorData) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  recoverMediaError(): void {
    this.recovers++
  }
  destroy(): void {
    this.destroyed = true
  }
  emit(event: string, data: Partial<HlsErrorData> = {}): void {
    const full = { type: '', details: '', fatal: false, ...data }
    for (const l of this.listeners.get(event) ?? []) l(event, full)
  }
  manifest(): void {
    this.emit('hlsManifestParsed')
  }
  fail(data: Partial<HlsErrorData>): void {
    this.emit('hlsError', data)
  }
}

function track(n: number | string, provider: Provider = 'soundcloud'): Track {
  return {
    id: `${provider}:${n}`,
    provider,
    nativeId: String(n),
    title: `Track ${n}`,
    artists: ['A'],
    durationMs: 200_000
  }
}

function hlsStream(url = 'https://playback.example/a.m3u8', expiresAt?: number): StreamInfo {
  return {
    url,
    protocol: 'hls',
    mimeType: 'audio/mp4',
    preview: false,
    ...(expiresAt ? { expiresAt } : {})
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

let audio: FakeAudio
let streams: (StreamInfo | Error | Deferred<StreamInfo>)[]
let invokes: unknown[][]
let hlsLoads: number
let clock: number
let events: BackendEvent[]
let b: PlaybackBackend

beforeEach(() => {
  audio = new FakeAudio()
  streams = []
  invokes = []
  hlsLoads = 0
  clock = 1_000_000
  events = []
  FakeHls.instances = []
  FakeHls.supported = true
  const invoke = ((...args: unknown[]) => {
    invokes.push(args)
    const next = streams.shift()
    if (!next) return Promise.reject(new Error('no stream queued'))
    if (next instanceof Error) return Promise.reject(next)
    if ('promise' in next) return next.promise
    return Promise.resolve(next)
  }) as Api['invoke']
  b = createAudioBackend({
    makeElement: () => audio as unknown as HTMLAudioElement,
    invoke,
    loadHls: async () => {
      hlsLoads++
      return FakeHls
    },
    now: () => clock
  })
  b.on((e) => events.push(e))
})

const lastHls = (): FakeHls => {
  const h = FakeHls.instances[FakeHls.instances.length - 1]
  if (!h) throw new Error('no Hls instance')
  return h
}

/** Load a SoundCloud HLS track to the ready state. */
async function loadHlsTrack(startMs = 0, stream = hlsStream()): Promise<FakeHls> {
  streams.push(stream)
  const p = b.load(track(1), startMs)
  await flush()
  const h = lastHls()
  h.manifest()
  audio.fire('canplay')
  await p
  return h
}

describe('local files (unchanged)', () => {
  it('loads through media:// and seeks to startMs on canplay', async () => {
    const p = b.load(track('C:/a.mp3', 'local'), 3000)
    expect(audio.src).toBe(localAudioUrl('C:/a.mp3'))
    expect(audio.loads).toBe(1)
    audio.fire('canplay')
    await p
    expect(audio.currentTime).toBe(3)
    expect(hlsLoads).toBe(0)
    expect(invokes).toEqual([])
  })

  it('rejects on a media error without emitting an error event', async () => {
    const p = b.load(track('x', 'local'))
    audio.error = { code: 4, message: '' }
    audio.fire('error')
    await expect(p).rejects.toThrow(/can't be played/)
    expect(events).toEqual([])
  })

  it('a newer load aborts the older one', async () => {
    const p1 = b.load(track('a', 'local'))
    const p2 = b.load(track('b', 'local'))
    await expect(p1).rejects.toBeInstanceOf(LoadAbortedError)
    audio.fire('canplay')
    await p2
  })

  it('reports element errors after a successful load', async () => {
    const p = b.load(track('a', 'local'))
    audio.fire('canplay')
    await p
    audio.error = { code: 3, message: '' }
    audio.fire('error')
    expect(events).toEqual([{ type: 'error', message: expect.stringMatching(/damaged/) }])
  })
})

describe('SoundCloud loading', () => {
  it('can play soundcloud and local, not spotify', () => {
    expect(b.canPlay(track(1))).toBe(true)
    expect(b.canPlay(track(1, 'local'))).toBe(true)
    expect(b.canPlay(track(1, 'spotify'))).toBe(false)
  })

  it('HLS: fetches the stream, attaches hls.js and resolves on manifest + canplay', async () => {
    streams.push(hlsStream('https://playback.example/x.m3u8'))
    let resolved = false
    const p = b.load(track(7), 12_000).then(() => {
      resolved = true
    })
    await flush()
    expect(invokes).toEqual([['soundcloud:getStream', '7']])
    const h = lastHls()
    expect(h.config.startPosition).toBe(12)
    expect(h.url).toBe('https://playback.example/x.m3u8')
    expect(h.media).toBe(audio)
    audio.fire('canplay')
    await flush()
    expect(resolved).toBe(false)
    h.manifest()
    await p
    expect(resolved).toBe(true)
    expect(events).toEqual([])
  })

  it('progressive: plays the URL directly on the element', async () => {
    streams.push({ ...hlsStream('https://cdn.example/a.mp3'), protocol: 'progressive' })
    const p = b.load(track(1), 2000)
    await flush()
    expect(audio.src).toBe('https://cdn.example/a.mp3')
    expect(hlsLoads).toBe(0)
    audio.fire('canplay')
    await p
    expect(audio.currentTime).toBe(2)
  })

  it('strips the Electron IPC prefix from stream errors', async () => {
    streams.push(
      new Error("Error invoking remote method 'soundcloud:getStream': Error: Not logged in")
    )
    await expect(b.load(track(1))).rejects.toThrow(/^Not logged in$/)
    expect(events).toEqual([])
  })

  it('rejects preview-only streams', async () => {
    streams.push({ ...hlsStream(), preview: true })
    await expect(b.load(track(1))).rejects.toThrow(MESSAGES.preview)
  })

  it('rejects when hls.js is unsupported', async () => {
    FakeHls.supported = false
    streams.push(hlsStream())
    await expect(b.load(track(1))).rejects.toThrow(MESSAGES.hlsUnsupported)
  })

  it('rejects on a fatal hls.js error during load, without an error event', async () => {
    streams.push(hlsStream())
    const p = b.load(track(1))
    await flush()
    const h = lastHls()
    h.fail({
      type: 'networkError',
      details: 'manifestLoadError',
      fatal: true,
      response: { code: 500 }
    })
    await expect(p).rejects.toThrow(/HTTP 500/)
    expect(h.destroyed).toBe(true)
    expect(events).toEqual([])
  })

  it('a newer load aborts a pending stream fetch', async () => {
    const d = deferred<StreamInfo>()
    streams.push(d)
    const p1 = b.load(track(1))
    const p2 = b.load(track('b', 'local'))
    await expect(p1).rejects.toBeInstanceOf(LoadAbortedError)
    d.resolve(hlsStream())
    await flush()
    expect(FakeHls.instances).toEqual([])
    audio.fire('canplay')
    await p2
  })

  it('stop aborts a pending load', async () => {
    streams.push(hlsStream())
    const p = b.load(track(1))
    await flush()
    b.stop()
    await expect(p).rejects.toBeInstanceOf(LoadAbortedError)
    expect(lastHls().destroyed).toBe(true)
  })

  it('destroys the previous Hls on a new load and on stop', async () => {
    const h1 = await loadHlsTrack()
    const h2 = await loadHlsTrack()
    expect(h1.destroyed).toBe(true)
    expect(h2.destroyed).toBe(false)
    const p = b.load(track('a', 'local'))
    expect(h2.destroyed).toBe(true)
    audio.fire('canplay')
    await p
    const h3 = await loadHlsTrack()
    b.stop()
    expect(h3.destroyed).toBe(true)
  })

  it('duration: element when finite, else the track duration', async () => {
    await loadHlsTrack()
    expect(b.getDurationMs()).toBe(200_000)
    audio.duration = 199.5
    expect(b.getDurationMs()).toBe(199_500)
  })

  it('ignores non-fatal hls.js errors; recovers a fatal media error once', async () => {
    const h = await loadHlsTrack()
    h.fail({ type: 'networkError', details: 'fragLoadError', fatal: false })
    h.fail({ type: 'mediaError', details: 'bufferStalledError', fatal: true })
    expect(h.recovers).toBe(1)
    expect(events).toEqual([])
    h.fail({ type: 'mediaError', details: 'bufferAppendError', fatal: true })
    expect(h.recovers).toBe(1)
    expect(events).toEqual([{ type: 'error', message: expect.stringMatching(/decoded/) }])
  })
})

describe('expired stream URLs', () => {
  it('a fatal 403 refreshes the URL once and resumes playing at the position', async () => {
    const h1 = await loadHlsTrack()
    await b.play()
    audio.currentTime = 42
    events = []
    streams.push(hlsStream('https://playback.example/fresh.m3u8'))
    h1.fail({
      type: 'networkError',
      details: 'fragLoadError',
      fatal: true,
      response: { code: 403 }
    })
    expect(h1.destroyed).toBe(true)
    expect(b.getPositionMs()).toBe(42_000)
    await flush()
    const h2 = lastHls()
    expect(h2).not.toBe(h1)
    expect(h2.url).toBe('https://playback.example/fresh.m3u8')
    expect(h2.config.startPosition).toBe(42)
    audio.currentTime = 42
    const plays = audio.plays
    h2.manifest()
    audio.fire('canplay')
    await flush()
    expect(audio.plays).toBe(plays + 1)
    expect(events).toEqual([{ type: 'waiting' }, { type: 'playing' }])
  })

  it('keeps a paused track paused after refreshing', async () => {
    const h1 = await loadHlsTrack()
    audio.currentTime = 10
    streams.push(hlsStream('https://playback.example/fresh.m3u8'))
    h1.fail({
      type: 'networkError',
      details: 'levelLoadError',
      fatal: true,
      response: { code: 410 }
    })
    await flush()
    const h2 = lastHls()
    h2.manifest()
    audio.fire('canplay')
    await flush()
    expect(audio.plays).toBe(0)
    expect(events).toEqual([{ type: 'paused' }])
  })

  it('a failed refresh emits a readable error', async () => {
    const h1 = await loadHlsTrack()
    streams.push(new Error("Error invoking remote method 'soundcloud:getStream': Error: offline"))
    h1.fail({
      type: 'networkError',
      details: 'fragLoadError',
      fatal: true,
      response: { code: 401 }
    })
    await flush()
    expect(events).toEqual([{ type: 'error', message: `${MESSAGES.refreshFailed}: offline` }])
  })

  it('does not refresh twice in a row for the same failure', async () => {
    const h1 = await loadHlsTrack()
    streams.push(hlsStream('https://playback.example/fresh.m3u8'))
    h1.fail({
      type: 'networkError',
      details: 'fragLoadError',
      fatal: true,
      response: { code: 403 }
    })
    await flush()
    const h2 = lastHls()
    h2.manifest()
    audio.fire('canplay')
    await flush()
    h2.fail({
      type: 'networkError',
      details: 'fragLoadError',
      fatal: true,
      response: { code: 403 }
    })
    await flush()
    expect(invokes.length).toBe(2)
    expect(events.at(-1)).toEqual({ type: 'error', message: MESSAGES.expiredAgain })
  })

  it('refreshes before play() once expiresAt has passed', async () => {
    await loadHlsTrack(0, hlsStream('https://playback.example/a.m3u8', clock + 7_200_000))
    audio.currentTime = 30
    clock += 7_300_000
    streams.push(hlsStream('https://playback.example/fresh.m3u8', clock + 7_200_000))
    const p = b.play()
    await flush()
    const h2 = lastHls()
    expect(h2.url).toBe('https://playback.example/fresh.m3u8')
    expect(h2.config.startPosition).toBe(30)
    audio.currentTime = 30
    h2.manifest()
    audio.fire('canplay')
    await p
    expect(audio.paused).toBe(false)
  })

  it('refreshes on seek once expiresAt has passed, at the seek target', async () => {
    await loadHlsTrack(0, hlsStream('https://playback.example/a.m3u8', clock + 1000))
    clock += 60_000
    streams.push(hlsStream('https://playback.example/fresh.m3u8'))
    b.seek(90_000)
    expect(b.getPositionMs()).toBe(90_000)
    await flush()
    expect(lastHls().config.startPosition).toBe(90)
  })

  it('a new load during a refresh cancels it', async () => {
    const h1 = await loadHlsTrack()
    const d = deferred<StreamInfo>()
    streams.push(d)
    h1.fail({
      type: 'networkError',
      details: 'fragLoadError',
      fatal: true,
      response: { code: 403 }
    })
    const p = b.load(track('a', 'local'))
    d.resolve(hlsStream('https://playback.example/fresh.m3u8'))
    await flush()
    expect(FakeHls.instances.length).toBe(1)
    audio.fire('canplay')
    await p
    expect(events.filter((e) => e.type === 'error')).toEqual([])
  })
})

describe('Web Audio graph', () => {
  let els: FakeAudio[]
  let ctx: FakeAudioContext
  let publish: (s: AudioSettings) => void
  let g: PlaybackBackend
  let ev: BackendEvent[]

  const queuedInvoke = ((...args: unknown[]) => {
    invokes.push(args)
    const next = streams.shift()
    if (!next) return Promise.reject(new Error('no stream queued'))
    if (next instanceof Error) return Promise.reject(next)
    if ('promise' in next) return next.promise
    return Promise.resolve(next)
  }) as Api['invoke']

  const make = (over: Partial<AudioBackendDeps> = {}): PlaybackBackend => {
    const be = createAudioBackend({
      makeElement: () => {
        const a = new FakeAudio()
        els.push(a)
        return a as unknown as HTMLAudioElement
      },
      invoke: queuedInvoke,
      loadHls: async () => FakeHls,
      now: () => clock,
      createContext: () => ctx.asContext(),
      onSettings: (l) => {
        publish = l
        return () => undefined
      },
      loadSettings: null,
      ...over
    })
    be.on((e) => ev.push(e))
    return be
  }

  beforeEach(() => {
    vi.useFakeTimers()
    els = []
    ctx = new FakeAudioContext()
    ev = []
    publish = () => undefined
    g = make()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const el = (i: number): FakeAudio => {
    const a = els[i]
    if (!a) throw new Error(`no element ${i}`)
    return a
  }
  const local = (n: string): Track => track(n, 'local')
  const wired = (a: FakeAudio): boolean => ctx.sources.some((s) => s.element === a)
  const deckGain = (a: FakeAudio): number => {
    const gn = ctx.deckGainOf(a)
    if (!gn) throw new Error('element not wired')
    return gn.gain.value
  }
  const endedCount = (): number => ev.filter((e) => e.type === 'ended').length
  const withFade = (crossfadeMs: number): void =>
    publish({ ...DEFAULT_AUDIO, eq: { ...DEFAULT_AUDIO.eq }, crossfadeMs })

  /** Load a local track on whichever element gets its src, and resolve it. */
  async function loadLocal(t: Track, upcoming: Track[] = [], autoplay = true): Promise<FakeAudio> {
    const p = g.load(t, 0, { autoplay, upcoming })
    await flush()
    const a = els.find((x) => x.src === localAudioUrl(t.nativeId))
    if (!a) throw new Error('track not on any element')
    a.fire('canplay')
    await p
    return a
  }

  /** A playing local track A (200 s) with `next` after it. */
  async function playingWithNext(next: Track, fadeMs = 4000): Promise<FakeAudio> {
    withFade(fadeMs)
    const a = await loadLocal(local('a'), [next])
    await g.play()
    a.duration = 200
    return a
  }
  const at = async (a: FakeAudio, seconds: number): Promise<void> => {
    a.currentTime = seconds
    a.fire('timeupdate')
    await flush()
  }

  describe('wiring', () => {
    it('creates the context on first play and routes the element; volume moves to the master', async () => {
      g.setVolume(0.5, false)
      const a = await loadLocal(local('a'))
      expect(a.crossOrigin).toBe('anonymous')
      expect(ctx.sources).toEqual([])
      expect(a.volume).toBe(0.5)
      await g.play()
      expect(wired(a)).toBe(true)
      expect(a.volume).toBe(1)
      expect(a.muted).toBe(false)
      const master = ctx.gains[2]
      expect(master?.gain.value).toBe(0.5)
      g.setVolume(0.2, true)
      expect(master?.gain.value).toBe(0)
      expect(a.volume).toBe(1)
      expect(a.plays).toBe(1)
    })

    it('resumes a suspended context on play', async () => {
      ctx.state = 'suspended'
      await loadLocal(local('a'))
      await g.play()
      expect(ctx.resumes).toBe(1)
    })

    it('falls back to a plain element when the AudioContext cannot be created', async () => {
      g = make({
        createContext: () => {
          throw new Error('no audio')
        }
      })
      g.setVolume(0.3, false)
      withFade(4000)
      const a = await loadLocal(local('a'), [local('b')])
      await g.play()
      expect(a.plays).toBe(1)
      expect(a.volume).toBe(0.3)
      a.duration = 200
      await at(a, 197)
      expect(els.length).toBe(1) // no crossfade without the graph
      // A DRM track still plays on the same (never wired) element.
      streams.push({ ...hlsStream(), drm: { keySystem: 'com.widevine.alpha', licenseUrl: 'x' } })
      const p = g.load(track(9))
      await flush()
      lastHls().manifest()
      a.fire('canplay')
      await p
      expect(lastHls().media).toBe(a)
      expect(els.length).toBe(1)
    })

    it('with createContext null plays exactly like a plain element', async () => {
      g = make({ createContext: null })
      const a = await loadLocal(local('a'))
      expect(a.crossOrigin).toBeNull()
      await g.play()
      expect(ctx.sources).toEqual([])
    })
  })

  describe('DRM and CORS bypass', () => {
    const drm = (): StreamInfo => ({
      ...hlsStream('https://playback.example/enc.m3u8'),
      drm: { keySystem: 'com.widevine.alpha', licenseUrl: 'https://lic.example/x' }
    })

    it('plays DRM streams on a separate element that is never wired', async () => {
      const a = await loadLocal(local('a'))
      await g.play()
      g.setVolume(0.5, false)
      streams.push(drm())
      const p = g.load(track(5), 0, { autoplay: true })
      await flush()
      const h = lastHls()
      const plain = el(1)
      expect(h.media).toBe(plain)
      expect(h.config.emeEnabled).toBe(true)
      expect(plain.crossOrigin).toBeNull()
      h.manifest()
      plain.fire('canplay')
      await p
      await g.play()
      expect(wired(plain)).toBe(false)
      expect(plain.volume).toBe(0.5)
      expect(a.src).toBe('') // previous deck released
      // Back to a clear track: the wired element again.
      const back = await loadLocal(local('c'))
      expect(back).toBe(a)
      expect(plain.src).toBe('')
      expect(els.length).toBe(2)
    })

    it('retries a progressive source without CORS on a plain element', async () => {
      await loadLocal(local('a'))
      await g.play()
      streams.push({ ...hlsStream('https://cdn.example/a.mp3'), protocol: 'progressive' })
      const p = g.load(track(3))
      await flush()
      const a = el(0)
      expect(a.src).toBe('https://cdn.example/a.mp3')
      expect(a.crossOrigin).toBe('anonymous')
      a.error = { code: 4, message: '' }
      a.fire('error')
      await flush()
      const plain = el(1)
      expect(plain.src).toBe('https://cdn.example/a.mp3')
      expect(plain.crossOrigin).toBeNull()
      plain.fire('canplay')
      await p
      await g.play()
      expect(wired(plain)).toBe(false)
      expect(ev.filter((e) => e.type === 'error')).toEqual([])
    })

    it('reports the error when the plain retry fails too', async () => {
      await loadLocal(local('a'))
      await g.play()
      const p = g.load(local('missing'))
      el(0).error = { code: 4, message: '' }
      el(0).fire('error')
      await flush()
      el(1).error = { code: 4, message: '' }
      el(1).fire('error')
      await expect(p).rejects.toThrow(/can't be played/)
    })
  })

  describe('settings', () => {
    it('applies EQ and levelling live, including settings published before the graph exists', async () => {
      const gains = [1, 2, 3, 4, 5, -1, -2, -3, -4, -5]
      publish({ levelling: false, crossfadeMs: 0, eq: { enabled: true, gains } })
      await loadLocal(local('a'))
      await g.play()
      expect(ctx.filters.map((f) => f.gain.value)).toEqual(gains)
      publish({ levelling: true, crossfadeMs: 0, eq: { enabled: false, gains } })
      expect(ctx.filters.every((f) => f.gain.value === 0)).toBe(true)
      expect(ctx.gains[1]?.out).toEqual([ctx.compressors[0]])
    })

    it('loads saved settings at startup unless the bus already published', async () => {
      const gains = [6, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      const saved: AudioSettings = {
        levelling: false,
        crossfadeMs: 0,
        eq: { enabled: true, gains }
      }
      g = make({ loadSettings: () => Promise.resolve(saved), onSettings: () => () => undefined })
      await flush()
      await loadLocal(local('a'))
      await g.play()
      expect(ctx.filters[0]?.gain.value).toBe(6)

      ctx = new FakeAudioContext()
      g = make({
        loadSettings: () => Promise.resolve(saved),
        onSettings: (l) => {
          l(DEFAULT_AUDIO)
          return () => undefined
        }
      })
      await flush()
      await loadLocal(local('b'))
      await g.play()
      expect(ctx.filters[0]?.gain.value).toBe(0)
    })

    it('resets the levelling gain on each new track', async () => {
      publish({ ...DEFAULT_AUDIO, levelling: true })
      await loadLocal(local('a'))
      await g.play()
      const analyser = ctx.analysers[0]
      if (!analyser) throw new Error('no analyser')
      analyser.amplitude = 0.05
      vi.advanceTimersByTime(2000)
      const level = ctx.gains[1]
      expect(level?.gain.value).toBeGreaterThan(1)
      analyser.amplitude = 0
      await loadLocal(local('b'))
      expect(level?.gain.value).toBe(1)
    })
  })

  describe('crossfade', () => {
    it('prepares the next track, fades with equal-power curves, emits ended once and adopts', async () => {
      const b = local('b')
      const a = await playingWithNext(b)
      await at(a, 190) // 10 s left: more than fade + lead
      expect(els.length).toBe(1)
      await at(a, 192) // 8 s left: prepare
      const n = el(1)
      expect(n.src).toBe(localAudioUrl('b'))
      expect(n.crossOrigin).toBe('anonymous')
      expect(wired(n)).toBe(true)
      expect(deckGain(n)).toBe(0)
      n.fire('canplay')
      await flush()
      expect(n.plays).toBe(0)
      await at(a, 196.5) // 3.5 s left: fade
      expect(n.plays).toBe(1)
      expect(endedCount()).toBe(1)
      const outCurve = ctx.deckGainOf(a)?.gain.curves[0]
      const inCurve = ctx.deckGainOf(n)?.gain.curves[0]
      expect(outCurve?.durationS).toBeCloseTo(3.5, 6)
      expect(inCurve?.durationS).toBeCloseTo(3.5, 6)
      expect(outCurve?.curve[0]).toBeCloseTo(1, 6)
      expect(inCurve?.curve[0]).toBeCloseTo(0, 6)

      const loadsBefore = n.loads
      await g.load(b, 0, { autoplay: true, upcoming: [] })
      expect(n.loads).toBe(loadsBefore)
      n.currentTime = 1.5
      expect(g.getPositionMs()).toBe(1500)
      a.fire('ended')
      expect(endedCount()).toBe(1)
      expect(a.src).toBe('')
      expect(deckGain(n)).toBe(1)
    })

    it('drops the outgoing deck when the fade timer runs out', async () => {
      const b = local('b')
      const a = await playingWithNext(b)
      await at(a, 192)
      el(1).fire('canplay')
      await at(a, 196)
      await g.load(b, 0, { autoplay: true })
      vi.advanceTimersByTime(4300)
      expect(a.src).toBe('')
      expect(a.paused).toBe(true)
    })

    it('works end to end with the controller', async () => {
      withFade(4000)
      const c = createPlaybackController([g], { storage: null })
      const a0 = local('a')
      const b0 = local('b')
      const p = c.playTracks([a0, b0], 0)
      await flush()
      el(0).fire('canplay')
      await p
      await flush()
      expect(c.getState().status).toBe('playing')
      const a = el(0)
      a.duration = 200
      await at(a, 192)
      el(1).fire('canplay')
      await flush()
      const loads = el(1).loads
      await at(a, 196.5)
      await flush()
      expect(c.getState().current?.track.id).toBe(b0.id)
      expect(c.getState().status).toBe('playing')
      expect(el(1).src).toBe(localAudioUrl('b'))
      expect(el(1).loads).toBe(loads) // adopted, not reloaded
      a.fire('ended')
      await flush()
      expect(c.getState().current?.track.id).toBe(b0.id)
      c.dispose()
    })

    async function fading(): Promise<{ a: FakeAudio; n: FakeAudio }> {
      const b = local('b')
      const a = await playingWithNext(b)
      await at(a, 192)
      const n = el(1)
      n.fire('canplay')
      await at(a, 196)
      await g.load(b, 0, { autoplay: true })
      return { a, n }
    }

    it('pause during a fade pauses and drops the outgoing deck', async () => {
      const { a, n } = await fading()
      g.pause()
      expect(a.src).toBe('')
      expect(a.paused).toBe(true)
      expect(n.paused).toBe(true)
      expect(deckGain(n)).toBe(1)
      expect(n.src).toBe(localAudioUrl('b'))
    })

    it('seek during a fade keeps the incoming track at full gain', async () => {
      const { a, n } = await fading()
      g.seek(5000)
      expect(a.src).toBe('')
      expect(n.paused).toBe(false)
      expect(n.currentTime).toBe(5)
      expect(deckGain(n)).toBe(1)
    })

    it('skipping during a fade stops it and loads the new track', async () => {
      const { a, n } = await fading()
      const c = await loadLocal(local('c'))
      expect(a.src).toBe('')
      expect(c).toBe(n)
      expect(deckGain(n)).toBe(1)
    })

    it('repeat-one style seek(0) before adoption keeps the old track', async () => {
      const a = await playingWithNext(local('b'))
      await at(a, 192)
      const n = el(1)
      n.fire('canplay')
      await at(a, 196)
      expect(endedCount()).toBe(1)
      g.seek(0) // controller with repeat 'one' does this instead of load()
      expect(n.src).toBe('')
      expect(a.currentTime).toBe(0)
      expect(deckGain(a)).toBe(1)
    })

    it('a different next track than prepared cancels the fade and loads normally', async () => {
      const a = await playingWithNext(local('b'))
      await at(a, 192)
      el(1).fire('canplay')
      await at(a, 196)
      const p = g.load(local('z'))
      await flush()
      expect(el(1).src).toBe('')
      expect(a.src).toBe(localAudioUrl('z'))
      a.fire('canplay')
      await p
      expect(deckGain(a)).toBe(1)
    })

    it('no fade into a DRM SoundCloud track: checks the stream, then hands off normally', async () => {
      const a = await playingWithNext(track(4))
      streams.push({
        ...hlsStream(),
        drm: { keySystem: 'com.widevine.alpha', licenseUrl: 'https://lic.example/x' }
      })
      await at(a, 192)
      expect(invokes).toEqual([['soundcloud:getStream', '4']])
      expect(FakeHls.instances).toEqual([])
      await at(a, 197)
      expect(endedCount()).toBe(0)
      expect(invokes.length).toBe(1) // not retried
      a.fire('ended')
      expect(endedCount()).toBe(1)
    })

    it('no fade (and no stream fetch) for a track already marked DRM', async () => {
      const a = await playingWithNext({ ...track(4), availability: 'drm' })
      await at(a, 197)
      expect(invokes).toEqual([])
      expect(els.length).toBe(1)
    })

    it('fades into a clear SoundCloud HLS track', async () => {
      const a = await playingWithNext(track(6))
      streams.push(hlsStream('https://playback.example/next.m3u8'))
      await at(a, 192)
      const h = lastHls()
      expect(h.media).toBe(el(1))
      h.manifest()
      el(1).fire('canplay')
      await at(a, 196)
      expect(el(1).plays).toBe(1)
      expect(endedCount()).toBe(1)
    })

    it('no fade for the last track, repeat-one (empty upcoming), 0 ms or a Spotify next', async () => {
      withFade(4000)
      const a = await loadLocal(local('a'), [])
      await g.play()
      a.duration = 200
      await at(a, 197)
      expect(els.length).toBe(1)

      await loadLocal(local('c'), [track('s', 'spotify')])
      a.duration = 200
      await at(a, 197)
      expect(els.length).toBe(1)

      withFade(0)
      await loadLocal(local('d'), [local('e')])
      a.duration = 200
      await at(a, 197)
      expect(els.length).toBe(1)
    })

    it('no fade when paused or when the track is shorter than two fades', async () => {
      const a = await playingWithNext(local('b'), 4000)
      a.duration = 7
      await at(a, 5)
      expect(els.length).toBe(1)
      await loadLocal(local('c'), [local('b')])
      a.duration = 200
      g.pause()
      await at(a, 197)
      expect(els.length).toBe(1)
    })

    it('a next track ready too late is adopted paused after the normal end', async () => {
      const b = local('b')
      const a = await playingWithNext(b)
      await at(a, 192)
      const n = el(1)
      await at(a, 199.6) // still loading
      n.fire('canplay') // ready with 400 ms left: too late to fade
      await flush()
      await at(a, 199.7)
      expect(n.plays).toBe(0)
      expect(endedCount()).toBe(0)
      a.fire('ended')
      expect(endedCount()).toBe(1)
      const loads = n.loads
      await g.load(b, 0, { autoplay: true })
      expect(n.loads).toBe(loads)
      expect(a.src).toBe('')
      await g.play()
      expect(n.plays).toBe(1)
      expect(deckGain(n)).toBe(1)
    })

    it('stop() during a fade releases both decks', async () => {
      const { a, n } = await fading()
      g.stop()
      expect(a.src).toBe('')
      expect(n.src).toBe('')
    })
  })
})
