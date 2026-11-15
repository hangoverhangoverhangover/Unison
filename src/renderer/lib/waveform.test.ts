import { describe, expect, it } from 'vitest'
import { bars, clusterMarkers } from './waveform'

describe('waveform bars', () => {
  it('takes the peak of each bucket', () => {
    const out = bars([0.1, 0.9, 0.2, 0.3, 0.8, 0.4], 3)
    expect(out).toHaveLength(3)
    expect(out[0]).toBeGreaterThan(out[1]!)
  })

  it('stretches a loud, compressed track to the full height', () => {
    const loud = Array.from({ length: 200 }, (_, i) => 0.8 + (i % 10) / 50)
    const out = bars(loud, 50)
    expect(Math.min(...out)).toBeLessThan(0.3)
    expect(Math.max(...out)).toBe(1)
  })

  it('handles flat and empty input', () => {
    expect(bars([], 10)).toEqual([])
    expect(bars([0.5, 0.5, 0.5], 3)).toEqual([0.6, 0.6, 0.6])
  })
})

describe('clusterMarkers', () => {
  it('merges comments that would overlap and keeps the first x', () => {
    const items = [{ timestampMs: 60000 }, { timestampMs: 0 }, { timestampMs: 1000 }]
    const out = clusterMarkers(items, 100000, 500, 12)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ x: 0, items: [{ timestampMs: 0 }, { timestampMs: 1000 }] })
    expect(out[1]!.x).toBe(300)
  })

  it('clamps markers inside the width and handles no duration', () => {
    expect(clusterMarkers([{ timestampMs: 200000 }], 100000, 500, 12)[0]!.x).toBe(500)
    expect(clusterMarkers([{ timestampMs: 5 }], 0, 500, 12)).toEqual([])
  })
})
