import { describe, expect, it, vi } from 'vitest'

// window.ts imports electron at module load; only the pure helper is under test.
vi.mock('electron', () => ({
  app: { getAppPath: () => '.' },
  BrowserWindow: class {},
  shell: {}
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const { overlayColors } = await import('./window')

describe('overlayColors', () => {
  it('keeps the caption buttons transparent with light symbols on dark themes', () => {
    expect(overlayColors('artwork')).toEqual({ color: '#00000000', symbolColor: '#e6e6ee' })
    expect(overlayColors('dark')).toEqual({ color: '#00000000', symbolColor: '#e6e6ee' })
  })

  it('uses dark symbols on the light theme', () => {
    expect(overlayColors('light')).toEqual({ color: '#00000000', symbolColor: '#1b1c22' })
  })
})
