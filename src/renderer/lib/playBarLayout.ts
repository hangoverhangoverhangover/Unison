import { size } from '@renderer/styles/tokens'

export interface PlayBarLayout {
  /** Inline slider, or an icon that opens a small slider popover. */
  volume: 'slider' | 'popover'
  showArtist: boolean
  /** Elapsed / total labels beside the seek bar. */
  showTimes: boolean
}

/** What fits in the floating play bar at this main-page width. Transport and seek always stay. */
export function playBarLayout(mainWidth: number): PlayBarLayout {
  if (mainWidth >= 640) return { volume: 'slider', showArtist: true, showTimes: true }
  if (mainWidth >= 520) return { volume: 'popover', showArtist: true, showTimes: true }
  return { volume: 'popover', showArtist: false, showTimes: false }
}

/**
 * Bottom padding for every page scroll area: the bar, its inset and the fade above
 * it, so the last row can scroll fully clear of the bar.
 */
export const PAGE_BOTTOM_PAD = size.playBar + size.playBarInset + size.listFade
