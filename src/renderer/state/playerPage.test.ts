import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  BUILTIN_PRESETS,
  cleanPresets,
  cleanSwap,
  cleanViz,
  DEFAULT_SWAP,
  DEFAULT_VIZ
} from './playerPage'

describe('cleanViz', () => {
  it('fills in defaults and drops junk', () => {
    expect(cleanViz(null)).toEqual(DEFAULT_VIZ)
    expect(cleanViz({ style: 'laser', color: 'rainbow', customColor: 'red', extra: 1 })).toEqual(
      DEFAULT_VIZ
    )
  })

  it('keeps choices and clamps numbers', () => {
    expect(
      cleanViz({
        style: 'wave',
        bars: 500,
        height: 10,
        sensitivity: 1.7,
        color: 'custom',
        customColor: '#FF8800',
        opacity: 0
      })
    ).toEqual({
      ...DEFAULT_VIZ,
      style: 'wave',
      bars: 128,
      height: 32,
      sensitivity: 1.7,
      color: 'custom',
      customColor: '#FF8800',
      opacity: 0.2,
      systemSound: false
    })
  })

  it('keeps the new options and rejects bad ones', () => {
    const v = cleanViz({
      style: 'shader',
      placement: 'cover',
      fps: 30,
      trails: 5,
      glow: -1,
      beat: true,
      shaderPreset: 'plasma',
      particleCount: 1000,
      customColor2: 'blue'
    })
    expect(v).toMatchObject({
      style: 'shader',
      placement: 'cover',
      fps: 30,
      trails: 0.9,
      glow: 0,
      beat: true,
      shaderPreset: 'liquid',
      particleCount: 400,
      customColor2: DEFAULT_VIZ.customColor2
    })
    expect(cleanViz({ fps: 144, placement: 'sky' })).toMatchObject({ fps: 60, placement: 'bottom' })
  })
})

describe('presets', () => {
  it('apply over the defaults, keeping your colours and the Spotify switch', () => {
    const current = cleanViz({
      color: 'custom',
      customColor: '#123456',
      systemSound: true,
      glow: 0.9,
      bars: 100
    })
    const club = BUILTIN_PRESETS.find((p) => p.name === 'Club')!
    const v = applyPreset(current, club)
    expect(v.style).toBe('radial')
    expect(v.beat).toBe(true)
    expect(v.customColor).toBe('#123456')
    expect(v.systemSound).toBe(true)
    expect(v.bars).toBe(64)
    const retro = applyPreset(
      current,
      BUILTIN_PRESETS.find((p) => p.name === 'Retro')!
    )
    expect(retro.customColor).toBe('#39ff88')
    expect(applyPreset(current, { name: 'x', settings: { systemSound: false } }).systemSound).toBe(
      true
    )
  })

  it('every built-in preset is already clean', () => {
    for (const p of BUILTIN_PRESETS) {
      const v = applyPreset(DEFAULT_VIZ, p)
      expect(cleanViz(v)).toEqual(v)
      for (const [k, val] of Object.entries(p.settings))
        expect(v[k as keyof typeof v], `${p.name}.${k}`).toEqual(val)
    }
  })

  it('cleans saved presets: names, duplicates, no Spotify switch', () => {
    const list = cleanPresets([
      { name: ' Mine ', settings: { style: 'wave', systemSound: true } },
      { name: 'Mine', settings: {} },
      { name: '', settings: {} },
      'junk',
      { name: 'Other', settings: { bars: 9999 } }
    ])
    expect(list.map((p) => p.name)).toEqual(['Mine', 'Other'])
    expect(list[0]!.settings.style).toBe('wave')
    expect('systemSound' in list[0]!.settings).toBe(false)
    expect(list[1]!.settings.bars).toBe(128)
    expect(cleanPresets('nope')).toEqual([])
  })
})

describe('cleanSwap', () => {
  it('defaults to off and keeps numbers in range', () => {
    expect(cleanSwap(undefined)).toEqual(DEFAULT_SWAP)
    expect(cleanSwap({ on: true, imageSeconds: 1, plays: 99 })).toEqual({
      on: true,
      imageSeconds: 3,
      plays: 10
    })
  })
})
