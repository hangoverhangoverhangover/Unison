import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JamRoomState, JamServerMessage, JamStatus } from '@shared/jam'
import {
  createJamClient,
  ERRORS,
  PING_INTERVAL_MS,
  WELCOME_TIMEOUT_MS,
  type FetchLike,
  type JamClient,
  type WsLike
} from './client'

class FakeSocket implements WsLike {
  readyState = 0
  sent: unknown[] = []
  closed: { code?: number; reason?: string } | null = null
  onopen: WsLike['onopen'] = null
  onmessage: WsLike['onmessage'] = null
  onclose: WsLike['onclose'] = null
  onerror: WsLike['onerror'] = null
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason }
    this.readyState = 3
  }
  // Server side
  open(): void {
    this.readyState = 1
    this.onopen?.({})
  }
  receive(msg: JamServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  drop(code = 1006, reason = ''): void {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }
  sentOf(type: string): Record<string, unknown>[] {
    return this.sent.filter((m) => (m as { type: string }).type === type) as Record<
      string,
      unknown
    >[]
  }
}

const room = (extra: Partial<JamRoomState> = {}): JamRoomState => ({
  code: 'K7Q2MX',
  participants: [],
  queue: [],
  currentIndex: -1,
  playing: false,
  positionMs: 0,
  positionAt: 0,
  blockUnplayable: false,
  version: 1,
  ...extra
})

let sockets: FakeSocket[]
let statuses: JamStatus[]
let prefs: { jamRelayUrl: string; jamName: string }
let fetchMock: ReturnType<typeof vi.fn<FetchLike>>
let client: JamClient
let logs: string[]

const last = (): FakeSocket => sockets[sockets.length - 1]!
const reply = (status: number, body: unknown): Awaited<ReturnType<FetchLike>> => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  sockets = []
  statuses = []
  logs = []
  prefs = { jamRelayUrl: 'https://jam.example.dev', jamName: 'Tripp' }
  fetchMock = vi.fn<FetchLike>(async () => reply(200, { code: 'k7q2mx', hostSecret: 'S3CRET' }))
  client = createJamClient({
    getPrefs: () => prefs,
    onStatus: (s) => statuses.push(s),
    fetch: fetchMock,
    createSocket: (url) => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s
    },
    log: (m) => logs.push(m)
  })
})
afterEach(async () => {
  await client.dispose()
  vi.useRealTimers()
})

/** Let the fetch/json promises in start() settle. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

async function startHost(): Promise<JamStatus> {
  const p = client.start()
  await flush()
  last().open()
  last().receive({ type: 'welcome', you: 'p1', state: room() })
  return p
}

describe('start (host)', () => {
  it('creates a room, connects with the secret and says hello', async () => {
    const status = await startHost()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://jam.example.dev/rooms',
      expect.objectContaining({ method: 'POST' })
    )
    expect(last().url).toBe('wss://jam.example.dev/rooms/K7Q2MX/ws?secret=S3CRET')
    expect(last().sent[0]).toEqual({
      type: 'hello',
      name: 'Tripp',
      canPlay: { spotify: false, soundcloud: true }
    })
    expect(status).toMatchObject({ state: 'connected', role: 'host', you: 'p1' })
    expect(statuses.map((s) => s.state)).toEqual(['connecting', 'connected'])
    // The secret never reaches a status or a log line.
    expect(JSON.stringify(statuses) + logs.join()).not.toContain('S3CRET')
  })

  it('uses ws:// for a local http relay and "Guest" with no name', async () => {
    prefs = { jamRelayUrl: 'http://localhost:8787', jamName: '  ' }
    await startHost()
    expect(last().url).toBe('ws://localhost:8787/rooms/K7Q2MX/ws?secret=S3CRET')
    expect(last().sent[0]).toMatchObject({ name: 'Guest' })
  })

  it('needs a relay URL', async () => {
    prefs.jamRelayUrl = ''
    await expect(client.start()).rejects.toThrow(ERRORS.noRelay)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports an unreachable relay, a busy one and a bad reply', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(client.start()).rejects.toThrow(ERRORS.unreachable)
    expect(client.getStatus()).toEqual({
      state: 'off',
      clockOffsetMs: 0,
      error: ERRORS.unreachable
    })

    fetchMock.mockResolvedValueOnce(reply(429, {}))
    await expect(client.start()).rejects.toThrow(ERRORS.busy)
    fetchMock.mockResolvedValueOnce(reply(500, {}))
    await expect(client.start()).rejects.toThrow('HTTP 500')
    fetchMock.mockResolvedValueOnce(reply(200, { code: 'nope' }))
    await expect(client.start()).rejects.toThrow(ERRORS.badReply)
    expect(sockets).toHaveLength(0)
  })

  it('refuses a second Jam', async () => {
    await startHost()
    await expect(client.start()).rejects.toThrow(ERRORS.already)
    await expect(client.join('K7Q2MX')).rejects.toThrow(ERRORS.already)
  })

  it('times out without a welcome', async () => {
    const p = client.start()
    await flush()
    last().open()
    vi.advanceTimersByTime(WELCOME_TIMEOUT_MS)
    await expect(p).rejects.toThrow(ERRORS.noAnswer)
    expect(last().closed).not.toBeNull()
  })
})

describe('join (guest)', () => {
  it('normalizes the code and connects without a secret', async () => {
    const p = client.join(' k7q-2mx ')
    expect(last().url).toBe('wss://jam.example.dev/rooms/K7Q2MX/ws')
    last().open()
    last().receive({ type: 'welcome', you: 'p2', state: room() })
    await expect(p).resolves.toMatchObject({ state: 'connected', role: 'guest', you: 'p2' })
  })

  it('rejects bad codes before connecting', async () => {
    for (const bad of ['ABC', 'ABCDEFG', 'IIIIII', 'O0O0O0', ''])
      await expect(client.join(bad)).rejects.toThrow(ERRORS.badCode)
    expect(sockets).toHaveLength(0)
  })

  it('turns pre-welcome closes and errors into readable messages', async () => {
    let p = client.join('K7Q2MX')
    last().drop(4404, '')
    await expect(p).rejects.toThrow("Room K7Q2MX wasn't found")
    expect(client.getStatus().error).toContain("wasn't found")

    p = client.join('K7Q2MX')
    last().drop(1008, 'Room is full')
    await expect(p).rejects.toThrow(ERRORS.full)

    p = client.join('K7Q2MX')
    last().open()
    last().receive({ type: 'error', message: 'Nope.' })
    await expect(p).rejects.toThrow('Nope.')

    p = client.join('K7Q2MX')
    last().drop(1006, '')
    await expect(p).rejects.toThrow("Couldn't join room K7Q2MX")
  })
})

describe('frames', () => {
  it('mirrors state frames, keeps errors until the next state, and handles closed', async () => {
    await startHost()
    last().receive({ type: 'state', state: room({ version: 2, playing: true }) })
    expect(client.getStatus().room).toMatchObject({ version: 2, playing: true })
    last().receive({ type: 'error', message: 'Queue is full.' })
    expect(client.getStatus()).toMatchObject({ state: 'connected', error: 'Queue is full.' })
    last().receive({ type: 'state', state: room({ version: 3 }) })
    expect(client.getStatus().error).toBeUndefined()
    last().onmessage?.({ data: '{"type":"state","state":{}}' })
    last().onmessage?.({ data: 'not json' })
    expect(client.getStatus().room?.version).toBe(3)

    last().receive({ type: 'closed', reason: 'The host ended the Jam.' })
    expect(client.getStatus()).toEqual({
      state: 'off',
      clockOffsetMs: 0,
      error: 'The host ended the Jam.'
    })
    expect(last().closed).not.toBeNull()
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
  })
})

describe('clock', () => {
  it('pings quickly on connect, then every 10 s, and uses the lowest-RTT sample', async () => {
    await startHost()
    const s = last()
    vi.advanceTimersByTime(600)
    expect(s.sentOf('ping')).toHaveLength(3)
    vi.advanceTimersByTime(PING_INTERVAL_MS)
    expect(s.sentOf('ping')).toHaveLength(4)

    // Sent at t, relay stamps serverTime, received 200 ms later: offset = 5000 - 100.
    const t = Date.now()
    vi.setSystemTime(t + 200)
    s.receive({ type: 'pong', t, serverTime: t + 5000 })
    expect(client.getStatus().clockOffsetMs).toBe(4900)
    // A faster round trip wins: rtt 20, offset 5000 - 10.
    const t2 = Date.now()
    vi.setSystemTime(t2 + 20)
    s.receive({ type: 'pong', t: t2, serverTime: t2 + 5000 })
    expect(client.getStatus().clockOffsetMs).toBe(4990)
    // A slower one afterwards doesn't.
    const t3 = Date.now()
    vi.setSystemTime(t3 + 400)
    s.receive({ type: 'pong', t: t3, serverTime: t3 + 7000 })
    expect(client.getStatus().clockOffsetMs).toBe(4990)
  })
})

describe('reconnect', () => {
  it('backs off 1, 2, 5, 10, 20 then 30 s, keeping role and secret', async () => {
    await startHost()
    last().drop()
    expect(client.getStatus()).toMatchObject({ state: 'reconnecting', role: 'host' })
    expect(client.getStatus().room).toBeDefined()
    const delays = [1000, 2000, 5000, 10_000, 20_000, 30_000, 30_000]
    for (const d of delays) {
      const before = sockets.length
      vi.advanceTimersByTime(d - 1)
      expect(sockets).toHaveLength(before)
      vi.advanceTimersByTime(1)
      expect(sockets).toHaveLength(before + 1)
      expect(last().url).toContain('?secret=S3CRET')
      last().drop()
    }
    vi.advanceTimersByTime(30_000)
    last().open()
    expect(last().sent[0]).toMatchObject({ type: 'hello' })
    last().receive({ type: 'welcome', you: 'p9', state: room({ version: 5 }) })
    expect(client.getStatus()).toMatchObject({ state: 'connected', role: 'host', you: 'p9' })
    // Backoff resets after a welcome.
    last().drop()
    const before = sockets.length
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(before + 1)
  })

  it('stops when the room is gone', async () => {
    const p = client.join('K7Q2MX')
    last().open()
    last().receive({ type: 'welcome', you: 'p2', state: room() })
    await p
    last().drop()
    vi.advanceTimersByTime(1000)
    last().drop(4404, 'Room not found')
    expect(client.getStatus()).toMatchObject({ state: 'off', error: ERRORS.ended })
    vi.advanceTimersByTime(60_000)
    expect(last().closed).toBeNull()
  })
})

describe('leave, send, capabilities', () => {
  it('host leave sends end first, then closes', async () => {
    await startHost()
    const s = last()
    const status = await client.leave()
    expect(s.sentOf('command')).toEqual([{ type: 'command', command: { type: 'end' } }])
    expect(s.closed).not.toBeNull()
    expect(status).toEqual({ state: 'off', clockOffsetMs: 0 })
  })

  it('guest leave just closes', async () => {
    const p = client.join('K7Q2MX')
    last().open()
    last().receive({ type: 'welcome', you: 'p2', state: room() })
    await p
    await client.leave()
    expect(last().sentOf('command')).toEqual([])
    expect(last().closed).not.toBeNull()
  })

  it('leave while connecting rejects the pending start', async () => {
    const p = client.join('K7Q2MX')
    await client.leave()
    await expect(p).rejects.toThrow(ERRORS.left)
    expect(client.getStatus().state).toBe('off')
  })

  it('sends clean commands; refuses host-only ones for guests and local files', async () => {
    expect(() => client.send({ type: 'next' })).toThrow(ERRORS.notConnected)
    const p = client.join('K7Q2MX')
    last().open()
    last().receive({ type: 'welcome', you: 'p2', state: room() })
    await p
    expect(() => client.send({ type: 'next' })).toThrow(ERRORS.hostOnly)
    const track = {
      id: 'soundcloud:1',
      provider: 'soundcloud' as const,
      nativeId: '1',
      title: 'T',
      artists: ['A'],
      durationMs: 1000,
      localPath: 'C:\\music\\x.mp3'
    }
    expect(() => client.send({ type: 'add', tracks: [track] })).toThrow("Local files can't")
    const { localPath: _drop, ...clean } = track
    void _drop
    client.send({ type: 'add', tracks: [{ ...clean, extra: 'x' } as typeof clean] })
    expect(last().sentOf('command')).toEqual([
      { type: 'command', command: { type: 'add', tracks: [clean] } }
    ])
  })

  it('keeps the last capabilities and sends changes while connected', async () => {
    client.setCapabilities({ spotify: true, soundcloud: true })
    await startHost()
    expect(last().sent[0]).toMatchObject({ canPlay: { spotify: true, soundcloud: true } })
    client.setCapabilities({ spotify: true, soundcloud: true })
    expect(last().sentOf('capabilities')).toHaveLength(0)
    client.setCapabilities({ spotify: false, soundcloud: true })
    expect(last().sentOf('capabilities')).toEqual([
      { type: 'capabilities', canPlay: { spotify: false, soundcloud: true } }
    ])
  })
})
