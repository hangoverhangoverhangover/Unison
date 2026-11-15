import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import {
  JAM_LIMITS,
  type JamCreated,
  type JamServerMessage,
  type JamTrack
} from '../../src/shared/jam'

const BASE = 'https://relay.test'
const both = { spotify: true, soundcloud: true }
const track: JamTrack = {
  id: 'spotify:abc',
  provider: 'spotify',
  nativeId: 'abc',
  title: 'Song',
  artists: ['Band'],
  durationMs: 200_000
}

async function createRoom(): Promise<JamCreated> {
  // Same request the app sends.
  const res = await exports.default.fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  })
  expect(res.status).toBe(201)
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  return res.json()
}

interface Client {
  ws: WebSocket
  next: (type?: JamServerMessage['type']) => Promise<JamServerMessage>
  send: (msg: unknown) => void
  closed: Promise<CloseEvent>
}

async function connect(code: string, secret?: string): Promise<Client> {
  const q = secret ? `?secret=${secret}` : ''
  const res = await exports.default.fetch(`${BASE}/rooms/${code}/ws${q}`, {
    headers: { Upgrade: 'websocket' }
  })
  expect(res.status).toBe(101)
  const ws = res.webSocket!
  ws.accept()
  const inbox: JamServerMessage[] = []
  const waiters: Array<() => void> = []
  ws.addEventListener('message', (e) => {
    inbox.push(JSON.parse(e.data as string))
    waiters.splice(0).forEach((w) => w())
  })
  const closed = new Promise<CloseEvent>((r) => ws.addEventListener('close', r))
  const next = async (type?: JamServerMessage['type']): Promise<JamServerMessage> => {
    for (;;) {
      const i = inbox.findIndex((m) => !type || m.type === type)
      if (i >= 0) return inbox.splice(i, 1)[0]!
      await new Promise<void>((r) => waiters.push(r))
    }
  }
  return { ws, next, send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)), closed }
}

/** Connects and expects the relay to refuse: returns the error frames and the close event. */
async function refused(path: string): Promise<{ errors: string[]; close: CloseEvent }> {
  const res = await exports.default.fetch(`${BASE}${path}`, { headers: { Upgrade: 'websocket' } })
  expect(res.status).toBe(101)
  const ws = res.webSocket!
  const errors: string[] = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data as string) as JamServerMessage
    if (m.type === 'error') errors.push(m.message)
  })
  const closed = new Promise<CloseEvent>((r) => ws.addEventListener('close', r))
  ws.accept()
  return { errors, close: await closed }
}

describe('relay', () => {
  it('answers health and closes unknown rooms with 4404 after the upgrade', async () => {
    const health = await exports.default.fetch(`${BASE}/`)
    expect(await health.json()).toMatchObject({ ok: true })
    for (const path of ['/rooms/ZZZZZZ/ws', '/rooms/nope/ws', '/rooms/%E0%A4%A/ws']) {
      const { close } = await refused(path)
      expect([close.code, close.reason]).toEqual([4404, 'Room not found'])
    }
    const pre = await exports.default.fetch(`${BASE}/rooms`, { method: 'OPTIONS' })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('creates a room, two clients join, add + play broadcast to both', async () => {
    const { code, hostSecret } = await createRoom()
    expect(code).toMatch(/^[A-Z2-9]{6}$/)
    expect(hostSecret).toMatch(/^[0-9a-f]{64}$/)

    const host = await connect(code, hostSecret)
    host.send({ type: 'hello', name: 'Host', canPlay: both })
    const hw = await host.next('welcome')
    if (hw.type !== 'welcome') throw new Error('expected welcome')
    expect(hw.state.participants).toEqual([
      { id: hw.you, name: 'Host', isHost: true, canPlay: both }
    ])
    expect(JSON.stringify(hw)).not.toContain(hostSecret)

    const guest = await connect(code)
    guest.send({ type: 'hello', name: '  Guest\u0000 ', canPlay: both })
    const gw = await guest.next('welcome')
    if (gw.type !== 'welcome') throw new Error('expected welcome')
    expect(gw.state.participants.map((p) => [p.name, p.isHost])).toEqual([
      ['Host', true],
      ['Guest', false]
    ])
    const joined = await host.next('state')
    expect(joined.type === 'state' && joined.state.participants).toHaveLength(2)

    // Guests can add but not play.
    guest.send({ type: 'command', command: { type: 'add', tracks: [track] } })
    const a1 = await host.next('state')
    const a2 = await guest.next('state')
    expect(a1).toEqual(a2)
    if (a1.type !== 'state') throw new Error('expected state')
    expect(a1.state.queue[0]!.addedBy).toBe(gw.you)
    expect(a1.state.currentIndex).toBe(-1)

    guest.send({ type: 'command', command: { type: 'play', index: 0 } })
    expect(await guest.next('error')).toMatchObject({ message: expect.stringMatching(/host/) })

    host.send({ type: 'command', command: { type: 'play', index: 0 } })
    const p1 = await host.next('state')
    const p2 = await guest.next('state')
    expect(p1).toEqual(p2)
    if (p1.type !== 'state') throw new Error('expected state')
    expect(p1.state).toMatchObject({ currentIndex: 0, playing: true })
    expect(p1.state.version).toBeGreaterThan(a1.state.version)

    guest.send({ type: 'ping', t: 42 })
    expect(await guest.next('pong')).toMatchObject({ t: 42, serverTime: expect.any(Number) })

    guest.send('{not json')
    expect(await guest.next('error')).toMatchObject({ type: 'error' })

    // Guest leaves: host sees them removed.
    guest.ws.close(1000, 'bye')
    const left = await host.next('state')
    expect(left.type === 'state' && left.state.participants).toHaveLength(1)

    // End: everyone gets closed and the room is gone.
    host.send({ type: 'command', command: { type: 'end' } })
    expect(await host.next('closed')).toEqual({ type: 'closed', reason: 'The host ended the Jam.' })
    await host.closed
    const after = await refused(`/rooms/${code}/ws`)
    expect(after.close.code).toBe(4404)
  })

  it('refuses a wrong host key with 4403', async () => {
    const { code } = await createRoom()
    const { close } = await refused(`/rooms/${code}/ws?secret=${'0'.repeat(64)}`)
    expect([close.code, close.reason]).toEqual([4403, 'Wrong host key'])
  })

  it('refuses guests past the participant limit with an error frame and 4409', async () => {
    const { code, hostSecret } = await createRoom()
    const host = await connect(code, hostSecret)
    host.send({ type: 'hello', name: 'H', canPlay: both })
    await host.next('welcome')
    const guests: Client[] = []
    for (let i = 1; i < JAM_LIMITS.participants; i++) {
      const g = await connect(code)
      g.send({ type: 'hello', name: `G${i}`, canPlay: both })
      await g.next('welcome')
      guests.push(g)
    }
    const { errors, close } = await refused(`/rooms/${code}/ws`)
    expect([close.code, close.reason]).toEqual([4409, 'Room is full'])
    expect(errors[0]).toMatch(/full/)
    host.send({ type: 'command', command: { type: 'end' } })
    await Promise.all(guests.map((g) => g.closed))
  })

  it('restores room state and sockets after the object is evicted (hibernation)', async () => {
    const { code, hostSecret } = await createRoom()
    const host = await connect(code, hostSecret)
    host.send({ type: 'hello', name: 'H', canPlay: both })
    const hw = await host.next('welcome')
    host.send({ type: 'command', command: { type: 'add', tracks: [track, track] } })
    const added = await host.next('state')
    if (added.type !== 'state' || hw.type !== 'welcome') throw new Error('unexpected frames')

    await evictDurableObject(env.JAM_ROOM.getByName(code))

    host.send({ type: 'command', command: { type: 'play', index: 1 } })
    const played = await host.next('state')
    if (played.type !== 'state') throw new Error('expected state')
    expect(played.state.queue).toHaveLength(2)
    expect(played.state.participants.map((p) => p.id)).toEqual([hw.you])
    expect(played.state).toMatchObject({ currentIndex: 1, playing: true })
    expect(played.state.version).toBe(added.state.version + 1)
    host.send({ type: 'command', command: { type: 'end' } })
    await host.next('closed')
  })

  it('closes a socket that sends something other than hello first', async () => {
    const { code } = await createRoom()
    const c = await connect(code)
    c.send({ type: 'ping', t: 1 })
    expect(await c.next('error')).toMatchObject({ message: 'Say hello first.' })
    expect((await c.closed).code).toBe(1008)
  })

  it('closes the room for guests when the host does not come back', async () => {
    const { code, hostSecret } = await createRoom()
    const host = await connect(code, hostSecret)
    host.send({ type: 'hello', name: 'H', canPlay: both })
    await host.next('welcome')
    const guest = await connect(code)
    guest.send({ type: 'hello', name: 'G', canPlay: both })
    await guest.next('welcome')
    await host.next('state')
    host.ws.close(1000, 'bye')
    await host.closed

    // Pretend the grace period passed: move hostAwaySince back and fire the alarm.
    const stub = env.JAM_ROOM.getByName(code)
    await runInDurableObject(stub, async (instance) => {
      const room = (instance as unknown as { room: { hostAwaySince: number | null } }).room
      // The close handler runs asynchronously; wait for it to mark the host away.
      for (let i = 0; i < 50 && room.hostAwaySince === null; i++) {
        await new Promise((r) => setTimeout(r, 10))
      }
      expect(room.hostAwaySince).not.toBeNull()
      room.hostAwaySince = Date.now() - 6 * 60_000
    })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await guest.next('closed')).toEqual({ type: 'closed', reason: 'The host left.' })
  })
})
