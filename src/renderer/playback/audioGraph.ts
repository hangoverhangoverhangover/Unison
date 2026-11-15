// Web Audio graph for the audio-element backend: per-deck gain (crossfade) -> mix ->
// levelling gain -> [compressor while levelling] -> 10-band EQ -> master (volume) -> out.
//
//   deck A el -> MediaElementSource -> deck gain --\
//   deck B el -> MediaElementSource -> deck gain ---+-> mix -> level -> (comp) -> eq x10 -> master -> destination
//                                                   mix -> analyser (levelling meter tap)
//
// DRM (EME) media must never be connected here: a protected element routed through a
// MediaElementAudioSourceNode plays silence, and a connected element can't be detached.
// The backend keeps those on a separate plain element.

import { EQ_BANDS_HZ, type AudioSettings } from '@shared/playback'

/** The parts of AudioContext the graph uses (tests pass a fake). */
export type AudioContextLike = Pick<
  AudioContext,
  | 'createGain'
  | 'createBiquadFilter'
  | 'createDynamicsCompressor'
  | 'createAnalyser'
  | 'createMediaElementSource'
  | 'destination'
  | 'currentTime'
  | 'state'
  | 'resume'
>

/** Real-time loudness levelling. */
export const LEVELLING = {
  /** Target RMS, dBFS. */
  targetDb: -16,
  minGainDb: -9,
  maxGainDb: 6,
  /** Readings below this are near-silence and ignored. */
  silenceDb: -50,
  intervalMs: 250,
  /** Moving window: 32 x 250 ms = 8 s. */
  windowSamples: 32,
  /** No correction until this many readings (1 s) are in. */
  minSamples: 4,
  /** setTargetAtTime time constant for the level gain, seconds. */
  timeConstantS: 2,
  fftSize: 8192
} as const

export const COMPRESSOR = {
  threshold: -14,
  ratio: 3,
  knee: 6,
  attack: 0.01,
  release: 0.25
} as const

export const EQ_Q = 1.1
/** Smoothing for volume/EQ changes, seconds. */
const SMOOTH_S = 0.015

export const dbToGain = (db: number): number => Math.pow(10, db / 20)

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** RMS of a block of samples, in dBFS (-Infinity for digital silence). */
export function rmsDbfs(samples: ArrayLike<number>): number {
  if (samples.length === 0) return Number.NEGATIVE_INFINITY
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0
    sum += s * s
  }
  const rms = Math.sqrt(sum / samples.length)
  return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY
}

export interface LevelMeter {
  /** Add one RMS reading (dBFS). Near-silence is ignored. */
  push(db: number): void
  /** Forget the estimate (new track): gain goes back to 0 dB. */
  reset(): void
  /** Correction to apply, dB: clamp(target - measured), 0 until enough readings. */
  gainDb(): number
  /** Moving-average loudness, dBFS, or null with too few readings. */
  measuredDb(): number | null
}

export function createLevelMeter(): LevelMeter {
  let powers: number[] = []
  const measuredDb = (): number | null => {
    if (powers.length < LEVELLING.minSamples) return null
    const mean = powers.reduce((a, p) => a + p, 0) / powers.length
    return 10 * Math.log10(mean)
  }
  return {
    push(db) {
      if (!Number.isFinite(db) || db < LEVELLING.silenceDb) return
      powers.push(Math.pow(10, db / 10))
      if (powers.length > LEVELLING.windowSamples) powers = powers.slice(-LEVELLING.windowSamples)
    },
    reset() {
      powers = []
    },
    measuredDb,
    gainDb() {
      const m = measuredDb()
      if (m === null) return 0
      return clamp(LEVELLING.targetDb - m, LEVELLING.minGainDb, LEVELLING.maxGainDb)
    }
  }
}

/** Clamp and fill settings from IPC or the Settings UI. */
export function sanitizeAudioSettings(s: Partial<AudioSettings> | null | undefined): AudioSettings {
  const gains = EQ_BANDS_HZ.map((_, i) => {
    const g = Number(s?.eq?.gains?.[i])
    return Number.isFinite(g) ? clamp(g, -12, 12) : 0
  })
  const xf = Number(s?.crossfadeMs)
  return {
    levelling: s?.levelling === true,
    crossfadeMs: Number.isFinite(xf) ? clamp(Math.round(xf), 0, 12_000) : 0,
    eq: { enabled: s?.eq?.enabled === true, gains }
  }
}

/** Equal-power fade curve, 0..1 (in) or 1..0 (out). */
export function equalPowerCurve(direction: 'in' | 'out', points = 64): Float32Array {
  const c = new Float32Array(points)
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1)
    c[i] = direction === 'in' ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2)
  }
  return c
}

/** One element's way into the graph. */
export interface DeckChannel {
  /** Go to a gain, cancelling any fade: with a few ms of smoothing, or at once. */
  setGain(value: number, smooth?: boolean): void
  /** Equal-power fade over `ms` from the current position of the curve. */
  fade(direction: 'in' | 'out', ms: number): void
}

export interface AudioGraph {
  /** Route an element through the graph. Permanent: the element can't be detached. */
  connect(el: HTMLMediaElement): DeckChannel
  /** Resume a suspended context (call on play). Never throws. */
  resume(): void
  /** Master volume (wired elements stay at volume 1). */
  setVolume(volume: number, muted: boolean): void
  apply(settings: AudioSettings): void
  /** New track: restart the loudness estimate at 0 dB. */
  resetLevelling(): void
  /** Current level-meter state (tests, debugging). */
  readonly meter: LevelMeter
  /** Stop the levelling timer. */
  dispose(): void
}

export function createAudioGraph(ctx: AudioContextLike): AudioGraph {
  const mix = ctx.createGain()
  const level = ctx.createGain()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = COMPRESSOR.threshold
  comp.ratio.value = COMPRESSOR.ratio
  comp.knee.value = COMPRESSOR.knee
  comp.attack.value = COMPRESSOR.attack
  comp.release.value = COMPRESSOR.release
  const eq = EQ_BANDS_HZ.map((hz, i) => {
    const f = ctx.createBiquadFilter()
    f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS_HZ.length - 1 ? 'highshelf' : 'peaking'
    f.frequency.value = hz
    if (f.type === 'peaking') f.Q.value = EQ_Q
    f.gain.value = 0
    return f
  })
  const master = ctx.createGain()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = LEVELLING.fftSize
  const buf = new Float32Array(analyser.fftSize)

  mix.connect(level)
  mix.connect(analyser)
  level.connect(eq[0] as BiquadFilterNode)
  for (let i = 0; i < eq.length - 1; i++) {
    ;(eq[i] as BiquadFilterNode).connect(eq[i + 1] as BiquadFilterNode)
  }
  ;(eq[eq.length - 1] as BiquadFilterNode).connect(master)
  master.connect(ctx.destination)

  const meter = createLevelMeter()
  let levelling = false
  let timer: ReturnType<typeof setInterval> | null = null

  const target = (p: AudioParam, v: number, tc = SMOOTH_S): void => {
    p.cancelScheduledValues(ctx.currentTime)
    p.setTargetAtTime(v, ctx.currentTime, tc)
  }

  const tick = (): void => {
    analyser.getFloatTimeDomainData(buf)
    meter.push(rmsDbfs(buf))
    target(level.gain, dbToGain(meter.gainDb()), LEVELLING.timeConstantS)
  }

  const setLevelling = (on: boolean): void => {
    if (on === levelling) return
    levelling = on
    level.disconnect()
    if (on) {
      level.connect(comp)
      comp.connect(eq[0] as BiquadFilterNode)
      meter.reset()
      level.gain.cancelScheduledValues(ctx.currentTime)
      level.gain.setValueAtTime(1, ctx.currentTime)
      timer = setInterval(tick, LEVELLING.intervalMs)
    } else {
      if (timer !== null) clearInterval(timer)
      timer = null
      comp.disconnect()
      level.connect(eq[0] as BiquadFilterNode)
      target(level.gain, 1, 0.1)
    }
  }

  return {
    meter,
    connect(el) {
      const source = ctx.createMediaElementSource(el)
      const gain = ctx.createGain()
      source.connect(gain)
      gain.connect(mix)
      return {
        setGain(v, smooth = true) {
          if (smooth) {
            target(gain.gain, v, 0.01)
            return
          }
          gain.gain.cancelScheduledValues(ctx.currentTime)
          gain.gain.setValueAtTime(v, ctx.currentTime)
        },
        fade(direction, ms) {
          const p = gain.gain
          const t = ctx.currentTime
          p.cancelScheduledValues(t)
          p.setValueCurveAtTime(equalPowerCurve(direction), t, Math.max(0.05, ms / 1000))
        }
      }
    },
    resume() {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => undefined)
      }
    },
    setVolume(volume, muted) {
      target(master.gain, muted ? 0 : volume)
    },
    apply(s) {
      eq.forEach((f, i) => target(f.gain, s.eq.enabled ? (s.eq.gains[i] ?? 0) : 0))
      setLevelling(s.levelling)
    },
    resetLevelling() {
      meter.reset()
      if (levelling) target(level.gain, 1, 0.3)
    },
    dispose() {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
  }
}
