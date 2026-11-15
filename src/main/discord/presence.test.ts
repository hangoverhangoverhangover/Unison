import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetActivity } from '@xhayper/discord-rpc'
import type { DiscordStatus, PresenceTrack, PresenceUpdate } from '@shared/discord'
import {
  createPresence,
  DEBOUNCE_MS,
  NO_KEY_ERROR,
  type Presence,
  type RpcClient
} from './presence'

class FakeClient implements RpcClient {
  activities: (SetActivity | null)[] = []
  destroyed = false
  private listeners: (() => void)[] = []
  constructor(private readonly fail?: unknown) {}
  login(): Promise<void> {
    return this.fail === undefined ? Promise.resolve() : Promise.reject(this.fail)
  }
  async setActivity(a: SetActivity): Promise<void> {
    this.activities.push(a)
  }
  async clearActivity(): Promise<void> {
    this.activities.push(null)
  }
  async destroy(): Promise<void> {
    this.destroyed = true
  }
  onDisconnected(listener: () => void): void {
    this.listeners.push(listener)
  }
  disconnect(): void {
    for (const l of this.listeners) l()
  }
}

const notRunning = Object.assign(new Error('Unable to find any Discord client'), { code: 3 })

const track: PresenceTrack = { title: 'Song', artists: ['A'], provider: 'soundcloud' }
const playing = (startedAtMs = 0): PresenceUpdate => ({
  state: 'playing',
  track,
  startedAtMs,
  durationMs: 1000
})
const paused: PresenceUpdate = { state: 'paused', track }

interface Setup {
  presence: Presence
  clients: FakeClient[]
  statuses: DiscordStatus[]
  factory: ReturnType<typeof vi.fn<(appId: string) => RpcClient>>
  last(): DiscordStatus | undefined
}

function setup(opts: { appId?: string; enabled?: boolean; failures?: number } = {}): Setup {
  const clients: FakeClient[] = []
  const statuses: DiscordStatus[] = []
  let failures = opts.failures ?? 0
  const factory = vi.fn((appId: string): RpcClient => {
    expect(appId).toBe('123')
    const c = new FakeClient(failures-- > 0 ? notRunning : undefined)
    clients.push(c)
    return c
  })
  const presence = createPresence({
    appId: opts.appId ?? '123',
    enabled: opts.enabled ?? true,
    clientFactory: factory,
    onStatus: (s) => statuses.push(s)
  })
  const last = (): DiscordStatus | undefined => statuses[statuses.length - 1]
  return { presence, clients, statuses, factory, last }
}

const tick = async (ms = DEBOUNCE_MS): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createPresence', () => {
  it('connects lazily on the first non-stopped update', async () => {
    const { presence, factory, clients, last } = setup()
    expect(presence.getStatus()).toEqual({ enabled: true, hasKey: true, connection: 'unavailable' })
    presence.update({ state: 'stopped' })
    await tick()
    expect(factory).not.toHaveBeenCalled()

    presence.update(playing())
    await tick()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(last()?.connection).toBe('connected')
    expect(clients[0]!.activities).toHaveLength(1)
    expect(clients[0]!.activities[0]?.details).toBe('Song')
  })

  it('debounces rapid updates and skips identical ones', async () => {
    const { presence, clients } = setup()
    presence.update(playing())
    await tick()
    const c = clients[0]!
    presence.update(paused)
    presence.update(playing(10))
    presence.update(playing(20))
    await tick(DEBOUNCE_MS - 1)
    expect(c.activities).toHaveLength(1)
    await tick(1)
    expect(c.activities).toHaveLength(2)
    expect(c.activities[1]?.startTimestamp).toBe(20)

    presence.update(playing(20))
    await tick()
    expect(c.activities).toHaveLength(2)

    presence.update({ state: 'stopped' })
    await tick()
    expect(c.activities[2]).toBeNull()
    presence.update({ state: 'stopped' })
    await tick()
    expect(c.activities).toHaveLength(3)
  })

  it('retries with backoff after login failures', async () => {
    const { presence, factory, clients, last } = setup({ failures: 3 })
    presence.update(playing())
    await tick()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(clients[0]!.destroyed).toBe(true)
    expect(last()).toEqual({
      enabled: true,
      hasKey: true,
      connection: 'unavailable',
      error: "Discord isn't running."
    })

    // Latest desired activity is kept while offline.
    presence.update(paused)
    await tick(15_000 - 1)
    expect(factory).toHaveBeenCalledTimes(1)
    await tick(1)
    expect(factory).toHaveBeenCalledTimes(2)
    await tick(30_000)
    expect(factory).toHaveBeenCalledTimes(3)
    await tick(59_999)
    expect(factory).toHaveBeenCalledTimes(3)
    await tick(1)
    expect(factory).toHaveBeenCalledTimes(4)
    expect(last()?.connection).toBe('connected')
    expect(clients[3]!.activities).toHaveLength(1)
    expect(clients[3]!.activities[0]?.smallImageText).toBe('Paused')
  })

  it('caps the backoff at five minutes', async () => {
    const { presence, factory } = setup({ failures: 100 })
    presence.update(playing())
    await tick()
    await tick(15_000 + 30_000 + 60_000 + 120_000 + 300_000)
    expect(factory).toHaveBeenCalledTimes(6)
    await tick(300_000)
    expect(factory).toHaveBeenCalledTimes(7)
  })

  it('stops retrying when there is nothing to show', async () => {
    const { presence, factory, last } = setup({ failures: 1 })
    presence.update(playing())
    await tick()
    presence.update({ state: 'stopped' })
    await tick(15_000)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(last()).toEqual({ enabled: true, hasKey: true, connection: 'unavailable' })

    presence.update(playing())
    await tick()
    expect(factory).toHaveBeenCalledTimes(2)
    expect(last()?.connection).toBe('connected')
  })

  it('reconnects after a disconnect and re-sends the activity', async () => {
    const { presence, factory, clients, last } = setup()
    presence.update(playing())
    await tick()
    clients[0]!.disconnect()
    expect(last()?.connection).toBe('unavailable')
    expect(last()?.error).toBeTruthy()
    await tick(15_000)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(last()?.connection).toBe('connected')
    expect(clients[1]!.activities).toHaveLength(1)
  })

  it('setEnabled(false) clears and destroys; true reconnects when there is an activity', async () => {
    const { presence, factory, clients, last } = setup()
    presence.update(playing())
    await tick()
    const c = clients[0]!
    expect(presence.setEnabled(false)).toEqual({
      enabled: false,
      hasKey: true,
      connection: 'disabled'
    })
    await tick(0)
    expect(c.activities[1]).toBeNull()
    expect(c.destroyed).toBe(true)
    // The destroyed client's disconnect event is ignored.
    c.disconnect()
    expect(last()?.connection).toBe('disabled')

    presence.update(paused)
    await tick()
    expect(factory).toHaveBeenCalledTimes(1)

    expect(presence.setEnabled(true).connection).toBe('connecting')
    await tick(0)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(last()?.connection).toBe('connected')
    expect(clients[1]!.activities[0]?.smallImageText).toBe('Paused')
  })

  it('setEnabled(true) stays idle with nothing to show', async () => {
    const { presence, factory } = setup({ enabled: false })
    expect(presence.getStatus().connection).toBe('disabled')
    presence.update(playing())
    await tick()
    expect(factory).not.toHaveBeenCalled()
    presence.update({ state: 'stopped' })
    expect(presence.setEnabled(true)).toEqual({
      enabled: true,
      hasKey: true,
      connection: 'unavailable'
    })
    await tick()
    expect(factory).not.toHaveBeenCalled()
  })

  it('never connects without an app id', async () => {
    const { presence, factory } = setup({ appId: '' })
    const noKey = { enabled: true, hasKey: false, connection: 'unavailable', error: NO_KEY_ERROR }
    expect(presence.getStatus()).toEqual(noKey)
    presence.update(playing())
    await tick(600_000)
    expect(presence.setEnabled(false)).toEqual({ ...noKey, enabled: false })
    expect(presence.setEnabled(true)).toEqual(noKey)
    await tick(600_000)
    expect(factory).not.toHaveBeenCalled()
  })

  it('dispose clears, destroys and stops timers', async () => {
    const { presence, factory, clients } = setup()
    presence.update(playing())
    await tick()
    presence.update(paused)
    await presence.dispose()
    const c = clients[0]!
    expect(c.activities).toEqual([expect.anything(), null])
    expect(c.destroyed).toBe(true)
    await tick(600_000)
    expect(c.activities).toHaveLength(2)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('dispose stops a pending retry', async () => {
    const { presence, factory } = setup({ failures: 1 })
    presence.update(playing())
    await tick()
    await presence.dispose()
    await tick(600_000)
    expect(factory).toHaveBeenCalledTimes(1)
  })
})
