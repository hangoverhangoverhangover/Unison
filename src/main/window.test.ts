import { describe, expect, it, vi } from 'vitest'

// window.ts imports electron at module load; only the pure helper is under test.
vi.mock('electron', () => ({
  app: { getAppPath: () => '.' },
  BrowserWindow: class {},
  shell: {}
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const { overlayColors, shellBackground } = await import('./window')
const { DEFAULT_CUSTOM_THEME } = await import('@shared/theme')

describe('overlayColors', () => {
  it('keeps the caption buttons transparent with light symbols on dark themes', () => {
    expect(overlayColors('artwork')).toEqual({ color: '#00000000', symbolColor: '#e6e6ee' })
    expect(overlayColors('dark')).toEqual({ color: '#00000000', symbolColor: '#e6e6ee' })
  })

  it('uses dark symbols on the light theme', () => {
    expect(overlayColors('light')).toEqual({ color: '#00000000', symbolColor: '#1b1c22' })
  })

  it('follows a custom theme: its text colour on the buttons, its background behind', () => {
    const custom = { ...DEFAULT_CUSTOM_THEME, text: '#112233', background: '#fafafa' }
    expect(overlayColors('custom', custom).symbolColor).toBe('#112233')
    expect(shellBackground('custom', custom)).toBe('#fafafa')
    expect(shellBackground('dark', custom)).toBe('#141522')
  })
})
