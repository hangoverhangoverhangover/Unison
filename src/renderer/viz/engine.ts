// Turns raw analyser bytes into a VizFrame: bars on a log or linear scale, easing,
// falling peak caps, band energies and beats. Pure (no DOM, no Web Audio), so it's
// tested on its own; the Player page feeds it from the audio graph or the PC's sound.
import type { VizSettings } from '@renderer/state/playerPage'
import type { VizFrame } from './types'

/** Lowest and highest frequency the bars cover. */
export const LOW_HZ = 30
export const HIGH_HZ = 16000

export interface EngineInput {
  /** Frequency bytes (0-255), low to high; null when nothing can be read. */
  spectrum: Uint8Array | null
  /** Waveform bytes (128 = silence); null when nothing can be read. */
  wave: Uint8Array | null
  sampleRate: number
  settings: VizSettings
  /** ms, e.g. performance.now(). */
  now: number
  /** False while paused: levels fall to 0. */
  playing: boolean
}

/**
 * For bar i of n, the spectrum bin range [from, to) it reads. Log: each bar spans the
 * same number of octaves, so bass gets more bars. Linear: the same number of Hz.
 */
export function barRanges(
  n: number,
  bins: number,
  sampleRate: number,
  log: boolean
): Int32Array<ArrayBuffer> {
  const hzPerBin = sampleRate / 2 / bins
  const top = Math.min(HIGH_HZ, sampleRate / 2)
  const out = new Int32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const f0 = log ? LOW_HZ * (top / LOW_HZ) ** (i / n) : LOW_HZ + ((top - LOW_HZ) * i) / n
    const f1 = log
      ? LOW_HZ * (top / LOW_HZ) ** ((i + 1) / n)
      : LOW_HZ + ((top - LOW_HZ) * (i + 1)) / n
    const from = Math.min(bins - 1, Math.floor(f0 / hzPerBin))
    const to = Math.min(bins, Math.max(from + 1, Math.ceil(f1 / hzPerBin)))
    out[i * 2] = from
    out[i * 2 + 1] = to
  }
  return out
}

export interface BeatDetector {
  /** Feed the bass level (0..1) each frame; true when a beat lands. */
  step(bass: number, time: number, dt: number, sensitivity: number): boolean
}

/**
 * A beat is the bass jumping well above its recent average (about the last second),
 * rising, loud enough to matter, and at least a quarter second after the last one.
 */
export function createBeatDetector(): BeatDetector {
  let avg = 0
  let prev = 0
  let last = -Infinity
  return {
    step(bass, time, dt, sensitivity) {
      const ratio = 1 + 0.45 / Math.max(0.25, sensitivity)
      const hit = bass > avg * ratio && bass > prev && bass > 0.08 && time - last > 0.25
      avg += (bass - avg) * Math.min(1, dt / 0.9)
      prev = bass
      if (hit) last = time
      return hit
    }
  }
}

export interface VizEngine {
  step(input: EngineInput): VizFrame
}

export function createVizEngine(): VizEngine {
  let frame: VizFrame = {
    levels: new Float32Array(0),
    peaks: new Float32Array(0),
    bins: new Float32Array(0),
    wave: new Float32Array(0),
    bass: 0,
    mid: 0,
    treble: 0,
    energy: 0,
    beat: false,
    pulse: 0,
    time: 0,
    dt: 0,
    playing: false
  }
  let start = -1
  let lastNow = -1
  let ranges: Int32Array<ArrayBuffer> = new Int32Array(0)
  let rangeKey = ''
  const beats = createBeatDetector()

  // Mean of the bytes between two frequencies, 0..1.
  const band = (data: Uint8Array, hzPerBin: number, lo: number, hi: number): number => {
    const from = Math.max(0, Math.floor(lo / hzPerBin))
    const to = Math.min(data.length, Math.max(from + 1, Math.ceil(hi / hzPerBin)))
    let sum = 0
    for (let i = from; i < to; i++) sum += data[i]!
    return sum / (to - from) / 255
  }

  return {
    step({ spectrum, wave, sampleRate, settings: s, now, playing }) {
      if (start < 0) start = now
      const dt = lastNow < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, (now - lastNow) / 1000))
      lastNow = now
      const time = (now - start) / 1000
      const live = playing && !!spectrum

      const n = s.bars
      const binCount = spectrum?.length ?? frame.bins.length
      if (frame.levels.length !== n) {
        frame.levels = new Float32Array(n)
        frame.peaks = new Float32Array(n)
      }
      if (frame.bins.length !== binCount) frame.bins = new Float32Array(binCount)
      const waveCount = wave?.length ?? frame.wave.length
      if (frame.wave.length !== waveCount) frame.wave = new Float32Array(waveCount)
      const key = `${n}|${binCount}|${sampleRate}|${s.logScale}`
      if (key !== rangeKey && binCount > 0) {
        ranges = barRanges(n, binCount, sampleRate, s.logScale)
        rangeKey = key
      }

      // Bands and beats from the raw bytes.
      const hzPerBin = sampleRate / 2 / Math.max(1, binCount)
      const bassNow = live ? band(spectrum, hzPerBin, 20, 150) : 0
      const midNow = live ? band(spectrum, hzPerBin, 150, 2000) : 0
      const trebleNow = live ? band(spectrum, hzPerBin, 2000, 12000) : 0
      const ease = (prev: number, next: number): number =>
        prev + (next - prev) * Math.min(1, dt * (next > prev ? 18 : 6))
      const bass = ease(frame.bass, Math.min(1, bassNow * s.sensitivity))
      const mid = ease(frame.mid, Math.min(1, midNow * s.sensitivity))
      const treble = ease(frame.treble, Math.min(1, trebleNow * s.sensitivity))
      // The analyser's bytes are decibels, which squash kicks; cubing spreads them out again.
      const beat = s.beat && live && beats.step(bassNow ** 3, time, dt, s.beatSensitivity)
      const pulse = !s.beat ? 0 : beat ? 1 : frame.pulse * Math.exp(-dt * 9)

      // The whole spectrum, 0..1.
      for (let i = 0; i < binCount; i++) {
        frame.bins[i] = live ? Math.min(1, (spectrum[i]! / 255) * s.sensitivity) : 0
      }
      for (let i = 0; i < waveCount; i++) {
        frame.wave[i] = live && wave ? (wave[i]! - 128) / 128 : 0
      }

      // Bars: rise quickly, fall at a speed set by "smoothing".
      const fall = 1.2 + (1 - s.smoothing) * 7
      const kick = s.beatKick ? 1 + pulse * 0.35 : 1
      let energy = 0
      for (let i = 0; i < n; i++) {
        let target = 0
        if (live && ranges.length) {
          let max = 0
          for (let b = ranges[i * 2]!; b < ranges[i * 2 + 1]!; b++)
            max = Math.max(max, spectrum[b]!)
          target = Math.min(1, (max / 255) * s.sensitivity * kick)
        }
        const prev = frame.levels[i]!
        const lv =
          target >= prev
            ? prev + (target - prev) * Math.min(1, dt * 30)
            : Math.max(target, prev - fall * dt)
        frame.levels[i] = lv
        frame.peaks[i] = Math.max(lv, frame.peaks[i]! - s.peakFall * dt)
        energy += lv
      }

      frame = {
        ...frame,
        bass,
        mid,
        treble,
        energy: n ? energy / n : 0,
        beat,
        pulse,
        time,
        dt,
        playing: live
      }
      return frame
    }
  }
}
