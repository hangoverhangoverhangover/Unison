import { describe, expect, it } from 'vitest'
import { DEFAULT_VIZ } from '@renderer/state/playerPage'
import type { VizFrame } from './types'
import { audioUniforms, coverScale, newAudioUniforms, parseHex, presetIndex } from './shader'

function frame(patch: Partial<VizFrame> = {}): VizFrame {
  return {
    levels: new Float32Array(4),
    peaks: new Float32Array(4),
    bins: new Float32Array(4),
    wave: new Float32Array(4),
    bass: 0.8,
    mid: 0.5,
    treble: 0.2,
    energy: 0.6,
    beat: false,
    pulse: 0.9,
    time: 10,
    dt: 1 / 60,
    playing: true,
    ...patch
  }
}

describe('parseHex', () => {
  it('reads #rrggbb and #rgb', () => {
    expect(parseHex('#ff0000')).toEqual([1, 0, 0])
    expect(parseHex('#00FF80')).toEqual([0, 1, 128 / 255])
    expect(parseHex('#0f0')).toEqual([0, 1, 0])
  })
  it('falls back on junk', () => {
    expect(parseHex('red')).toEqual([1, 1, 1])
    expect(parseHex('#12345', [0, 0, 0])).toEqual([0, 0, 0])
    expect(parseHex('rgb(1,2,3)', [0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5])
  })
})

describe('coverScale', () => {
  it('crops height on a wide canvas', () => {
    const [sx, sy] = coverScale(100, 100, 200, 100)
    expect(sx).toBe(1)
    expect(sy).toBeCloseTo(0.5)
  })
  it('crops width on a tall canvas', () => {
    const [sx, sy] = coverScale(100, 100, 100, 400)
    expect(sx).toBeCloseTo(0.25)
    expect(sy).toBe(1)
  })
  it('shows all of a matching image, and survives zero sizes', () => {
    expect(coverScale(640, 360, 1280, 720)).toEqual([1, 1])
    expect(coverScale(0, 0, 100, 100)).toEqual([1, 1])
  })
})

describe('presetIndex', () => {
  it('maps each preset to its program', () => {
    expect(presetIndex('liquid')).toBe(0)
    expect(presetIndex('kaleidoscope')).toBe(1)
    expect(presetIndex('warp')).toBe(2)
    expect(presetIndex('nope')).toBe(0)
  })
})

describe('audioUniforms', () => {
  it('passes the sound through while playing', () => {
    const u = audioUniforms(frame(), { ...DEFAULT_VIZ, shaderIntensity: 1 }, newAudioUniforms())
    expect(u.bass).toBeCloseTo(0.8)
    expect(u.mid).toBeCloseTo(0.5)
    expect(u.treble).toBeCloseTo(0.2)
    expect(u.energy).toBeCloseTo(0.6)
    expect(u.pulse).toBeCloseTo(0.9)
    expect(u.intensity).toBe(1)
  })
  it('zeroes the sound but keeps a slow clock when paused', () => {
    const playing = audioUniforms(frame(), DEFAULT_VIZ, newAudioUniforms()).speed
    const u = audioUniforms(frame({ playing: false }), DEFAULT_VIZ, newAudioUniforms())
    expect([u.bass, u.mid, u.treble, u.energy, u.pulse]).toEqual([0, 0, 0, 0, 0])
    expect(u.speed).toBeGreaterThan(0)
    expect(u.speed).toBeLessThan(playing)
  })
  it('clamps out-of-range values and reuses the output object', () => {
    const out = newAudioUniforms()
    const u = audioUniforms(
      frame({ bass: 3, pulse: -1, energy: NaN }),
      { ...DEFAULT_VIZ, shaderIntensity: 5 },
      out
    )
    expect(u).toBe(out)
    expect(u.bass).toBe(1)
    expect(u.pulse).toBe(0)
    expect(u.energy).toBe(0)
    expect(u.intensity).toBe(1)
  })
  it('moves slower at low intensity', () => {
    const calm = audioUniforms(frame(), { ...DEFAULT_VIZ, shaderIntensity: 0 }, newAudioUniforms())
    const wild = audioUniforms(frame(), { ...DEFAULT_VIZ, shaderIntensity: 1 }, newAudioUniforms())
    expect(calm.speed).toBeLessThan(wild.speed)
  })
})
