// Mini player sizes (pure, no Electron): the default per layout and the drag limits.
import type { MiniLayout } from '@shared/config'

export const MINI_WIDTH = 380
export const MINI_HEIGHT = 112
/** The lyric-bar layout (QoL 4): wider and shorter. */
export const MINI_LYRICS_WIDTH = 480
export const MINI_LYRICS_HEIGHT = 76

export function miniSize(layout: MiniLayout | undefined): { width: number; height: number } {
  return layout === 'lyrics'
    ? { width: MINI_LYRICS_WIDTH, height: MINI_LYRICS_HEIGHT }
    : { width: MINI_WIDTH, height: MINI_HEIGHT }
}
/** How small and large you can drag each layout (QoL 4: the mini player resizes). */
export const MINI_LIMITS: Record<
  MiniLayout,
  { min: { width: number; height: number }; max: { width: number; height: number } }
> = {
  player: { min: { width: 300, height: 96 }, max: { width: 800, height: 260 } },
  lyrics: { min: { width: 280, height: 48 }, max: { width: 1600, height: 240 } }
}

/** A saved size, kept inside the layout's limits; the default size when there's none. */
export function fitSize(
  layout: MiniLayout | undefined,
  saved: unknown
): {
  width: number
  height: number
} {
  const l: MiniLayout = layout === 'lyrics' ? 'lyrics' : 'player'
  const def = miniSize(l)
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  const { min, max } = MINI_LIMITS[l]
  const pick = (v: unknown, lo: number, hi: number, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d
  return {
    width: pick(s.width, min.width, max.width, def.width),
    height: pick(s.height, min.height, max.height, def.height)
  }
}
