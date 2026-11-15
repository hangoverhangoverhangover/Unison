import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackController } from './controller'

type Handler = (e: Partial<KeyboardEvent> & { target: unknown }) => void
let keydown: Handler | undefined

beforeEach(() => {
  keydown = undefined
  ;(globalThis as { window?: unknown }).window = {
    addEventListener: (type: string, fn: Handler) => {
      if (type === 'keydown') keydown = fn
    },
    removeEventListener: () => undefined,
    api: { invoke: () => Promise.resolve(), on: () => () => undefined }
  }
})
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

const input = { tagName: 'INPUT', type: 'text', closest: () => null }
const body = { tagName: 'BODY', closest: () => null }

function press(key: string, target: unknown, mods: Partial<KeyboardEvent> = {}): void {
  keydown!({ key, target, defaultPrevented: false, preventDefault: () => undefined, ...mods })
}

async function setup(): Promise<{
  controller: PlaybackController
  ui: typeof import('@renderer/state/ui').useUi
}> {
  const { bindShortcuts } = await import('./shortcuts')
  const { useUi } = await import('@renderer/state/ui')
  const controller = {
    toggle: vi.fn(() => Promise.resolve()),
    getState: () => ({ volume: 0.5, muted: false }),
    getPositionMs: () => 0
  } as unknown as PlaybackController
  bindShortcuts(controller)
  useUi.setState({ quickSearchOpen: false })
  return { controller, ui: useUi }
}

describe('shortcuts', () => {
  it('Ctrl+K opens quick search even while typing', async () => {
    const { ui } = await setup()
    press('k', input, { ctrlKey: true })
    expect(ui.getState().quickSearchOpen).toBe(true)
  })

  it('Ctrl = zooms in, Ctrl 0 resets, Ctrl - stops at 70%', async () => {
    await setup()
    const { useAppearance } = await import('@renderer/state/appearance')
    useAppearance.setState({ zoom: 1 })
    press('=', body, { ctrlKey: true })
    expect(useAppearance.getState().zoom).toBe(1.1)
    press('0', input, { ctrlKey: true })
    expect(useAppearance.getState().zoom).toBe(1)
    useAppearance.setState({ zoom: 0.7 })
    press('-', body, { ctrlKey: true })
    expect(useAppearance.getState().zoom).toBe(0.7)
  })

  it('Space types in a text field instead of toggling playback', async () => {
    const { controller } = await setup()
    press(' ', input)
    expect(controller.toggle).not.toHaveBeenCalled()
    press(' ', body)
    expect(controller.toggle).toHaveBeenCalledTimes(1)
  })
})
