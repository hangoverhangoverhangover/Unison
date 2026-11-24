import { describe, expect, it } from 'vitest'
import { DEFAULT_VIZ, type VizSettings } from '@renderer/state/playerPage'
import type { DrawArgs, VizFrame } from '../types'
import { createParticles } from './particles'
import { createCircle } from './circle'
import { createSpectrogram, parseColor, type SpectroBuffer } from './spectrogram'

interface Call {
  name: string
  args: unknown[]
}

// A stand-in 2D context: records every method call, accepts any property write.
function fakeCtx(calls: Call[] = []): CanvasRenderingContext2D {
  const props: Record<string | symbol, unknown> = { globalAlpha: 1 }
  return new Proxy(props, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'createImageData') {
        return (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4)
        })
      }
      return (...args: unknown[]) => {
        calls.push({ name: String(key), args })
      }
    },
    set(target, key, value) {
      target[key] = value
      return true
    }
  }) as unknown as CanvasRenderingContext2D
}

function makeFrame(over: Partial<VizFrame> = {}): VizFrame {
  const wave = new Float32Array(1024)
  for (let i = 0; i < wave.length; i++) wave[i] = Math.sin(i / 20)
  const bins = new Float32Array(512)
  for (let i = 0; i < bins.length; i++) bins[i] = 1 - i / bins.length
  return {
    levels: new Float32Array(64).fill(0.5),
    peaks: new Float32Array(64).fill(0.6),
    bins,
    wave,
    bass: 0.7,
    mid: 0.5,
    treble: 0.3,
    energy: 0.8,
    beat: false,
    pulse: 0,
    time: 1,
    dt: 1 / 60,
    playing: true,
    ...over
  }
}

function makeArgs(
  ctx: CanvasRenderingContext2D,
  over: { w?: number; h?: number; frame?: VizFrame; settings?: Partial<VizSettings> } = {}
): DrawArgs {
  return {
    ctx,
    w: over.w ?? 800,
    h: over.h ?? 600,
    dpr: 1,
    frame: over.frame ?? makeFrame(),
    settings: { ...DEFAULT_VIZ, ...over.settings },
    colors: { main: '#1db954', second: '#ff4fa3' },
    paint: () => '#1db954'
  }
}

const count = (calls: Call[], name: string): number => calls.filter((c) => c.name === name).length

describe('particles', () => {
  it('never keeps more than particleCount alive, even with beats', () => {
    const p = createParticles()
    for (let f = 0; f < 300; f++) {
      const calls: Call[] = []
      const frame = makeFrame({ beat: f % 10 === 0, energy: 1, dt: 0.05 })
      p.draw(makeArgs(fakeCtx(calls), { frame, settings: { particleCount: 50 } }))
      // Two arcs are the soft centre; the rest are particles.
      expect(count(calls, 'arc')).toBeLessThanOrEqual(50)
    }
  })

  it('emits nothing when paused and lets the rest die out', () => {
    const p = createParticles()
    const ctx = fakeCtx()
    for (let f = 0; f < 30; f++) p.draw(makeArgs(ctx, { frame: makeFrame({ dt: 0.05 }) }))
    let calls: Call[] = []
    for (let f = 0; f < 100; f++) {
      calls = []
      p.draw(makeArgs(fakeCtx(calls), { frame: makeFrame({ playing: false, dt: 0.1 }) }))
    }
    expect(count(calls, 'arc')).toBe(0)
  })

  it('drops extras when the limit is lowered', () => {
    const p = createParticles()
    for (let f = 0; f < 60; f++) {
      p.draw(makeArgs(fakeCtx(), { frame: makeFrame({ beat: true, dt: 0.05 }) }))
    }
    const calls: Call[] = []
    p.draw(makeArgs(fakeCtx(calls), { settings: { particleCount: 20 } }))
    expect(count(calls, 'arc')).toBeLessThanOrEqual(20)
  })
})

describe('circle', () => {
  it('strokes one closed path per ring and restores alpha', () => {
    for (let rings = 1; rings <= 4; rings++) {
      const calls: Call[] = []
      const ctx = fakeCtx(calls)
      ctx.globalAlpha = 0.7
      createCircle().draw(makeArgs(ctx, { settings: { circleRings: rings } }))
      expect(count(calls, 'stroke')).toBe(rings)
      expect(count(calls, 'closePath')).toBe(rings)
      expect(ctx.globalAlpha).toBe(0.7)
    }
  })

  it('copes with an empty wave', () => {
    const frame = makeFrame({ wave: new Float32Array(0) })
    expect(() => createCircle().draw(makeArgs(fakeCtx(), { frame }))).not.toThrow()
  })
})

describe('spectrogram', () => {
  // Buffers made by the fake factory, so the test can see sizes and calls.
  function factory(): {
    made: { w: number; h: number; calls: Call[] }[]
    make: (w: number, h: number) => SpectroBuffer
  } {
    const made: { w: number; h: number; calls: Call[] }[] = []
    return {
      made,
      make: (w, h) => {
        const calls: Call[] = []
        made.push({ w, h, calls })
        const canvas = { width: w, height: h } as unknown as OffscreenCanvas
        return { canvas, ctx: fakeCtx(calls) }
      }
    }
  }

  it('scrolls the history and paints a new column each frame', () => {
    const f = factory()
    const s = createSpectrogram(f.make)
    const calls: Call[] = []
    for (let i = 0; i < 5; i++) s.draw(makeArgs(fakeCtx(calls)))
    expect(f.made).toHaveLength(1)
    const put = f.made[0].calls.filter((c) => c.name === 'putImageData')
    expect(put).toHaveLength(5)
    const img = put[0].args[0] as ImageData
    // spectrogramSpeed 2 at dpr 1: a 2 px column on the right edge.
    expect(img.width).toBe(2)
    expect(put[0].args[1]).toBe(798)
    // Bass is loudest in the fake bins, so the bottom pixel is more opaque than the top.
    const bottom = img.data[(img.height - 1) * img.width * 4 + 3]
    expect(bottom).toBeGreaterThan(img.data[3])
    expect(count(calls, 'drawImage')).toBe(5)
  })

  it('rebuilds the buffer on resize and carries the history over', () => {
    const f = factory()
    const s = createSpectrogram(f.make)
    s.draw(makeArgs(fakeCtx()))
    s.draw(makeArgs(fakeCtx(), { w: 400, h: 300 }))
    expect(f.made.map((m) => [m.w, m.h])).toEqual([
      [800, 600],
      [400, 300]
    ])
    const carried = f.made[1].calls.find((c) => c.name === 'drawImage')
    expect(carried?.args.slice(1)).toEqual([0, 0, 800, 600, 0, 0, 400, 300])
    const put = f.made[1].calls.find((c) => c.name === 'putImageData')
    expect((put?.args[0] as ImageData).height).toBe(300)
  })

  it('handles tiny canvases, no buffer and paused frames without throwing', () => {
    const s = createSpectrogram(factory().make)
    expect(() => s.draw(makeArgs(fakeCtx(), { w: 1, h: 1 }))).not.toThrow()
    expect(() => s.draw(makeArgs(fakeCtx(), { w: 0, h: 0 }))).not.toThrow()
    const f = factory()
    const paused = createSpectrogram(f.make)
    paused.draw(makeArgs(fakeCtx(), { frame: makeFrame({ playing: false }) }))
    expect(f.made[0].calls.some((c) => c.name === 'putImageData')).toBe(false)
    const none = createSpectrogram(() => null)
    expect(() => none.draw(makeArgs(fakeCtx()))).not.toThrow()
  })

  it('reads hex and rgb colours', () => {
    expect(parseColor('#ff8000')).toEqual([255, 128, 0])
    expect(parseColor('#f80')).toEqual([255, 136, 0])
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3])
    expect(parseColor('nonsense')).toEqual([255, 255, 255])
  })
})
