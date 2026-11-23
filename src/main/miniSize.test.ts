import { describe, expect, it } from 'vitest'
import { fitSize, MINI_LIMITS, miniSize } from './miniSize'

describe('fitSize', () => {
  it('uses the default size when nothing was saved', () => {
    expect(fitSize('player', null)).toEqual(miniSize('player'))
    expect(fitSize('lyrics', 'junk')).toEqual(miniSize('lyrics'))
  })

  it('keeps a dragged size inside the layout limits', () => {
    expect(fitSize('player', { width: 500, height: 150 })).toEqual({ width: 500, height: 150 })
    expect(fitSize('player', { width: 10, height: 9999 })).toEqual({
      width: MINI_LIMITS.player.min.width,
      height: MINI_LIMITS.player.max.height
    })
    expect(fitSize('lyrics', { width: 900.6, height: 'x' })).toEqual({
      width: 901,
      height: miniSize('lyrics').height
    })
  })
})
