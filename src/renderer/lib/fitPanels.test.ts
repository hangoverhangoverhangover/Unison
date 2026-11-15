import { describe, expect, it } from 'vitest'
import { fitPanels } from './fitPanels'

// Widths are the root's content box (its 8 px side padding already excluded).
describe('fitPanels', () => {
  it('keeps both panels when the main page has room', () => {
    expect(fitPanels(1384, 280, 320, true)).toEqual({ sidebar: 280, rightOpen: true })
  })

  it('keeps an opened right panel by folding the sidebar to the rail first', () => {
    // 900 px window: 884 content. 280 + 320 leaves 268 for the main page; the rail leaves 476.
    expect(fitPanels(884, 280, 320, true)).toEqual({ sidebar: 72, rightOpen: true })
  })

  it('opens the right panel at common laptop widths', () => {
    expect(fitPanels(1004, 280, 320, true)).toEqual({ sidebar: 72, rightOpen: true })
  })

  it('closes the right panel only when it does not fit even beside the rail', () => {
    expect(fitPanels(684, 280, 320, true)).toEqual({ sidebar: 72, rightOpen: false })
  })

  it('leaves a wide sidebar alone when it still fits', () => {
    // 884 - 420 sidebar - 8 gap = 456 >= 420
    expect(fitPanels(884, 420, 480, false)).toEqual({ sidebar: 420, rightOpen: false })
  })

  it('keeps the rail as the rail', () => {
    expect(fitPanels(600, 72, 320, false)).toEqual({ sidebar: 72, rightOpen: false })
  })
})
