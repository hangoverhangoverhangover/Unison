import { describe, expect, it } from 'vitest'
import { ICON_PX, drawIcon, thumbarSpec } from './thumbar'

const alphaAt = (buf: Buffer, x: number, y: number): number => buf[(y * ICON_PX + x) * 4 + 3]!

describe('taskbar thumbnail buttons', () => {
  it('draws each icon as a BGRA bitmap with ink where the shape is', () => {
    for (const kind of ['play', 'pause', 'next', 'previous'] as const) {
      const buf = drawIcon(kind)
      expect(buf.length).toBe(ICON_PX * ICON_PX * 4)
      expect(alphaAt(buf, 0, 0), kind).toBe(0)
    }
    // Pause: a bar on the left, a gap in the middle.
    const pause = drawIcon('pause')
    expect(alphaAt(pause, 11, 16)).toBe(255)
    expect(alphaAt(pause, 16, 16)).toBe(0)
    // Play: filled near the left of the triangle's middle.
    expect(alphaAt(drawIcon('play'), 13, 16)).toBe(255)
  })

  it('shows Pause while playing, Play otherwise; skips disabled without a song', () => {
    expect(thumbarSpec({ playing: true, hasTrack: true })).toEqual([
      { kind: 'previous', tooltip: 'Previous', enabled: true },
      { kind: 'pause', tooltip: 'Pause', enabled: true },
      { kind: 'next', tooltip: 'Next', enabled: true }
    ])
    expect(thumbarSpec({ playing: false, hasTrack: false })).toEqual([
      { kind: 'previous', tooltip: 'Previous', enabled: false },
      { kind: 'play', tooltip: 'Play', enabled: false },
      { kind: 'next', tooltip: 'Next', enabled: false }
    ])
  })
})
