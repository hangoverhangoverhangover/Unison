import { describe, expect, it } from 'vitest'
import { DEFAULT_VIZ, type VizSettings } from '@renderer/state/playerPage'
import { barRanges, createBeatDetector, createVizEngine } from './engine'

const BINS = 512
const RATE = 48000

function spectrumWith(fill: (hz: number) => number): Uint8Array {
  const s = new Uint8Array(BINS)
  for (let i = 0; i < BINS; i++) s[i] = fill((i * RATE) / 2 / BINS)
  return s
}

describe('barRanges', () => {
  it('gives bass more bars on the log scale than on the linear one', () => {
    const below = (r: Int32Array, hz: number): number => {
      let n = 0
      for (let i = 0; i < r.length / 2; i++) if ((r[i * 2]! * RATE) / 2 / BINS < hz) n++
      return n
    }
    const log = barRanges(64, BINS, RATE, true)
    const lin = barRanges(64, BINS, RATE, false)
    expect(below(log, 250)).toBeGreaterThan(10)
    expect(below(lin, 250)).toBeLessThan(3)
  })

  it('keeps every range inside the spectrum and non-empty', () => {
    for (const log of [true, false]) {
      const r = barRanges(128, BINS, RATE, log)
      for (let i = 0; i < 128; i++) {
        expect(r[i * 2]!).toBeGreaterThanOrEqual(0)
        expect(r[i * 2 + 1]!).toBeGreaterThan(r[i * 2]!)
        expect(r[i * 2 + 1]!).toBeLessThanOrEqual(BINS)
      }
    }
  })
})

describe('beat detector', () => {
  it('fires on kicks above the recent average, not on a steady level', () => {
    const d = createBeatDetector()
    let t = 0
    let beats = 0
    // Steady bass for 2 s: no beats after the first settling.
    for (let i = 0; i < 120; i++, t += 1 / 60) d.step(0.3, t, 1 / 60, 1)
    for (let i = 0; i < 60; i++, t += 1 / 60) if (d.step(0.3, t, 1 / 60, 1)) beats++
    expect(beats).toBe(0)
    // Kicks every half second.
    for (let i = 0; i < 240; i++, t += 1 / 60) {
      const kick = i % 30 < 3 ? 0.9 : 0.3
      if (d.step(kick, t, 1 / 60, 1)) beats++
    }
    expect(beats).toBeGreaterThanOrEqual(6)
    expect(beats).toBeLessThanOrEqual(8)
  })
})

describe('viz engine', () => {
  const settings = (patch: Partial<VizSettings> = {}): VizSettings => ({
    ...DEFAULT_VIZ,
    ...patch
  })

  it('fills levels, bands and the wave from the bytes', () => {
    const e = createVizEngine()
    const spectrum = spectrumWith((hz) => (hz < 150 ? 255 : 0))
    const wave = new Uint8Array(1024).fill(192)
    let f = e.step({
      spectrum,
      wave,
      sampleRate: RATE,
      settings: settings(),
      now: 0,
      playing: true
    })
    for (let i = 1; i < 30; i++)
      f = e.step({
        spectrum,
        wave,
        sampleRate: RATE,
        settings: settings(),
        now: i * 16,
        playing: true
      })
    expect(f.levels.length).toBe(64)
    expect(f.levels[0]!).toBeGreaterThan(0.9)
    expect(f.levels[63]!).toBe(0)
    expect(f.bass).toBeGreaterThan(0.8)
    expect(f.treble).toBeLessThan(0.05)
    expect(f.wave[0]!).toBeCloseTo(0.5)
    expect(f.playing).toBe(true)
  })

  it('lets levels fall while caps fall slower, and stops when paused', () => {
    const e = createVizEngine()
    const loud = spectrumWith(() => 255)
    const s = settings({ peakFall: 0.5, smoothing: 0.5 })
    for (let i = 0; i < 10; i++)
      e.step({
        spectrum: loud,
        wave: null,
        sampleRate: RATE,
        settings: s,
        now: i * 16,
        playing: true
      })
    let f = e.step({
      spectrum: loud,
      wave: null,
      sampleRate: RATE,
      settings: s,
      now: 176,
      playing: false
    })
    for (let i = 0; i < 8; i++)
      f = e.step({
        spectrum: loud,
        wave: null,
        sampleRate: RATE,
        settings: s,
        now: 192 + i * 16,
        playing: false
      })
    expect(f.playing).toBe(false)
    expect(f.peaks[5]!).toBeGreaterThan(f.levels[5]!)
    for (let i = 0; i < 60; i++)
      f = e.step({
        spectrum: loud,
        wave: null,
        sampleRate: RATE,
        settings: s,
        now: 400 + i * 16,
        playing: false
      })
    expect(f.levels[5]!).toBe(0)
    expect(f.bass).toBeLessThan(0.05)
  })

  it('has no pulse with beat detection off, and a decaying one with it on', () => {
    const run = (beat: boolean): number[] => {
      const e = createVizEngine()
      const quiet = spectrumWith(() => 60)
      const kick = spectrumWith((hz) => (hz < 150 ? 250 : 60))
      const pulses: number[] = []
      for (let i = 0; i < 120; i++) {
        const f = e.step({
          spectrum: i % 30 === 0 && i > 40 ? kick : quiet,
          wave: null,
          sampleRate: RATE,
          settings: settings({ beat }),
          now: i * 16,
          playing: true
        })
        pulses.push(f.pulse)
      }
      return pulses
    }
    expect(Math.max(...run(false))).toBe(0)
    const on = run(true)
    expect(Math.max(...on)).toBe(1)
    const hit = on.indexOf(1)
    expect(on[hit + 10]!).toBeLessThan(0.3)
  })

  it('resizes its arrays when the bar count changes', () => {
    const e = createVizEngine()
    const spectrum = spectrumWith(() => 100)
    e.step({ spectrum, wave: null, sampleRate: RATE, settings: settings(), now: 0, playing: true })
    const f = e.step({
      spectrum,
      wave: null,
      sampleRate: RATE,
      settings: settings({ bars: 16 }),
      now: 16,
      playing: true
    })
    expect(f.levels.length).toBe(16)
    expect(f.peaks.length).toBe(16)
  })
})
