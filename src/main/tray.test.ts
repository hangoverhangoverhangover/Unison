import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
const { tooltipFor } = await import('./tray')

describe('tray tooltip', () => {
  it('shows the state, title and artists, capped for Windows', () => {
    expect(tooltipFor(null)).toBe('Unison')
    expect(tooltipFor({ title: 'Song', artists: 'A, B', playing: true })).toBe('▶ Song — A, B')
    expect(tooltipFor({ title: 'Song', artists: '', playing: false })).toBe('❚❚ Song')
    expect(tooltipFor({ title: 'x'.repeat(300), artists: 'A', playing: true })).toHaveLength(127)
  })
})
