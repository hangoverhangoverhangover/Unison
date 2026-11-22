// Taskbar thumbnail buttons (QoL 4, Windows): Previous, Play/Pause and Next under the
// window preview when you hover Unison in the taskbar. The icons are drawn here as
// small bitmaps, so there are no image files to ship.
import { nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import type { MediaKey } from '@shared/playback'

export type ThumbIcon = 'play' | 'pause' | 'next' | 'previous'

/** Drawn at 32 px and shown at 16 px (scale factor 2), so it stays sharp on HiDPI. */
export const ICON_PX = 32
const INK = 235

type Shape = (x: number, y: number) => boolean

const inRect =
  (x0: number, y0: number, x1: number, y1: number): Shape =>
  (x, y) =>
    x >= x0 && x < x1 && y >= y0 && y < y1

/** A triangle pointing right (or left) with its flat side at `base`. */
const triangle =
  (base: number, tip: number, top: number, bottom: number): Shape =>
  (x, y) => {
    const mid = (top + bottom) / 2
    const half = (bottom - top) / 2
    const t = (x + 0.5 - base) / (tip - base)
    return t >= 0 && t <= 1 && Math.abs(y + 0.5 - mid) <= half * (1 - t)
  }

const SHAPES: Record<ThumbIcon, Shape[]> = {
  play: [triangle(10, 25, 7, 25)],
  pause: [inRect(9, 8, 14, 24), inRect(18, 8, 23, 24)],
  next: [triangle(7, 20, 8, 24), inRect(21, 8, 25, 24)],
  previous: [triangle(25, 12, 8, 24), inRect(7, 8, 11, 24)]
}

/** A BGRA bitmap of the icon in near-white on transparent. */
export function drawIcon(kind: ThumbIcon): Buffer {
  const buf = Buffer.alloc(ICON_PX * ICON_PX * 4)
  for (let y = 0; y < ICON_PX; y++)
    for (let x = 0; x < ICON_PX; x++) {
      if (!SHAPES[kind].some((inside) => inside(x, y))) continue
      const i = (y * ICON_PX + x) * 4
      buf[i] = INK
      buf[i + 1] = INK
      buf[i + 2] = INK
      buf[i + 3] = 255
    }
  return buf
}

export interface ThumbButton {
  kind: ThumbIcon
  tooltip: string
  enabled: boolean
}

export function thumbarSpec(s: { playing: boolean; hasTrack: boolean }): ThumbButton[] {
  return [
    { kind: 'previous', tooltip: 'Previous', enabled: s.hasTrack },
    s.playing
      ? { kind: 'pause', tooltip: 'Pause', enabled: s.hasTrack }
      : { kind: 'play', tooltip: 'Play', enabled: s.hasTrack },
    { kind: 'next', tooltip: 'Next', enabled: s.hasTrack }
  ]
}

const KEY: Record<ThumbIcon, MediaKey> = {
  previous: 'previous',
  play: 'playpause',
  pause: 'playpause',
  next: 'next'
}

export function createThumbar(opts: { send(key: MediaKey): void }): {
  /** Apply to a window (call again after it's shown: Windows drops the buttons). */
  apply(win: BrowserWindow | null): void
  update(win: BrowserWindow | null, s: { playing: boolean; hasTrack: boolean }): void
} {
  const icons = new Map<ThumbIcon, NativeImage>()
  const icon = (kind: ThumbIcon): NativeImage => {
    let img = icons.get(kind)
    if (!img) {
      img = nativeImage.createFromBitmap(drawIcon(kind), {
        width: ICON_PX,
        height: ICON_PX,
        scaleFactor: 2
      })
      icons.set(kind, img)
    }
    return img
  }
  let state = { playing: false, hasTrack: false }
  const apply = (win: BrowserWindow | null): void => {
    if (process.platform !== 'win32' || !win || win.isDestroyed()) return
    win.setThumbarButtons(
      thumbarSpec(state).map((b) => ({
        icon: icon(b.kind),
        tooltip: b.tooltip,
        flags: b.enabled ? ['enabled'] : ['disabled'],
        click: () => opts.send(KEY[b.kind])
      }))
    )
  }
  return {
    apply,
    update(win, s) {
      if (s.playing === state.playing && s.hasTrack === state.hasTrack) return
      state = s
      apply(win)
    }
  }
}
