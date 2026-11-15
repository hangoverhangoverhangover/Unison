import { describe, expect, it, vi } from 'vitest'
import type { MediaKey } from '@shared/playback'
import { createMediaKeys } from './mediaKeys'

interface FakeShortcuts {
  registered: Map<string, () => void>
  register: ReturnType<typeof vi.fn<(acc: string, cb: () => void) => boolean>>
  unregister: ReturnType<typeof vi.fn<(acc: string) => void>>
}

function fakeShortcuts(taken: string[] = []): FakeShortcuts {
  const registered = new Map<string, () => void>()
  return {
    registered,
    register: vi.fn((acc: string, cb: () => void) => {
      if (taken.includes(acc)) return false
      registered.set(acc, cb)
      return true
    }),
    unregister: vi.fn((acc: string) => void registered.delete(acc))
  }
}

describe('media keys', () => {
  it('takes the keys only while active and forwards presses', () => {
    const shortcuts = fakeShortcuts()
    const sent: MediaKey[] = []
    const keys = createMediaKeys({ send: (k) => sent.push(k), shortcuts })
    expect(shortcuts.registered.size).toBe(0)
    keys.setActive(true)
    keys.setActive(true)
    expect(shortcuts.register).toHaveBeenCalledTimes(4)
    shortcuts.registered.get('MediaNextTrack')!()
    shortcuts.registered.get('MediaPlayPause')!()
    expect(sent).toEqual(['next', 'playpause'])
    keys.setActive(false)
    expect(shortcuts.registered.size).toBe(0)
  })

  it('skips keys another app holds and retries them next time', () => {
    const shortcuts = fakeShortcuts(['MediaStop'])
    const keys = createMediaKeys({ send: () => undefined, shortcuts })
    keys.setActive(true)
    expect([...shortcuts.registered.keys()]).not.toContain('MediaStop')
    keys.setActive(true)
    expect(shortcuts.register.mock.calls.filter(([a]) => a === 'MediaStop')).toHaveLength(2)
    keys.dispose()
    expect(shortcuts.registered.size).toBe(0)
  })
})
