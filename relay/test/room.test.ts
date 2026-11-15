import { describe, expect, it } from 'vitest'
import {
  JAM_CODE_ALPHABET,
  JAM_CODE_LENGTH,
  JAM_LIMITS,
  type JamCommand,
  type JamParticipant,
  type JamRoomState,
  type JamTrack
} from '../../src/shared/jam'
import {
  addParticipant,
  applyCommand,
  createRoomState,
  frameBytes,
  generateCode,
  generateSecret,
  isValidCode,
  parseClientMessage,
  rateCheck,
  removeParticipant,
  safeEqual,
  sanitizeName,
  setCapabilities,
  stripControl,
  validateTrack,
  type ApplyResult
} from '../src/room'

const NOW = 1_000_000

function track(n: number, provider: 'spotify' | 'soundcloud' = 'spotify'): JamTrack {
  return {
    id: `${provider}:t${n}`,
    provider,
    nativeId: `t${n}`,
    title: `Track ${n}`,
    artists: ['Artist'],
    durationMs: 180_000
  }
}

const both = { spotify: true, soundcloud: true }

function person(id: string, isHost = false, canPlay = both, name = id): JamParticipant {
  return { id, name, isHost, canPlay }
}

let idSeq = 0
const deps = { newId: () => `e${++idSeq}` }

function room(opts: { tracks?: number; current?: number; playing?: boolean } = {}): JamRoomState {
  let s = createRoomState('ABCDEF', NOW)
  s = { ...s, participants: [person('host', true), person('guest')] }
  const n = opts.tracks ?? 0
  s = {
    ...s,
    queue: Array.from({ length: n }, (_, i) => ({
      entryId: `q${i}`,
      track: track(i),
      addedBy: 'host'
    })),
    currentIndex: opts.current ?? -1,
    playing: opts.playing ?? false
  }
  return s
}

function ok(r: ApplyResult): JamRoomState {
  if (!('state' in r)) throw new Error(`expected state, got ${JSON.stringify(r)}`)
  return r.state
}

function err(r: ApplyResult): string {
  if (!('error' in r)) throw new Error(`expected error, got ${JSON.stringify(r)}`)
  return r.error
}

const run = (s: JamRoomState, cmd: JamCommand, who = 'host', now = NOW + 5): ApplyResult =>
  applyCommand(s, who, cmd, now, deps)

describe('codes and secrets', () => {
  it('codes use the alphabet and length', () => {
    for (let i = 0; i < 500; i++) {
      const c = generateCode()
      expect(c).toHaveLength(JAM_CODE_LENGTH)
      for (const ch of c) expect(JAM_CODE_ALPHABET).toContain(ch)
      expect(isValidCode(c)).toBe(true)
    }
  })

  it('codes skip biased bytes (rejection sampling)', () => {
    // 248+ would bias the modulo for a 31-char alphabet and must be skipped.
    const fill = (b: Uint8Array): Uint8Array => {
      b.fill(255)
      b[3] = 0
      b[5] = 1
      b[7] = 2
      b[9] = 30
      b[10] = 31
      b[11] = 247
      return b
    }
    expect(generateCode(fill)).toBe(
      JAM_CODE_ALPHABET[0]! +
        JAM_CODE_ALPHABET[1] +
        JAM_CODE_ALPHABET[2] +
        JAM_CODE_ALPHABET[30] +
        JAM_CODE_ALPHABET[0] +
        JAM_CODE_ALPHABET[247 % 31]
    )
  })

  it('rejects malformed codes', () => {
    expect(isValidCode('abcdef')).toBe(false)
    expect(isValidCode('ABCDE')).toBe(false)
    expect(isValidCode('ABCDEFG')).toBe(false)
    expect(isValidCode('ABCDE0')).toBe(false) // 0 is a look-alike
    expect(isValidCode('ABCDEI')).toBe(false)
  })

  it('secrets are 32 random bytes in hex', () => {
    const s = generateSecret()
    expect(s).toMatch(/^[0-9a-f]{64}$/)
    expect(generateSecret()).not.toBe(s)
  })

  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('names and text', () => {
  it('trims, strips control characters and cuts to nameLength', () => {
    expect(sanitizeName('  Al\u0000ex\n ')).toBe('Alex')
    expect(sanitizeName('x'.repeat(100))).toHaveLength(JAM_LIMITS.nameLength)
    expect(sanitizeName('\u0007\u0008')).toBe('Guest')
    expect(sanitizeName(42)).toBe('Guest')
    expect(stripControl('a\u009fb\u007fc')).toBe('abc')
  })

  it('does not split surrogate pairs when cutting', () => {
    const name = sanitizeName('\u{1F3B5}'.repeat(50))
    expect(Array.from(name)).toHaveLength(JAM_LIMITS.nameLength)
  })
})

describe('validateTrack', () => {
  it('accepts a good track and drops unknown fields', () => {
    const t = validateTrack({ ...track(1), extra: 'x', url: 'https://open.spotify.com/x' })
    expect(t).toEqual({ ...track(1), url: 'https://open.spotify.com/x' })
  })

  it.each([
    ['provider', { provider: 'local' }],
    ['id mismatch', { id: 'spotify:other' }],
    ['empty nativeId', { nativeId: '', id: 'spotify:' }],
    ['long title', { title: 'x'.repeat(501) }],
    ['too many artists', { artists: Array(21).fill('a') }],
    ['non-string artist', { artists: [1] }],
    ['negative duration', { durationMs: -1 }],
    ['infinite duration', { durationMs: Infinity }],
    ['NaN duration', { durationMs: NaN }],
    ['http artwork', { artworkUrl: 'http://x.com/a.jpg' }],
    ['file url', { url: 'file:///C:/x.mp3' }],
    ['bad url', { url: 'not a url' }],
    ['long isrc', { isrc: 'x'.repeat(501) }]
  ])('rejects %s', (_, patch) => {
    expect(typeof validateTrack({ ...track(1), ...patch })).toBe('string')
  })

  it('rejects non-objects', () => {
    expect(typeof validateTrack(null)).toBe('string')
    expect(typeof validateTrack([track(1)])).toBe('string')
  })

  it('strips control characters from the title', () => {
    const t = validateTrack({ ...track(1), title: 'A\u0000B' })
    expect(typeof t !== 'string' && t.title).toBe('AB')
  })
})

describe('parseClientMessage', () => {
  it('parses hello and sanitises the name', () => {
    const r = parseClientMessage(JSON.stringify({ type: 'hello', name: ' Bo ', canPlay: both }))
    expect(r).toEqual({ message: { type: 'hello', name: 'Bo', canPlay: both } })
  })

  it('errors on bad JSON, binary frames and unknown types', () => {
    expect(parseClientMessage('{nope')).toHaveProperty('error')
    expect(parseClientMessage(new ArrayBuffer(4))).toHaveProperty('error')
    expect(parseClientMessage('{"type":"wat"}')).toHaveProperty('error')
    expect(parseClientMessage('[]')).toHaveProperty('error')
    expect(parseClientMessage('{"type":"hello","name":"x"}')).toHaveProperty('error')
  })

  it('shape-checks commands', () => {
    const cmd = (c: unknown): unknown =>
      parseClientMessage(JSON.stringify({ type: 'command', command: c }))
    expect(cmd({ type: 'play', index: 1.5 })).toHaveProperty('error')
    expect(cmd({ type: 'play', index: -1 })).toHaveProperty('error')
    expect(cmd({ type: 'seek', positionMs: 'x' })).toHaveProperty('error')
    expect(cmd({ type: 'move', entryId: 'a', toIndex: -2 })).toHaveProperty('error')
    expect(cmd({ type: 'setBlockUnplayable', on: 'yes' })).toHaveProperty('error')
    expect(cmd({ type: 'nuke' })).toHaveProperty('error')
    expect(cmd({ type: 'play', index: 2, junk: 1 })).toEqual({
      message: { type: 'command', command: { type: 'play', index: 2 } }
    })
    expect(cmd({ type: 'next' })).toEqual({
      message: { type: 'command', command: { type: 'next' } }
    })
  })

  it('parses ping and capabilities', () => {
    expect(parseClientMessage('{"type":"ping","t":5}')).toEqual({ message: { type: 'ping', t: 5 } })
    expect(
      parseClientMessage('{"type":"capabilities","canPlay":{"spotify":false}}')
    ).toHaveProperty('error')
  })

  it('measures frame bytes as UTF-8', () => {
    expect(frameBytes('abc')).toBe(3)
    expect(frameBytes('\u00e9')).toBe(2)
    expect(frameBytes(new ArrayBuffer(10))).toBe(10)
    expect(frameBytes('x'.repeat(JAM_LIMITS.frameBytes + 1))).toBeGreaterThan(JAM_LIMITS.frameBytes)
  })
})

describe('rateCheck', () => {
  it('allows commandsPer10s per window, then refuses, then recovers', () => {
    let log: number[] = []
    for (let i = 0; i < JAM_LIMITS.commandsPer10s; i++) {
      const r = rateCheck(log, NOW + i)
      expect(r.allowed).toBe(true)
      log = r.log
    }
    const refused = rateCheck(log, NOW + 100)
    expect(refused.allowed).toBe(false)
    expect(refused.log).toHaveLength(JAM_LIMITS.commandsPer10s)
    expect(rateCheck(refused.log, NOW + 10_000).allowed).toBe(true)
  })
})

describe('participants', () => {
  it('adds, replaces and removes with version bumps', () => {
    const s0 = createRoomState('ABCDEF', NOW)
    const added = addParticipant(s0, person('a'))
    if (!('state' in added)) throw new Error(added.error)
    const s1 = added.state
    expect(s1.participants).toHaveLength(1)
    expect(s1.version).toBe(s0.version + 1)
    const renamed = addParticipant(s1, person('a', false, both, 'Al'))
    expect('state' in renamed && renamed.state.participants).toEqual([
      person('a', false, both, 'Al')
    ])
    const s2 = removeParticipant(s1, 'a')
    expect(s2.participants).toHaveLength(0)
    expect(s2.version).toBe(s1.version + 1)
    expect(removeParticipant(s2, 'a')).toBe(s2)
  })

  it('refuses guests past the limit but never the host', () => {
    let s = createRoomState('ABCDEF', NOW)
    s = {
      ...s,
      participants: Array.from({ length: JAM_LIMITS.participants }, (_, i) => person(`g${i}`))
    }
    expect(addParticipant(s, person('late'))).toHaveProperty('error')
    expect(addParticipant(s, person('host', true))).toHaveProperty('state')
  })

  it('setCapabilities bumps only on change', () => {
    const s = room()
    expect(setCapabilities(s, 'guest', both)).toBe(s)
    const s2 = setCapabilities(s, 'guest', { spotify: false, soundcloud: true })
    expect(s2.version).toBe(s.version + 1)
    expect(s2.participants[1]!.canPlay.spotify).toBe(false)
    expect(setCapabilities(s, 'nobody', both)).toBe(s)
  })
})

describe('host-only enforcement', () => {
  const guestCmds: JamCommand[] = [
    { type: 'play', index: 0 },
    { type: 'pause', positionMs: 0 },
    { type: 'resume', positionMs: 0 },
    { type: 'seek', positionMs: 0 },
    { type: 'next' },
    { type: 'previous' },
    { type: 'remove', entryId: 'q0' },
    { type: 'move', entryId: 'q0', toIndex: 1 },
    { type: 'setBlockUnplayable', on: true },
    { type: 'ended', entryId: 'q0' },
    { type: 'end' }
  ]
  it.each(guestCmds.map((c) => [c.type, c] as const))('guest cannot %s', (_, c) => {
    expect(err(run(room({ tracks: 3, current: 0 }), c, 'guest'))).toMatch(/host/)
  })

  it('guest can add', () => {
    const s = ok(run(room(), { type: 'add', tracks: [track(9)] }, 'guest'))
    expect(s.queue[0]!.addedBy).toBe('guest')
  })

  it('strangers cannot do anything', () => {
    expect(err(run(room(), { type: 'add', tracks: [track(1)] }, 'nobody'))).toMatch(/not in/)
  })
})

describe('add', () => {
  it('appends with fresh entry ids, bumps version, does not auto-play', () => {
    const s0 = room()
    const s = ok(run(s0, { type: 'add', tracks: [track(1), track(1)] }))
    expect(s.queue).toHaveLength(2)
    expect(s.queue[0]!.entryId).not.toBe(s.queue[1]!.entryId)
    expect(s.version).toBe(s0.version + 1)
    expect(s.currentIndex).toBe(-1)
    expect(s.playing).toBe(false)
  })

  it('refuses empty adds, invalid tracks and a full queue', () => {
    expect(err(run(room(), { type: 'add', tracks: [] }))).toMatch(/Nothing/)
    expect(err(run(room(), { type: 'add', tracks: [{ ...track(1), durationMs: -5 }] }))).toMatch(
      /duration/
    )
    const full = room({ tracks: JAM_LIMITS.queue - 1 })
    expect(ok(run(full, { type: 'add', tracks: [track(1)] })).queue).toHaveLength(JAM_LIMITS.queue)
    expect(err(run(full, { type: 'add', tracks: [track(1), track(2)] }))).toMatch(/full/)
  })

  it('blockUnplayable refuses tracks someone cannot play and names them', () => {
    let s = room()
    s = {
      ...s,
      blockUnplayable: true,
      participants: [
        person('host', true),
        person('g1', false, { spotify: false, soundcloud: true }, 'Robin'),
        person('g2', false, { spotify: false, soundcloud: true }, 'Sam')
      ]
    }
    expect(err(run(s, { type: 'add', tracks: [track(1, 'spotify')] }))).toMatch(
      /Robin and Sam can't play Spotify/
    )
    expect(ok(run(s, { type: 'add', tracks: [track(1, 'soundcloud')] })).queue).toHaveLength(1)
    // Off: anything goes.
    expect(
      ok(run({ ...s, blockUnplayable: false }, { type: 'add', tracks: [track(1)] })).queue
    ).toHaveLength(1)
  })
})

describe('playback commands', () => {
  it('play sets index, playing, position and time', () => {
    const s = ok(
      run(room({ tracks: 3 }), { type: 'play', index: 2, positionMs: 1500 }, 'host', 777)
    )
    expect(s).toMatchObject({ currentIndex: 2, playing: true, positionMs: 1500, positionAt: 777 })
    expect(ok(run(room({ tracks: 3 }), { type: 'play', index: 0 })).positionMs).toBe(0)
    expect(err(run(room({ tracks: 3 }), { type: 'play', index: 3 }))).toBeTruthy()
  })

  it('pause, resume and seek', () => {
    const s0 = room({ tracks: 2, current: 0, playing: true })
    const p = ok(run(s0, { type: 'pause', positionMs: 10 }, 'host', 50))
    expect(p).toMatchObject({ playing: false, positionMs: 10, positionAt: 50 })
    const r = ok(run(p, { type: 'resume', positionMs: 11 }, 'host', 60))
    expect(r).toMatchObject({ playing: true, positionMs: 11, positionAt: 60 })
    const k = ok(run(r, { type: 'seek', positionMs: 90 }, 'host', 70))
    expect(k).toMatchObject({ playing: true, positionMs: 90, positionAt: 70 })
    expect(err(run(room({ tracks: 2 }), { type: 'resume', positionMs: 0 }))).toMatch(/Nothing/)
  })

  it('next moves on and stops at the end', () => {
    const s = ok(run(room({ tracks: 2, current: 0, playing: true }), { type: 'next' }))
    expect(s).toMatchObject({ currentIndex: 1, playing: true, positionMs: 0 })
    const end = ok(run(s, { type: 'next' }))
    expect(end).toMatchObject({ currentIndex: 1, playing: false })
    const empty = room()
    expect(ok(run(empty, { type: 'next' }))).toBe(empty)
  })

  it('previous moves back and stops at the start', () => {
    const s = ok(run(room({ tracks: 3, current: 2, playing: true }), { type: 'previous' }))
    expect(s).toMatchObject({ currentIndex: 1, playing: true, positionMs: 0 })
    const first = ok(run(room({ tracks: 3, current: 0, playing: true }), { type: 'previous' }))
    expect(first).toMatchObject({ currentIndex: 0, positionMs: 0 })
    const idle = room({ tracks: 3 })
    expect(ok(run(idle, { type: 'previous' }))).toBe(idle)
  })

  it('ended advances only for the current entry', () => {
    const s0 = room({ tracks: 3, current: 1, playing: true })
    expect(ok(run(s0, { type: 'ended', entryId: 'q0' }))).toBe(s0)
    expect(ok(run(s0, { type: 'ended', entryId: 'zzz' }))).toBe(s0)
    expect(ok(run(s0, { type: 'ended', entryId: 'q1' }))).toMatchObject({
      currentIndex: 2,
      playing: true
    })
    const last = room({ tracks: 3, current: 2, playing: true })
    expect(ok(run(last, { type: 'ended', entryId: 'q2' }))).toMatchObject({
      currentIndex: 2,
      playing: false
    })
    expect(ok(run(room(), { type: 'ended', entryId: 'q0' }))).toMatchObject({ currentIndex: -1 })
  })
})

describe('remove', () => {
  it('before the current entry keeps pointing at the same entry', () => {
    const s = ok(
      run(room({ tracks: 4, current: 2, playing: true }), { type: 'remove', entryId: 'q0' })
    )
    expect(s.currentIndex).toBe(1)
    expect(s.queue[s.currentIndex]!.entryId).toBe('q2')
  })

  it('after the current entry leaves the index alone', () => {
    const s = ok(run(room({ tracks: 4, current: 1 }), { type: 'remove', entryId: 'q3' }))
    expect(s.currentIndex).toBe(1)
    expect(s.queue).toHaveLength(3)
  })

  it('the current entry advances to the following one and keeps playing state', () => {
    const playing = ok(
      run(room({ tracks: 3, current: 1, playing: true }), { type: 'remove', entryId: 'q1' })
    )
    expect(playing).toMatchObject({ currentIndex: 1, playing: true, positionMs: 0 })
    expect(playing.queue[1]!.entryId).toBe('q2')
    const paused = ok(
      run(room({ tracks: 3, current: 1, playing: false }), { type: 'remove', entryId: 'q1' })
    )
    expect(paused).toMatchObject({ currentIndex: 1, playing: false })
  })

  it('the current last entry stops on the new last one; removing the only one empties', () => {
    const s = ok(
      run(room({ tracks: 3, current: 2, playing: true }), { type: 'remove', entryId: 'q2' })
    )
    expect(s).toMatchObject({ currentIndex: 1, playing: false })
    const one = ok(
      run(room({ tracks: 1, current: 0, playing: true }), { type: 'remove', entryId: 'q0' })
    )
    expect(one).toMatchObject({ currentIndex: -1, playing: false, queue: [] })
  })

  it('unknown entries are an error', () => {
    expect(err(run(room({ tracks: 1 }), { type: 'remove', entryId: 'nope' }))).toMatch(/not in/)
  })
})

describe('move', () => {
  const ids = (s: JamRoomState): string[] => s.queue.map((e) => e.entryId)

  it('reorders and keeps currentIndex on the same entry', () => {
    const s0 = room({ tracks: 5, current: 2, playing: true })
    const a = ok(run(s0, { type: 'move', entryId: 'q0', toIndex: 4 }))
    expect(ids(a)).toEqual(['q1', 'q2', 'q3', 'q4', 'q0'])
    expect(a.queue[a.currentIndex]!.entryId).toBe('q2')
    const b = ok(run(s0, { type: 'move', entryId: 'q4', toIndex: 0 }))
    expect(ids(b)).toEqual(['q4', 'q0', 'q1', 'q2', 'q3'])
    expect(b.queue[b.currentIndex]!.entryId).toBe('q2')
    const c = ok(run(s0, { type: 'move', entryId: 'q2', toIndex: 0 }))
    expect(c.currentIndex).toBe(0)
  })

  it('clamps toIndex, no-ops in place, errors on unknown ids, works with nothing playing', () => {
    const s0 = room({ tracks: 3 })
    expect(ids(ok(run(s0, { type: 'move', entryId: 'q0', toIndex: 99 })))).toEqual([
      'q1',
      'q2',
      'q0'
    ])
    expect(ok(run(s0, { type: 'move', entryId: 'q1', toIndex: 1 }))).toBe(s0)
    expect(err(run(s0, { type: 'move', entryId: 'x', toIndex: 0 }))).toMatch(/not in/)
    expect(ok(run(s0, { type: 'move', entryId: 'q0', toIndex: 2 })).currentIndex).toBe(-1)
  })
})

describe('settings and end', () => {
  it('setBlockUnplayable toggles and no-ops when unchanged', () => {
    const s0 = room()
    const s = ok(run(s0, { type: 'setBlockUnplayable', on: true }))
    expect(s.blockUnplayable).toBe(true)
    expect(s.version).toBe(s0.version + 1)
    expect(ok(run(s, { type: 'setBlockUnplayable', on: true }))).toBe(s)
  })

  it('end tells the caller to close the room', () => {
    expect(run(room(), { type: 'end' })).toEqual({ end: true })
  })

  it('every changing command bumps version by exactly one', () => {
    const s0 = room({ tracks: 3, current: 0, playing: true })
    const cmds: JamCommand[] = [
      { type: 'add', tracks: [track(7)] },
      { type: 'play', index: 1 },
      { type: 'pause', positionMs: 1 },
      { type: 'resume', positionMs: 1 },
      { type: 'seek', positionMs: 2 },
      { type: 'next' },
      { type: 'previous' },
      { type: 'remove', entryId: 'q2' },
      { type: 'move', entryId: 'q0', toIndex: 2 },
      { type: 'setBlockUnplayable', on: true },
      { type: 'ended', entryId: 'q0' }
    ]
    for (const c of cmds) expect(ok(run(s0, c)).version).toBe(s0.version + 1)
  })
})
