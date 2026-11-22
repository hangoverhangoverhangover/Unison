import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AUDIO, EQ_BANDS_HZ, type AudioSettings } from '@shared/playback'
import {
  COMPRESSOR,
  createAudioGraph,
  createLevelMeter,
  dbToGain,
  equalPowerCurve,
  EQ_Q,
  LEVELLING,
  rmsDbfs,
  sanitizeAudioSettings
} from './audioGraph'
import { FakeAudioContext, type FakeGain, type FakeNode } from './webAudioFakes'

const settings = (over: Partial<AudioSettings> = {}): AudioSettings => ({
  ...DEFAULT_AUDIO,
  eq: { ...DEFAULT_AUDIO.eq },
  ...over
})

describe('rmsDbfs', () => {
  it('measures constant and empty blocks', () => {
    expect(rmsDbfs(new Float32Array(16).fill(0.1))).toBeCloseTo(-20, 5)
    expect(rmsDbfs(new Float32Array(16).fill(-1))).toBeCloseTo(0, 5)
    expect(rmsDbfs(new Float32Array(16))).toBe(Number.NEGATIVE_INFINITY)
    expect(rmsDbfs([])).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('level meter', () => {
  it('waits for enough readings, then corrects toward the target', () => {
    const m = createLevelMeter()
    for (let i = 0; i < LEVELLING.minSamples - 1; i++) m.push(-20)
    expect(m.gainDb()).toBe(0)
    m.push(-20)
    expect(m.measuredDb()).toBeCloseTo(-20, 5)
    expect(m.gainDb()).toBeCloseTo(4, 5)
  })

  it('clamps boost to +6 dB and cut to -9 dB', () => {
    const quiet = createLevelMeter()
    for (let i = 0; i < 8; i++) quiet.push(-40)
    expect(quiet.gainDb()).toBe(LEVELLING.maxGainDb)
    const loud = createLevelMeter()
    for (let i = 0; i < 8; i++) loud.push(-2)
    expect(loud.gainDb()).toBe(LEVELLING.minGainDb)
  })

  it('ignores near-silence and non-finite readings', () => {
    const m = createLevelMeter()
    for (let i = 0; i < 8; i++) m.push(-18)
    for (let i = 0; i < 20; i++) m.push(-60)
    m.push(Number.NEGATIVE_INFINITY)
    expect(m.measuredDb()).toBeCloseTo(-18, 5)
    expect(m.gainDb()).toBeCloseTo(2, 5)
  })

  it('keeps a moving window of 8 s and resets per track', () => {
    const m = createLevelMeter()
    for (let i = 0; i < LEVELLING.windowSamples; i++) m.push(-30)
    for (let i = 0; i < LEVELLING.windowSamples; i++) m.push(-14)
    expect(m.measuredDb()).toBeCloseTo(-14, 5)
    m.reset()
    expect(m.measuredDb()).toBeNull()
    expect(m.gainDb()).toBe(0)
  })

  it('averages power, not dB', () => {
    const m = createLevelMeter()
    m.push(-10)
    m.push(-10)
    m.push(-40)
    m.push(-40)
    // mean power of 0.1 and 0.0001 -> about -13 dB
    expect(m.measuredDb()).toBeCloseTo(10 * Math.log10((0.1 + 0.0001) / 2), 5)
  })
})

describe('sanitizeAudioSettings', () => {
  it('clamps and fills', () => {
    expect(sanitizeAudioSettings(null)).toEqual(DEFAULT_AUDIO)
    const s = sanitizeAudioSettings({
      levelling: true,
      crossfadeMs: 99_999,
      eq: { enabled: true, gains: [20, -20, Number.NaN, 3] }
    })
    expect(s.levelling).toBe(true)
    expect(s.crossfadeMs).toBe(12_000)
    expect(s.eq.gains).toEqual([12, -12, 0, 3, 0, 0, 0, 0, 0, 0])
    expect(sanitizeAudioSettings({ crossfadeMs: -5 }).crossfadeMs).toBe(0)
  })
})

describe('equalPowerCurve', () => {
  it('runs 0..1 (in) and 1..0 (out) with constant power', () => {
    const i = equalPowerCurve('in')
    const o = equalPowerCurve('out')
    expect(i[0]).toBeCloseTo(0, 6)
    expect(i[i.length - 1]).toBeCloseTo(1, 6)
    expect(o[0]).toBeCloseTo(1, 6)
    expect(o[o.length - 1]).toBeCloseTo(0, 6)
    for (let k = 0; k < i.length; k++) {
      expect((i[k] ?? 0) ** 2 + (o[k] ?? 0) ** 2).toBeCloseTo(1, 5)
    }
  })
})

describe('audio graph', () => {
  let ctx: FakeAudioContext
  beforeEach(() => {
    vi.useFakeTimers()
    ctx = new FakeAudioContext()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** mix, level, master are the first three gains created. */
  const nodes = (): { mix: FakeGain; level: FakeGain; master: FakeGain } => {
    const [mix, level, master] = ctx.gains
    if (!mix || !level || !master) throw new Error('graph not built')
    return { mix, level, master }
  }

  it('wires mix -> level -> 10 filters -> master -> destination, with an analyser tap', () => {
    createAudioGraph(ctx.asContext())
    const { mix, level, master } = nodes()
    const f = ctx.filters
    expect(f.map((x) => x.frequency.value)).toEqual([...EQ_BANDS_HZ])
    expect(f[0]?.type).toBe('lowshelf')
    expect(f[9]?.type).toBe('highshelf')
    expect(f.slice(1, 9).every((x) => x.type === 'peaking' && x.Q.value === EQ_Q)).toBe(true)
    expect(f.every((x) => x.gain.value === 0)).toBe(true)
    // Second analyser: the Player page's level bars (QoL 4).
    expect(mix.out).toEqual([level, ctx.analysers[0], ctx.analysers[1]])
    expect(ctx.analysers[1]?.fftSize).toBe(256)
    expect(level.out).toEqual([f[0]])
    for (let i = 0; i < 9; i++) expect(f[i]?.out).toEqual([f[i + 1]])
    expect(f[9]?.out).toEqual([master])
    expect(master.out).toEqual([ctx.destination])
    const c = ctx.compressors[0]
    expect(c?.threshold.value).toBe(COMPRESSOR.threshold)
    expect(c?.ratio.value).toBe(COMPRESSOR.ratio)
    expect(c?.knee.value).toBe(COMPRESSOR.knee)
  })

  it('connects an element as source -> deck gain -> mix, and fades it', () => {
    const g = createAudioGraph(ctx.asContext())
    const el = {}
    const ch = g.connect(el as HTMLMediaElement)
    const src = ctx.sources[0]
    const deckGain = src?.out[0] as FakeGain
    expect(src?.element).toBe(el)
    expect(deckGain.out).toEqual([nodes().mix])
    ch.fade('out', 4000)
    expect(deckGain.gain.curves[0]?.durationS).toBe(4)
    expect(deckGain.gain.value).toBeCloseTo(0, 6)
    ch.setGain(1, false)
    expect(deckGain.gain.value).toBe(1)
  })

  it('applies EQ gains when enabled and flattens when disabled', () => {
    const g = createAudioGraph(ctx.asContext())
    const gains = [3, -2, 0, 1, 0, 0, 0, 0, 4, -6]
    g.apply(settings({ eq: { enabled: true, gains } }))
    expect(ctx.filters.map((f) => f.gain.value)).toEqual(gains)
    g.apply(settings({ eq: { enabled: false, gains } }))
    expect(ctx.filters.every((f) => f.gain.value === 0)).toBe(true)
  })

  it('sets the master from volume and mute', () => {
    const g = createAudioGraph(ctx.asContext())
    g.setVolume(0.4, false)
    expect(nodes().master.gain.value).toBe(0.4)
    g.setVolume(0.4, true)
    expect(nodes().master.gain.value).toBe(0)
  })

  it('levelling: compressor in, gain follows the meter with a slow time constant, off restores', () => {
    const g = createAudioGraph(ctx.asContext())
    const { level } = nodes()
    const comp = ctx.compressors[0] as FakeNode
    const f0 = ctx.filters[0]
    const analyser = ctx.analysers[0]
    if (!analyser) throw new Error('no analyser')
    g.apply(settings({ levelling: true }))
    expect(level.out).toEqual([comp])
    expect(comp.out).toEqual([f0])
    analyser.amplitude = 0.05 // -26 dBFS
    vi.advanceTimersByTime(LEVELLING.intervalMs * (LEVELLING.minSamples - 1))
    expect(level.gain.value).toBe(1)
    vi.advanceTimersByTime(LEVELLING.intervalMs)
    expect(level.gain.value).toBeCloseTo(dbToGain(6), 6) // +10 wanted, clamped at +6
    expect(level.gain.targets.at(-1)?.timeConstant).toBe(LEVELLING.timeConstantS)
    // Silence leaves the estimate alone.
    analyser.amplitude = 0
    vi.advanceTimersByTime(LEVELLING.intervalMs * 10)
    expect(level.gain.value).toBeCloseTo(dbToGain(6), 6)
    // New track: back to 0 dB.
    g.resetLevelling()
    expect(level.gain.value).toBe(1)
    expect(g.meter.measuredDb()).toBeNull()
    analyser.amplitude = 0.25 // about -12 dBFS
    vi.advanceTimersByTime(LEVELLING.intervalMs * LEVELLING.minSamples)
    expect(level.gain.value).toBeCloseTo(dbToGain(-16 - 20 * Math.log10(0.25)), 6)
    g.apply(settings({ levelling: false }))
    expect(level.out).toEqual([f0])
    expect(level.gain.value).toBe(1)
    const before = level.gain.targets.length
    vi.advanceTimersByTime(LEVELLING.intervalMs * 8)
    expect(level.gain.targets.length).toBe(before) // timer stopped
  })

  it('resume() only resumes a suspended context', () => {
    const g = createAudioGraph(ctx.asContext())
    g.resume()
    expect(ctx.resumes).toBe(0)
    ctx.state = 'suspended'
    g.resume()
    expect(ctx.resumes).toBe(1)
  })
})
