import { describe, expect, it } from 'vitest'
import { pickColor, pickColors, shiftHue } from './artColor'

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

describe('pickColors and shiftHue', () => {
  it('finds a second colour far from the first', () => {
    const px: number[] = []
    for (let i = 0; i < 60; i++) px.push(230, 30, 30, 255)
    for (let i = 0; i < 30; i++) px.push(40, 60, 230, 255)
    for (let i = 0; i < 20; i++) px.push(230, 90, 30, 255)
    const [a, b] = pickColors(px)
    expect(a).toMatch(/^#e/)
    expect(b).not.toBeNull()
    expect(parseInt(b!.slice(5, 7), 16)).toBeGreaterThan(200)
  })

  it('returns nulls for a grey picture', () => {
    expect(pickColors([128, 128, 128, 255, 10, 10, 10, 255])).toEqual([null, null])
  })

  it('turns a colour around the wheel', () => {
    expect(shiftHue('#ff0000', 120)).toBe('#00ff00')
    expect(shiftHue('#ff0000', 240)).toBe('#0000ff')
    expect(shiftHue('#808080', 90)).toBe('#808080')
    expect(shiftHue('nope', 30)).toBe('nope')
  })
})
