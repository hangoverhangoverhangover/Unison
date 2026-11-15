// Discord Rich Presence connection + activity sync. Electron-free: the RPC client
// comes from an injected factory so tests can drive it with a fake.
import type { SetActivity } from '@xhayper/discord-rpc'
import type { DiscordStatus, PresenceUpdate } from '@shared/discord'
import { toActivity } from './activity'

/** The slice of @xhayper/discord-rpc's Client this service uses. */
export interface RpcClient {
  /** Connect to the local Discord client. Rejects if Discord isn't running. */
  login(): Promise<void>
  setActivity(activity: SetActivity): Promise<void>
  clearActivity(): Promise<void>
  /** Disconnect. Safe to call more than once. */
  destroy(): Promise<void>
  /** Fired when an established connection drops (Discord quit, pipe closed). */
  onDisconnected(listener: () => void): void
}

export type RpcClientFactory = (appId: string) => RpcClient

export interface PresenceOptions {
  /** DISCORD_APP_ID. Empty means no key: never connects. */
  appId: string
  enabled: boolean
  clientFactory: RpcClientFactory
  onStatus(status: DiscordStatus): void
  log?(message: string, err?: unknown): void
}

export interface Presence {
  update(update: PresenceUpdate): void
  setEnabled(enabled: boolean): DiscordStatus
  getStatus(): DiscordStatus
  dispose(): Promise<void>
}

export const NO_KEY_ERROR = "Add DISCORD_APP_ID to .env to show what you're playing on Discord."
/** Trailing debounce for renderer updates (Discord allows ~5 activity updates per 20 s). */
export const DEBOUNCE_MS = 300
/** Delay before each reconnect attempt; the last one repeats. */
export const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000]

/** Error codes from @xhayper/discord-rpc's CUSTOM_RPC_ERROR_CODE. */
const CONNECTION_ENDED = 0
const CONNECTION_TIMEOUT = 1
const COULD_NOT_CONNECT = 2
const COULD_NOT_FIND_CLIENT = 3

/** A readable reason for a failed login. */
export function describeError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  switch (code) {
    case COULD_NOT_FIND_CLIENT:
    case COULD_NOT_CONNECT:
      return "Discord isn't running."
    case CONNECTION_TIMEOUT:
      return "Discord didn't respond. Try restarting Discord."
    case CONNECTION_ENDED:
      return 'Discord closed the connection. Check that DISCORD_APP_ID is correct.'
  }
  const message = err instanceof Error ? err.message : ''
  return message ? `Couldn't connect to Discord: ${message}` : "Couldn't connect to Discord."
}

/**
 * Phases (all reported through the existing DiscordConnection union):
 * - idle: enabled, nothing to show and no connection yet -> `unavailable` with no `error`.
 *   Nothing touches Discord until a non-stopped update arrives.
 * - connecting: a login is in flight -> `connecting`.
 * - connected -> `connected`. Stays connected after a stop (the activity is cleared).
 * - waiting: login failed or the connection dropped; a retry is scheduled while there's
 *   something to show -> `unavailable` with `error`.
 * The toggle being off is always `disabled`; a missing app id is always `unavailable` + NO_KEY_ERROR.
 */
type Phase = 'idle' | 'connecting' | 'connected' | 'waiting'

export function createPresence(opts: PresenceOptions): Presence {
  const hasKey = opts.appId.trim() !== ''
  const log = opts.log ?? ((): void => undefined)
  let enabled = opts.enabled
  let phase: Phase = 'idle'
  let error: string | undefined
  let disposed = false

  /** Latest desired activity (null = clear). Kept while offline so it shows on connect. */
  let desired: SetActivity | null = null
  /** JSON of the last activity Discord accepted; undefined = unknown (re-send). */
  let appliedKey: string | undefined
  let client: RpcClient | undefined
  /** Bumped whenever the current connection is abandoned, so stale callbacks are ignored. */
  let generation = 0
  let attempt = 0
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  /** Activity calls run one at a time, in order. */
  let queue: Promise<void> = Promise.resolve()
  let lastStatusKey = ''

  function status(): DiscordStatus {
    if (!hasKey) return { enabled, hasKey, connection: 'unavailable', error: NO_KEY_ERROR }
    if (!enabled) return { enabled, hasKey, connection: 'disabled' }
    switch (phase) {
      case 'connecting':
        return { enabled, hasKey, connection: 'connecting' }
      case 'connected':
        return { enabled, hasKey, connection: 'connected' }
      case 'waiting':
        return { enabled, hasKey, connection: 'unavailable', ...(error ? { error } : {}) }
      case 'idle':
        return { enabled, hasKey, connection: 'unavailable' }
    }
  }

  function publish(): void {
    const s = status()
    const key = JSON.stringify(s)
    if (key === lastStatusKey) return
    lastStatusKey = key
    opts.onStatus(s)
  }

  function canConnect(): boolean {
    return hasKey && enabled && !disposed
  }

  function clearTimer(t: ReturnType<typeof setTimeout> | undefined): undefined {
    if (t) clearTimeout(t)
    return undefined
  }

  /** Abandon the current client: optionally clear its activity first, then destroy it. */
  function dropClient(clear: boolean): Promise<void> {
    generation++
    const old = client
    client = undefined
    appliedKey = undefined
    if (!old) return Promise.resolve()
    const wasConnected = phase === 'connected'
    return (async () => {
      if (clear && wasConnected) {
        try {
          await old.clearActivity()
        } catch (err) {
          log('[discord] clearActivity failed', err)
        }
      }
      try {
        await old.destroy()
      } catch (err) {
        log('[discord] destroy failed', err)
      }
    })()
  }

  function connect(): void {
    if (!canConnect() || phase === 'connecting' || phase === 'connected') return
    retryTimer = clearTimer(retryTimer)
    const gen = ++generation
    const c = opts.clientFactory(opts.appId)
    client = c
    phase = 'connecting'
    error = undefined
    publish()
    c.onDisconnected(() => {
      if (gen !== generation || client !== c) return
      log('[discord] disconnected')
      client = undefined
      appliedKey = undefined
      generation++
      fail('Lost the connection to Discord.')
    })
    c.login().then(
      () => {
        if (gen !== generation) {
          void c.destroy().catch(() => undefined)
          return
        }
        phase = 'connected'
        attempt = 0
        error = undefined
        appliedKey = undefined
        publish()
        apply()
      },
      (err: unknown) => {
        if (gen !== generation) return
        log('[discord] login failed', err)
        client = undefined
        generation++
        void c.destroy().catch(() => undefined)
        fail(describeError(err))
      }
    )
  }

  /** Mark unavailable and retry with backoff while there's something to show. */
  function fail(reason: string): void {
    retryTimer = clearTimer(retryTimer)
    if (!canConnect()) return
    if (desired === null) {
      phase = 'idle'
      error = undefined
      publish()
      return
    }
    phase = 'waiting'
    error = reason
    publish()
    const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!
    attempt++
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      if (!canConnect()) return
      if (desired === null) {
        phase = 'idle'
        error = undefined
        publish()
        return
      }
      phase = 'idle'
      connect()
    }, delay)
  }

  /** Send the desired activity if it differs from what Discord last accepted. */
  function apply(): void {
    if (phase !== 'connected' || !client) return
    const c = client
    const gen = generation
    queue = queue.then(async () => {
      if (gen !== generation || client !== c) return
      const target = desired
      const key = JSON.stringify(target)
      if (key === appliedKey) return
      appliedKey = key
      try {
        if (target) await c.setActivity(target)
        else await c.clearActivity()
      } catch (err) {
        log('[discord] activity update failed', err)
        if (appliedKey === key) appliedKey = undefined
      }
    })
  }

  /** Debounced: act on the latest desired activity. */
  function flush(): void {
    debounceTimer = undefined
    if (!canConnect()) return
    if (phase === 'connected') apply()
    else if (phase === 'idle' && desired !== null) connect()
    // connecting: applied on login. waiting: the retry timer picks it up.
  }

  return {
    update(update) {
      if (disposed) return
      desired = toActivity(update)
      if (!canConnect()) return
      debounceTimer = clearTimer(debounceTimer)
      debounceTimer = setTimeout(flush, DEBOUNCE_MS)
    },

    setEnabled(on) {
      if (disposed || on === enabled) return status()
      enabled = on
      if (!on) {
        debounceTimer = clearTimer(debounceTimer)
        retryTimer = clearTimer(retryTimer)
        void dropClient(true)
        phase = 'idle'
        error = undefined
        attempt = 0
        publish()
      } else {
        phase = 'idle'
        if (desired !== null) connect()
        publish()
      }
      return status()
    },

    getStatus: status,

    async dispose() {
      if (disposed) return
      disposed = true
      debounceTimer = clearTimer(debounceTimer)
      retryTimer = clearTimer(retryTimer)
      await dropClient(true)
      phase = 'idle'
    }
  }
}
