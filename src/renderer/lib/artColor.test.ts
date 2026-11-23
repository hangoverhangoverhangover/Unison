import { describe, expect, it } from 'vitest'
import { pickColor } from './artColor'

const px = (...rgb: [number, number, number][]): number[] =>
  rgb.flatMap(([r, g, b]) => [r, g, b, 255])

describe('pickColor', () => {
  it('picks the vivid colour over greys', () => {
    const data = px(
      ...Array(20).fill([120, 120, 120] as [number, number, number]),
      ...Array(5).fill([230, 80, 20] as [number, number, number])
    )
    expect(pickColor(data)).toBe('#e65014')
  })

  it('lifts a dark colour so it shows on a dark page', () => {
    const c = pickColor(px([100, 20, 20], [100, 20, 20]))!
    expect(parseInt(c.slice(1, 3), 16)).toBeGreaterThanOrEqual(199)
  })

  it('gives null for grey or empty pictures', () => {
    expect(pickColor(px([128, 128, 128], [20, 20, 20]))).toBeNull()
    expect(pickColor([])).toBeNull()
  })
})
