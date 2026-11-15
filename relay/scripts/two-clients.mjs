/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS script */
// Smoke test against a running relay: creates a room, connects a host and a guest,
// exchanges hello/add/play and checks both receive the state broadcasts, then ends the Jam.
//
//   npx wrangler dev            (in another terminal; serves http://localhost:8787)
//   node scripts/two-clients.mjs [relayUrl]
//
// Needs Node 22+ (global WebSocket). Prints message types and a few fields only.
const relay = (process.argv[2] ?? 'http://localhost:8787').replace(/\/+$/, '')
const wsBase = relay.replace(/^http/, 'ws')
const both = { spotify: true, soundcloud: true }
const track = {
  id: 'spotify:4uLU6hMCjMI75M1A2tKUQC',
  provider: 'spotify',
  nativeId: '4uLU6hMCjMI75M1A2tKUQC',
  title: 'Test Track',
  artists: ['Test Artist'],
  durationMs: 213000
}

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

// Refusals are accepted upgrades closed with an app code (4404, 4403, 4409).
function closeCode(url) {
  const ws = new WebSocket(url)
  return new Promise((resolve) =>
    ws.addEventListener('close', (e) => resolve(`${e.code} ${e.reason}`))
  )
}

function client(label, url) {
  const ws = new WebSocket(url)
  const inbox = []
  const waiters = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    console.log(`${label} <- ${m.type}${m.state ? ` v${m.state.version}` : ''}`)
    inbox.push(m)
    waiters.splice(0).forEach((w) => w())
  })
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', () => reject(new Error(`${label} could not connect`)))
  })
  const closed = new Promise((r) => ws.addEventListener('close', (e) => r(e)))
  async function next(type, ms = 5000) {
    const deadline = Date.now() + ms
    for (;;) {
      const i = inbox.findIndex((m) => m.type === type)
      if (i >= 0) return inbox.splice(i, 1)[0]
      if (Date.now() > deadline) fail(`${label} waited for ${type}`)
      await new Promise((r) => {
        waiters.push(r)
        setTimeout(r, 100)
      })
    }
  }
  function send(m) {
    console.log(`${label} -> ${m.type}${m.command ? `:${m.command.type}` : ''}`)
    ws.send(JSON.stringify(m))
  }
  return { ws, open, closed, next, send }
}

const res = await fetch(`${relay}/rooms`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}'
})
if (res.status !== 201) fail(`POST /rooms returned ${res.status}`)
const { code, hostSecret } = await res.json()
console.log(`room ${code} created (secret: ${hostSecret.length} hex chars, not shown)`)

const missing = await closeCode(`${wsBase}/rooms/ZZZZZZ/ws`)
console.log(`unknown room -> close ${missing}`)
if (missing !== '4404 Room not found') fail('unknown room should close 4404')
const wrongKey = await closeCode(`${wsBase}/rooms/${code}/ws?secret=nope`)
console.log(`wrong host key -> close ${wrongKey}`)
if (wrongKey !== '4403 Wrong host key') fail('wrong key should close 4403')

const host = client('host ', `${wsBase}/rooms/${code}/ws?secret=${hostSecret}`)
await host.open
host.send({ type: 'hello', name: 'Host', canPlay: both })
const hw = await host.next('welcome')
if (!hw.state.participants[0]?.isHost) fail('host is not host')

const guest = client('guest', `${wsBase}/rooms/${code}/ws`)
await guest.open
guest.send({ type: 'hello', name: 'Guest', canPlay: both })
const gw = await guest.next('welcome')
if (gw.state.participants.length !== 2) fail('guest welcome should list 2 people')
await host.next('state')

guest.send({ type: 'command', command: { type: 'add', tracks: [track] } })
const added = [await host.next('state'), await guest.next('state')]
if (added.some((m) => m.state.queue.length !== 1)) fail('add was not broadcast to both')

guest.send({ type: 'command', command: { type: 'play', index: 0 } })
const refused = await guest.next('error')
console.log(`guest play refused: "${refused.message}"`)

host.send({ type: 'command', command: { type: 'play', index: 0 } })
const played = [await host.next('state'), await guest.next('state')]
if (played.some((m) => !m.state.playing || m.state.currentIndex !== 0)) fail('play not broadcast')
if (played[0].state.version !== played[1].state.version) fail('versions differ')

const t = Date.now()
guest.send({ type: 'ping', t })
const pong = await guest.next('pong')
console.log(`pong: round trip ${Date.now() - t} ms, serverTime offset ~${pong.serverTime - t} ms`)

host.send({ type: 'command', command: { type: 'end' } })
const closedMsgs = [await host.next('closed'), await guest.next('closed')]
console.log(`closed reason: "${closedMsgs[0].reason}"`)
await Promise.all([host.closed, guest.closed])

const gone = await closeCode(`${wsBase}/rooms/${code}/ws`)
if (!gone.startsWith('4404')) fail(`ended room should close 4404, got ${gone}`)
console.log('PASS: two-client flow works')
