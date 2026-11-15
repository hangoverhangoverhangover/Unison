// The Jam client in main: creates rooms on the relay, holds the WebSocket, keeps the
// relay clock estimate and reconnects. The host secret lives only in this closure: it is
// never logged, never put in a JamStatus and never sent anywhere but the relay URL.
import type { AppPrefs } from '@shared/config'
import {
  HOST_ONLY,
  JAM_LIMITS,
  type JamCapabilities,
  type JamClientMessage,
  type JamCommand,
  type JamServerMessage,
  type JamStatus
} from '@shared/jam'
import { addSample, bestOffset, clockSample, type ClockSample } from './clock'
import {
  cleanCommand,
  normalizeCode,
  parseCreated,
  parseServerMessage,
  roomsUrl,
  socketUrl
} from './protocol'

/** The part of the WebSocket API the client uses (the global WebSocket satisfies it). */
export interface WsLike {
  readonly readyState: number
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}
export type WsFactory = (url: string) => WsLike

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(id: unknown): void
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface JamClientDeps {
  getPrefs(): Pick<AppPrefs, 'jamRelayUrl' | 'jamName'>
  onStatus(status: JamStatus): void
  fetch?: FetchLike
  createSocket?: WsFactory
  timers?: Timers
  now?: () => number
  log?: (message: string) => void
}

export interface JamClient {
  getStatus(): JamStatus
  start(): Promise<JamStatus>
  join(code: string): Promise<JamStatus>
  leave(): Promise<JamStatus>
  send(command: JamCommand): void
  setCapabilities(canPlay: JamCapabilities): void
  dispose(): Promise<void>
}

const OPEN = 1
export const PING_INTERVAL_MS = 10_000
/** Extra pings right after connecting, so the clock estimate is good from the start. */
export const QUICK_PINGS_MS = [0, 300, 600]
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000, 20_000]
export const RECONNECT_EVERY_MS = 30_000
export const WELCOME_TIMEOUT_MS = 15_000
export const CREATE_TIMEOUT_MS = 10_000
export const DEFAULT_NAME = 'Guest'
export const DEFAULT_CAPABILITIES: JamCapabilities = { spotify: false, soundcloud: true }

export const ERRORS = {
  noRelay: 'Add your Jam relay URL in Settings first.',
  unreachable: "Couldn't reach the Jam relay. Check the relay URL in Settings and your connection.",
  busy: 'The Jam relay is busy. Try again in a minute.',
  badReply: "The Jam relay sent a reply this app doesn't understand.",
  noAnswer: "The Jam relay didn't answer. Try again in a moment.",
  badCode: "That isn't a room code. Codes are 6 letters and numbers, like K7Q2MX.",
  already: "You're already in a Jam. Leave it first.",
  notConnected: "You're not connected to a Jam right now.",
  hostOnly: 'Only the host can do that.',
  tooBig: "That's too much to send at once. Try adding fewer tracks.",
  full: `That Jam is full (${JAM_LIMITS.participants} people max).`,
  ended: 'The Jam has ended.',
  hostKey: "The relay didn't accept this Jam's host key.",
  left: 'You left the Jam.',
  notFound: (code: string) => `Room ${code} wasn't found. Check the code; the Jam may have ended.`
} as const

/** Close codes a relay may use (guessed convention; reasons are matched as well). */
const CLOSE_NOT_FOUND = 4404
const CLOSE_FULL = 4409
const CLOSE_FORBIDDEN = 4403

interface Session {
  role: 'host' | 'guest'
  code: string
  relay: string
  secret?: string
}

interface Pending {
  resolve(status: JamStatus): void
  reject(err: Error): void
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>)
}

/** Readable reason for a socket that closed before the relay welcomed us. */
export function closeMessage(
  ev: { code: number; reason: string },
  session: { role: 'host' | 'guest'; code: string }
): string {
  const reason = ev.reason ?? ''
  if (ev.code === CLOSE_NOT_FOUND || /not.?found|no such room|unknown room/i.test(reason))
    return ERRORS.notFound(session.code)
  if (ev.code === CLOSE_FULL || /\bfull\b/i.test(reason)) return ERRORS.full
  if (session.role === 'host' && (ev.code === CLOSE_FORBIDDEN || /secret|forbidden/i.test(reason)))
    return ERRORS.hostKey
  if (/ended|closed|expired/i.test(reason)) return ERRORS.ended
  if (reason.trim() && ev.code >= 4000) return reason.trim().slice(0, 200)
  return session.role === 'guest'
    ? `Couldn't join room ${session.code}. Check the code and your relay URL; the Jam may have ended or be full.`
    : ERRORS.unreachable
}

export function createJamClient(deps: JamClientDeps): JamClient {
  const timers = deps.timers ?? defaultTimers
  const now = deps.now ?? Date.now
  const log = deps.log ?? ((m: string) => console.log(m))
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init))
  const createSocket: WsFactory =
    deps.createSocket ?? ((url) => new WebSocket(url) as unknown as WsLike)

  let status: JamStatus = { state: 'off', clockOffsetMs: 0 }
  let session: Session | null = null
  let ws: WsLike | null = null
  /** The current socket got a welcome. */
  let welcomed = false
  /** Some socket of this session got a welcome (so failures now mean "reconnect"). */
  let everWelcomed = false
  let pending: Pending | null = null
  let attempt = 0
  let samples: ClockSample[] = []
  let canPlay: JamCapabilities = { ...DEFAULT_CAPABILITIES }
  let sentCanPlay: JamCapabilities | null = null
  let reconnectTimer: unknown = null
  let welcomeTimer: unknown = null
  let pingTimer: unknown = null
  let quickTimers: unknown[] = []
  /** Bumped whenever a session ends, so late callbacks from old sockets do nothing. */
  let generation = 0

  const snapshot = (): JamStatus => {
    const s: JamStatus = { state: status.state, clockOffsetMs: status.clockOffsetMs }
    if (status.role) s.role = status.role
    if (status.you) s.you = status.you
    if (status.room) s.room = status.room
    if (status.error) s.error = status.error
    return s
  }
  const set = (next: JamStatus): void => {
    status = next
    try {
      deps.onStatus(snapshot())
    } catch (err) {
      log(`jam: status listener failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const patch = (p: Partial<JamStatus>): void => set({ ...status, ...p })

  const rawSend = (msg: JamClientMessage): boolean => {
    if (!ws || ws.readyState !== OPEN) return false
    try {
      ws.send(JSON.stringify(msg))
      return true
    } catch {
      return false
    }
  }

  const stopPings = (): void => {
    if (pingTimer !== null) timers.clearInterval(pingTimer)
    pingTimer = null
    for (const t of quickTimers) timers.clearTimeout(t)
    quickTimers = []
  }
  const ping = (): void => void rawSend({ type: 'ping', t: now() })
  const startPings = (): void => {
    stopPings()
    quickTimers = QUICK_PINGS_MS.map((ms) => timers.setTimeout(ping, ms))
    pingTimer = timers.setInterval(ping, PING_INTERVAL_MS)
  }

  const clearTimer = (which: 'reconnect' | 'welcome'): void => {
    if (which === 'reconnect' && reconnectTimer !== null) timers.clearTimeout(reconnectTimer)
    if (which === 'reconnect') reconnectTimer = null
    if (which === 'welcome' && welcomeTimer !== null) timers.clearTimeout(welcomeTimer)
    if (which === 'welcome') welcomeTimer = null
  }

  /** Drops the socket without reacting to its close. */
  const dropSocket = (code = 1000, reason = ''): void => {
    stopPings()
    clearTimer('welcome')
    const sock = ws
    ws = null
    welcomed = false
    if (!sock) return
    sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null
    try {
      sock.close(code, reason)
    } catch {
      // already closed
    }
  }

  /** Ends the session: status off with `error` (if any); a pending start/join rejects. */
  const end = (error?: string): void => {
    generation++
    dropSocket()
    clearTimer('reconnect')
    session = null
    everWelcomed = false
    attempt = 0
    samples = []
    sentCanPlay = null
    const p = pending
    pending = null
    set(error ? { state: 'off', clockOffsetMs: 0, error } : { state: 'off', clockOffsetMs: 0 })
    p?.reject(new Error(error ?? ERRORS.left))
  }

  const scheduleReconnect = (): void => {
    dropSocket()
    if (!session) return
    const delay = RECONNECT_DELAYS_MS[attempt] ?? RECONNECT_EVERY_MS
    attempt++
    if (status.state !== 'reconnecting') patch({ state: 'reconnecting' })
    log(`jam: connection lost, retrying in ${delay / 1000}s`)
    clearTimer('reconnect')
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  const onMessage = (msg: JamServerMessage): void => {
    switch (msg.type) {
      case 'welcome': {
        clearTimer('welcome')
        welcomed = true
        everWelcomed = true
        attempt = 0
        const s = session
        if (!s) return
        set({
          state: 'connected',
          role: s.role,
          you: msg.you,
          room: msg.state,
          clockOffsetMs: status.clockOffsetMs
        })
        if (sentCanPlay && !sameCaps(sentCanPlay, canPlay)) sendCapabilities()
        else sentCanPlay = { ...canPlay }
        const p = pending
        pending = null
        p?.resolve(snapshot())
        return
      }
      case 'state':
        if (!welcomed) return
        set({ ...status, room: msg.state, error: undefined })
        return
      case 'error':
        if (!everWelcomed) {
          end(msg.message.slice(0, 200) || ERRORS.unreachable)
          return
        }
        patch({ error: msg.message.slice(0, 200) })
        return
      case 'pong': {
        samples = addSample(samples, clockSample(msg.t, msg.serverTime, now()))
        const offset = bestOffset(samples)
        if (offset !== status.clockOffsetMs) patch({ clockOffsetMs: offset })
        return
      }
      case 'closed':
        end(msg.reason.trim().slice(0, 200) || ERRORS.ended)
        return
    }
  }

  function connect(): void {
    const s = session
    if (!s) return
    const gen = generation
    let sock: WsLike
    try {
      sock = createSocket(socketUrl(s.relay, s.code, s.secret))
    } catch {
      if (everWelcomed) scheduleReconnect()
      else end(ERRORS.unreachable)
      return
    }
    ws = sock
    welcomed = false
    const current = (): boolean => gen === generation && ws === sock
    sock.onopen = () => {
      if (!current()) return
      rawSend({
        type: 'hello',
        name: deps.getPrefs().jamName.trim() || DEFAULT_NAME,
        canPlay: { ...canPlay }
      })
      sentCanPlay = { ...canPlay }
      startPings()
    }
    sock.onmessage = (ev) => {
      if (!current()) return
      const msg = parseServerMessage(ev.data)
      if (msg) onMessage(msg)
    }
    sock.onerror = () => {
      // A close event follows; it decides what happens.
    }
    sock.onclose = (ev) => {
      if (!current()) return
      ws = null
      stopPings()
      clearTimer('welcome')
      const wasWelcomed = welcomed
      welcomed = false
      if (!wasWelcomed && !everWelcomed) {
        end(closeMessage(ev, s))
        return
      }
      // The room is gone: stop retrying.
      if (!wasWelcomed && (ev.code === CLOSE_NOT_FOUND || /not.?found/i.test(ev.reason ?? ''))) {
        end(ERRORS.ended)
        return
      }
      scheduleReconnect()
    }
    clearTimer('welcome')
    welcomeTimer = timers.setTimeout(() => {
      welcomeTimer = null
      if (!current() || welcomed) return
      if (everWelcomed) scheduleReconnect()
      else end(ERRORS.noAnswer)
    }, WELCOME_TIMEOUT_MS)
  }

  const sameCaps = (a: JamCapabilities, b: JamCapabilities): boolean =>
    a.spotify === b.spotify && a.soundcloud === b.soundcloud

  function sendCapabilities(): void {
    if (rawSend({ type: 'capabilities', canPlay: { ...canPlay } })) sentCanPlay = { ...canPlay }
  }

  /** Starts a session and waits for the relay's welcome. */
  const begin = (s: Session): Promise<JamStatus> => {
    session = s
    everWelcomed = false
    attempt = 0
    samples = []
    const promise = new Promise<JamStatus>((resolve, reject) => {
      pending = { resolve, reject }
    })
    connect()
    return promise
  }

  const relayUrl = (): string => {
    const relay = deps.getPrefs().jamRelayUrl.trim()
    if (!relay) throw new Error(ERRORS.noRelay)
    return relay
  }

  return {
    getStatus: snapshot,

    async start() {
      if (session || status.state !== 'off') throw new Error(ERRORS.already)
      const relay = relayUrl()
      const gen = ++generation
      set({ state: 'connecting', role: 'host', clockOffsetMs: 0 })
      const fail = (message: string): never => {
        if (gen === generation) end(message)
        throw new Error(message)
      }
      let res: Awaited<ReturnType<FetchLike>>
      try {
        res = await doFetch(roomsUrl(relay), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(CREATE_TIMEOUT_MS)
        })
      } catch {
        return fail(ERRORS.unreachable)
      }
      if (gen !== generation) throw new Error(ERRORS.left)
      if (res.status === 429 || res.status === 503) return fail(ERRORS.busy)
      if (!res.ok) return fail(`The Jam relay couldn't create a room (HTTP ${res.status}).`)
      let created: ReturnType<typeof parseCreated>
      try {
        created = parseCreated(await res.json())
      } catch {
        created = null
      }
      if (gen !== generation) throw new Error(ERRORS.left)
      if (!created) return fail(ERRORS.badReply)
      log(`jam: room ${created.code} created`)
      return begin({ role: 'host', code: created.code, relay, secret: created.hostSecret })
    },

    async join(input) {
      if (session || status.state !== 'off') throw new Error(ERRORS.already)
      const code = normalizeCode(input)
      if (!code) throw new Error(ERRORS.badCode)
      const relay = relayUrl()
      generation++
      set({ state: 'connecting', role: 'guest', clockOffsetMs: 0 })
      log(`jam: joining room ${code}`)
      return begin({ role: 'guest', code, relay })
    },

    async leave() {
      if (session?.role === 'host' && welcomed)
        rawSend({ type: 'command', command: { type: 'end' } })
      if (session || status.state !== 'off') end()
      else if (status.error) set({ state: 'off', clockOffsetMs: 0 })
      return snapshot()
    },

    send(command) {
      const clean = cleanCommand(command)
      if (!session || !welcomed) throw new Error(ERRORS.notConnected)
      if (session.role === 'guest' && HOST_ONLY.has(clean.type)) throw new Error(ERRORS.hostOnly)
      const frame = JSON.stringify({ type: 'command', command: clean } satisfies JamClientMessage)
      if (Buffer.byteLength(frame) > JAM_LIMITS.frameBytes) throw new Error(ERRORS.tooBig)
      if (!ws || ws.readyState !== OPEN) throw new Error(ERRORS.notConnected)
      ws.send(frame)
    },

    setCapabilities(next) {
      if (typeof next?.spotify !== 'boolean' || typeof next?.soundcloud !== 'boolean')
        throw new Error('Capabilities must be true or false per service.')
      canPlay = { spotify: next.spotify, soundcloud: next.soundcloud }
      if (welcomed && (!sentCanPlay || !sameCaps(sentCanPlay, canPlay))) sendCapabilities()
    },

    async dispose() {
      if (session?.role === 'host' && welcomed)
        rawSend({ type: 'command', command: { type: 'end' } })
      generation++
      dropSocket()
      clearTimer('reconnect')
      session = null
      const p = pending
      pending = null
      p?.reject(new Error(ERRORS.left))
    }
  }
}
