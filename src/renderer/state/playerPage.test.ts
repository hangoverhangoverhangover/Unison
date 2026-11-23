import { describe, expect, it } from 'vitest'
import { cleanViz, DEFAULT_VIZ } from './playerPage'

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
      style: 'wave',
      bars: 128,
      height: 32,
      sensitivity: 1.7,
      color: 'custom',
      customColor: '#FF8800',
      opacity: 0.2
    })
  })
})
