import { describe, expect, it } from 'vitest'
import { PAGE_BOTTOM_PAD, playBarLayout } from './playBarLayout'

describe('playBarLayout', () => {
  it('shows everything on a roomy main page', () => {
    expect(playBarLayout(800)).toEqual({ volume: 'slider', showArtist: true, showTimes: true })
    expect(playBarLayout(640)).toEqual({ volume: 'slider', showArtist: true, showTimes: true })
  })

  it('folds the volume slider into a popover below 640 px', () => {
    expect(playBarLayout(600)).toEqual({ volume: 'popover', showArtist: true, showTimes: true })
    expect(playBarLayout(520)).toEqual({ volume: 'popover', showArtist: true, showTimes: true })
  })

  it('drops the artist line and time labels below 520 px', () => {
    expect(playBarLayout(480)).toEqual({ volume: 'popover', showArtist: false, showTimes: false })
  })
})

describe('PAGE_BOTTOM_PAD', () => {
  it('lets the last row scroll clear of the floating bar and its fade', () => {
    // bar 64 + inset 14 + fade 24
    expect(PAGE_BOTTOM_PAD).toBe(102)
  })
})
