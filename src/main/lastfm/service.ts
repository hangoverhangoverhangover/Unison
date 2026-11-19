// Last.fm scrobbling: the user's own API account, the desktop login flow, "now
// playing" and an offline waiting list for scrobbles. The shared secret and the
// session key are kept encrypted (safeStorage); they never reach the renderer.
import type { LastfmStatus, ScrobbleReport } from '@shared/lastfm'
import type { Track } from '@shared/types'
import type { SecretBox, SettingsStore } from '../spotify/tokens'
import {
  BATCH,
  apiSig,
  batchParams,
  classifyError,
  enqueue,
  shouldScrobble,
  toQueued,
  type QueuedScrobble
} from './core'

const API = 'https://ws.audioscrobbler.com/2.0/'
const AUTH_PAGE = 'https://www.last.fm/api/auth/'
const ACCOUNT_KEY = 'lastfm.account'
const QUEUE_KEY = 'lastfm.queue'
/** Poll for the browser approval this often, for at most this long (tokens last 60 min). */
const POLL_MS = 3000
const POLL_FOR_MS = 10 * 60 * 1000
/** Retry a failed send after this long (doubling up to RETRY_MAX_MS). */
const RETRY_MS = 60_000
const RETRY_MAX_MS = 30 * 60_000

interface Account {
  apiKey: string
  /** base64 of the encrypted shared secret. */
  secret: string
  /** base64 of the encrypted session key, once logged in. */
  session?: string
  username?: string
  scrobbleSpotify: boolean
  expired?: boolean
}

export interface LastfmDeps {
  settings: SettingsStore
  box: SecretBox
  fetch: typeof fetch
  openExternal(url: string): void
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (id: unknown) => void
  onStatus(status: LastfmStatus): void
}

class LastfmError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

export function createLastfm(deps: LastfmDeps): {
  status(): LastfmStatus
  setKeys(apiKey: string, secret: string): void
  connect(): Promise<void>
  disconnect(): void
  setScrobbleSpotify(on: boolean): void
  nowPlaying(track: Track): Promise<void>
  scrobble(report: ScrobbleReport): Promise<void>
  dispose(): void
} {
  const now = deps.now ?? Date.now
  const later = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel = deps.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))

  const read = <T>(key: string): T | undefined => {
    const raw = deps.settings.get(key)
    if (!raw) return undefined
    try {
      return JSON.parse(raw) as T
    } catch {
      return undefined
    }
  }
  let account = read<Account>(ACCOUNT_KEY)
  let queue = read<QueuedScrobble[]>(QUEUE_KEY) ?? []
  let authorizing = false
  let error: string | undefined
  let pollTimer: unknown
  let retryTimer: unknown
  let retryMs = RETRY_MS
  let sending = false
  let disposed = false

  const seal = (plain: string): string => {
    if (!deps.box.isEncryptionAvailable()) {
      throw new Error("Windows can't store secrets safely right now, so Last.fm can't be saved.")
    }
    return deps.box.encryptString(plain).toString('base64')
  }
  const open = (sealed: string): string => deps.box.decryptString(Buffer.from(sealed, 'base64'))

  const status = (): LastfmStatus => ({
    hasKeys: !!account,
    ...(account ? { keyHint: account.apiKey.slice(-4) } : {}),
    state: authorizing
      ? 'authorizing'
      : account?.session && !account.expired
        ? 'connected'
        : account?.expired
          ? 'expired'
          : 'disconnected',
    ...(account?.username ? { username: account.username } : {}),
    scrobbleSpotify: account?.scrobbleSpotify ?? false,
    pending: queue.length,
    ...(error ? { error } : {})
  })
  const changed = (): void => {
    if (!disposed) deps.onStatus(status())
  }
  const saveAccount = (): void => {
    if (account) deps.settings.set(ACCOUNT_KEY, JSON.stringify(account))
    else deps.settings.delete(ACCOUNT_KEY)
  }
  const saveQueue = (): void => deps.settings.set(QUEUE_KEY, JSON.stringify(queue))

  /** Signed call. GET for the auth reads, POST for writes. Throws LastfmError on an API error. */
  const call = async (
    method: string,
    params: Record<string, string>,
    opts: { post?: boolean; session?: boolean } = {}
  ): Promise<Record<string, unknown>> => {
    if (!account) throw new Error('Add your Last.fm API key and secret first.')
    const all: Record<string, string> = { ...params, method, api_key: account.apiKey }
    if (opts.session) {
      if (!account.session) throw new Error('Connect Last.fm first.')
      all.sk = open(account.session)
    }
    all.api_sig = apiSig(all, open(account.secret))
    all.format = 'json'
    const body = new URLSearchParams(all).toString()
    const res = opts.post
      ? await deps.fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
          body
        })
      : await deps.fetch(`${API}?${body}`)
    const json = (await res.json()) as Record<string, unknown>
    if (typeof json.error === 'number') {
      throw new LastfmError(json.error, String(json.message ?? `Last.fm error ${json.error}`))
    }
    return json
  }

  const scheduleRetry = (): void => {
    if (retryTimer !== undefined || disposed) return
    retryTimer = later(() => {
      retryTimer = undefined
      void flush()
    }, retryMs)
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
  }

  /** Send waiting scrobbles, oldest first, in batches. */
  const flush = async (): Promise<void> => {
    if (sending || !account?.session || account.expired || queue.length === 0) return
    sending = true
    try {
      while (queue.length > 0) {
        const batch = queue.slice(0, BATCH)
        try {
          await call('track.scrobble', batchParams(batch), { post: true, session: true })
        } catch (err) {
          if (!(err instanceof LastfmError)) {
            scheduleRetry() // offline or Last.fm unreachable
            return
          }
          const kind = classifyError(err.code)
          if (kind === 'retry') {
            scheduleRetry()
            return
          }
          if (kind === 'reauth') {
            account.expired = true
            saveAccount()
            error = 'Last.fm logged you out. Connect again to send your scrobbles.'
            return
          }
          error = `Last.fm didn't accept some scrobbles: ${err.message}`
        }
        // Sent, or rejected for good: either way they leave the list.
        queue = queue.slice(batch.length)
        saveQueue()
        retryMs = RETRY_MS
      }
    } finally {
      sending = false
      changed()
    }
  }

  const stopPolling = (): void => {
    if (pollTimer !== undefined) cancel(pollTimer)
    pollTimer = undefined
    authorizing = false
  }

  return {
    status,

    setKeys(apiKey, secret) {
      const key = apiKey.trim()
      const sec = secret.trim()
      if (!/^[0-9a-zA-Z]{8,64}$/.test(key) || !/^[0-9a-zA-Z]{8,64}$/.test(sec)) {
        throw new Error('That doesn’t look like a Last.fm API key and shared secret.')
      }
      stopPolling()
      account = {
        apiKey: key,
        secret: seal(sec),
        scrobbleSpotify: account?.scrobbleSpotify ?? false
      }
      error = undefined
      saveAccount()
      changed()
    },

    async connect() {
      if (!account) throw new Error('Add your Last.fm API key and secret first.')
      stopPolling()
      error = undefined
      const { token } = (await call('auth.getToken', {})) as { token?: string }
      if (!token) throw new Error('Last.fm didn’t return a login token.')
      authorizing = true
      changed()
      deps.openExternal(`${AUTH_PAGE}?api_key=${account.apiKey}&token=${token}`)
      const until = now() + POLL_FOR_MS
      const poll = async (): Promise<void> => {
        pollTimer = undefined
        if (!authorizing || !account) return
        try {
          const res = (await call('auth.getSession', { token })) as {
            session?: { name?: string; key?: string }
          }
          if (!res.session?.key) throw new Error('No session')
          account.session = seal(res.session.key)
          account.username = res.session.name
          account.expired = false
          saveAccount()
          authorizing = false
          changed()
          void flush()
          return
        } catch (err) {
          // 14: not approved yet; keep waiting. Anything else ends the attempt.
          const waiting = err instanceof LastfmError && err.code === 14
          if (!waiting || now() >= until) {
            authorizing = false
            error =
              err instanceof LastfmError && err.code === 15
                ? 'The Last.fm login timed out. Try Connect again.'
                : waiting
                  ? 'The Last.fm login timed out. Try Connect again.'
                  : `Last.fm login failed: ${(err as Error).message}`
            changed()
            return
          }
        }
        pollTimer = later(() => void poll(), POLL_MS)
      }
      pollTimer = later(() => void poll(), POLL_MS)
    },

    disconnect() {
      stopPolling()
      if (account) {
        delete account.session
        delete account.username
        delete account.expired
        saveAccount()
      }
      error = undefined
      changed()
    },

    setScrobbleSpotify(on) {
      if (!account) return
      account.scrobbleSpotify = on
      saveAccount()
      changed()
    },

    async nowPlaying(track) {
      if (!account?.session || account.expired) return
      if (!shouldScrobble(track, account.scrobbleSpotify)) return
      const q = toQueued(track, now())
      const params: Record<string, string> = { artist: q.artist, track: q.track }
      if (q.album) params.album = q.album
      if (q.durationS) params.duration = String(q.durationS)
      // Last.fm's guide: a failed "now playing" is not retried.
      await call('track.updateNowPlaying', params, { post: true, session: true }).catch(
        () => undefined
      )
    },

    async scrobble({ track, startedAt }) {
      if (!account) return
      if (!shouldScrobble(track, account.scrobbleSpotify)) return
      queue = enqueue(queue, [toQueued(track, startedAt)], now())
      saveQueue()
      changed()
      await flush()
    },

    dispose() {
      disposed = true
      stopPolling()
      if (retryTimer !== undefined) cancel(retryTimer)
    }
  }
}
