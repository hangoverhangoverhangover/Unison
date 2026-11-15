import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import * as Q from './queue'

function track(n: number | string): Track {
  return {
    id: `local:${n}`,
    provider: 'local',
    nativeId: String(n),
    title: `Track ${n}`,
    artists: ['A'],
    durationMs: 1000
  }
}
const tracks = (...ns: Array<number | string>): Track[] => ns.map(track)

function seqUid(): () => string {
  let i = 0
  return () => `u${++i}`
}

/** Deterministic LCG in [0, 1). */
function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const ids = (items: { track: Track }[]): string[] => items.map((i) => i.track.nativeId)
const cur = (s: Q.QueueState | null): string | undefined => s?.current?.track.nativeId

function deps(seed = 1): Q.QueueDeps {
  return { uid: seqUid(), rng: seededRng(seed) }
}

describe('playTracks', () => {
  it('sets current to startIndex and upcoming to the tracks after it', () => {
    const s = Q.playTracks(Q.emptyQueue, tracks(1, 2, 3, 4), 1, deps())
    expect(cur(s)).toBe('2')
    expect(ids(s.upcoming)).toEqual(['3', '4'])
    expect(s.history).toEqual([])
  })

  it('clamps the start index and handles empty input', () => {
    expect(cur(Q.playTracks(Q.emptyQueue, tracks(1, 2), 9, deps()))).toBe('2')
    expect(cur(Q.playTracks(Q.emptyQueue, tracks(1, 2), -3, deps()))).toBe('1')
    const empty = Q.playTracks(Q.emptyQueue, [], 0, deps())
    expect(empty.current).toBeNull()
    expect(empty.upcoming).toEqual([])
  })

  it('replaces the previous context and history', () => {
    const d = deps()
    let s = Q.playTracks(Q.emptyQueue, tracks(1, 2), 0, d)
    s = Q.next(s, 'off', d)!
    s = Q.playTracks(s, tracks(7, 8), 0, d)
    expect(cur(s)).toBe('7')
    expect(ids(s.upcoming)).toEqual(['8'])
    expect(s.history).toEqual([])
  })

  it('gives duplicate tracks distinct uids', () => {
    const s = Q.playTracks(Q.emptyQueue, [track(1), track(1), track(1)], 0)
    const uids = [s.current!.uid, ...s.upcoming.map((i) => i.uid)]
    expect(new Set(uids).size).toBe(3)
    const s2 = Q.addToQueue(s, [track(1)])
    expect(new Set([...uids, s2.upcoming[2]!.uid]).size).toBe(4)
  })

  it('shuffles the upcoming items when shuffle is on, keeping current', () => {
    const on = Q.setShuffle(Q.emptyQueue, true)
    const s = Q.playTracks(on, tracks(1, 2, 3, 4, 5, 6), 0, deps(42))
    expect(cur(s)).toBe('1')
    expect(ids(s.upcoming).sort()).toEqual(['2', '3', '4', '5', '6'])
    expect(ids(s.upcoming)).not.toEqual(['2', '3', '4', '5', '6'])
    const off = Q.setShuffle(s, false)
    expect(ids(off.upcoming)).toEqual(['2', '3', '4', '5', '6'])
  })
})

describe('next / previous', () => {
  it('advances through upcoming and records history', () => {
    const d = deps()
    let s: Q.QueueState | null = Q.playTracks(Q.emptyQueue, tracks(1, 2, 3), 0, d)
    s = Q.next(s, 'off', d)
    expect(cur(s)).toBe('2')
    expect(ids(s!.history)).toEqual(['1'])
    s = Q.next(s!, 'off', d)
    expect(cur(s)).toBe('3')
    expect(ids(s!.upcoming)).toEqual([])
  })

  it('returns null at the end with repeat off and repeat one', () => {
    const d = deps()
    const s = Q.playTracks(Q.emptyQueue, tracks(1), 0, d)
    expect(Q.next(s, 'off', d)).toBeNull()
    expect(Q.next(s, 'one', d)).toBeNull()
  })

  it('repeat one still advances when there is something upcoming (user next)', () => {
    const d = deps()
    const s = Q.playTracks(Q.emptyQueue, tracks(1, 2), 0, d)
    expect(cur(Q.next(s, 'one', d))).toBe('2')
  })

  it('wraps to the start of the play order with repeat all', () => {
    const d = deps()
    let s = Q.playTracks(Q.emptyQueue, tracks(1, 2, 3), 0, d)
    s = Q.next(Q.next(s, 'all', d)!, 'all', d)!
    const wrapped = Q.next(s, 'all', d)!
    expect(cur(wrapped)).toBe('1')
    expect(ids(wrapped.upcoming)).toEqual(['2', '3'])
    expect(wrapped.history).toEqual([])
  })

  it('wraps a single track onto itself with repeat all', () => {
    const d = deps()
    const s = Q.playTracks(Q.emptyQueue, tracks(1), 0, d)
    const w = Q.next(s, 'all', d)!
    expect(w.current).toBe(s.current)
  })

  it('reshuffles on wrap when shuffled', () => {
    const d = deps(7)
    let s = Q.playTracks(Q.setShuffle(Q.emptyQueue, true), tracks(1, 2, 3, 4, 5), 0, d)
    while (s.upcoming.length) s = Q.next(s, 'all', d)!
    const w = Q.next(s, 'all', d)!
    expect([cur(w), ...ids(w.upcoming)].sort()).toEqual(['1', '2', '3', '4', '5'])
  })

  it('starts the first upcoming item when nothing is current', () => {
    const s = Q.addToQueue(Q.emptyQueue, tracks(1, 2), deps())
    const n = Q.next(s, 'off')!
    expect(cur(n)).toBe('1')
    expect(ids(n.upcoming)).toEqual(['2'])
    expect(Q.next(Q.emptyQueue, 'all')).toBeNull()
  })

  it('previous pops history and puts current back at the front', () => {
    const d = deps()
    let s = Q.playTracks(Q.emptyQueue, tracks(1, 2, 3), 0, d)
    s = Q.next(s, 'off', d)!
    const p = Q.previous(s)!
    expect(cur(p)).toBe('1')
    expect(ids(p.upcoming)).toEqual(['2', '3'])
    expect(p.history).toEqual([])
    expect(p.upcoming[0]).toBe(s.current)
  })

  it('previous returns null with no history', () => {
    expect(Q.previous(Q.playTracks(Q.emptyQueue, tracks(1, 2), 0))).toBeNull()
  })
})

describe('queue editing', () => {
  const base = (): Q.QueueState => Q.playTracks(Q.emptyQueue, tracks(1, 2, 3), 0, deps())

  it('playNext inserts at the front in the given order', () => {
    const s = Q.playNext(base(), tracks('a', 'b'))
    expect(ids(s.upcoming)).toEqual(['a', 'b', '2', '3'])
  })

  it('addToQueue appends', () => {
    const s = Q.addToQueue(base(), tracks('a', 'b'))
    expect(ids(s.upcoming)).toEqual(['2', '3', 'a', 'b'])
  })

  it('playNext vs addToQueue ordering when combined', () => {
    let s = Q.addToQueue(base(), tracks('z'))
    s = Q.playNext(s, tracks('a'))
    s = Q.playNext(s, tracks('b'))
    expect(ids(s.upcoming)).toEqual(['b', 'a', '2', '3', 'z'])
  })

  it('move reorders upcoming and ignores bad indexes', () => {
    const s = Q.addToQueue(base(), tracks(4, 5))
    expect(ids(Q.move(s, 0, 3).upcoming)).toEqual(['3', '4', '5', '2'])
    expect(ids(Q.move(s, 3, 0).upcoming)).toEqual(['5', '2', '3', '4'])
    expect(Q.move(s, 0, 9)).toBe(s)
    expect(Q.move(s, -1, 0)).toBe(s)
    expect(Q.move(s, 1, 1)).toBe(s)
  })

  it('remove drops one entry by uid, even among duplicates', () => {
    const s = Q.addToQueue(base(), [track(2)])
    const dupUid = s.upcoming[2]!.uid
    const r = Q.remove(s, dupUid)
    expect(ids(r.upcoming)).toEqual(['2', '3'])
    expect(r.upcoming.some((i) => i.uid === dupUid)).toBe(false)
    expect(Q.remove(s, 'nope')).toBe(s)
    expect(Q.remove(s, s.current!.uid)).toBe(s)
  })

  it('clear empties upcoming only', () => {
    const d = deps()
    let s = Q.playTracks(Q.emptyQueue, tracks(1, 2, 3), 0, d)
    s = Q.next(s, 'off', d)!
    const c = Q.clear(s)
    expect(c.upcoming).toEqual([])
    expect(cur(c)).toBe('2')
    expect(ids(c.history)).toEqual(['1'])
  })

  it('never mutates the input state', () => {
    const s = Q.addToQueue(base(), tracks(4))
    const snapshot = JSON.stringify(s)
    Q.move(s, 0, 2)
    Q.playNext(s, tracks('x'))
    Q.remove(s, s.upcoming[0]!.uid)
    Q.setShuffle(s, true, deps())
    Q.next(s, 'all')
    Q.clear(s)
    expect(JSON.stringify(s)).toBe(snapshot)
  })
})

describe('shuffle', () => {
  const ordered = ['2', '3', '4', '5', '6', '7', '8']
  const start = (): Q.QueueState =>
    Q.playTracks(Q.emptyQueue, tracks(1, 2, 3, 4, 5, 6, 7, 8), 0, { uid: seqUid() })

  it('shuffles upcoming deterministically with a seeded rng', () => {
    const a = Q.setShuffle(start(), true, { rng: seededRng(3) })
    const b = Q.setShuffle(start(), true, { rng: seededRng(3) })
    expect(ids(a.upcoming)).toEqual(ids(b.upcoming))
    expect(ids(a.upcoming)).not.toEqual(ordered)
    expect(ids(a.upcoming).sort()).toEqual(ordered)
    expect(cur(a)).toBe('1')
    expect(a.shuffle).toBe(true)
  })

  it('shuffle off restores the original order', () => {
    const on = Q.setShuffle(start(), true, { rng: seededRng(9) })
    const off = Q.setShuffle(on, false)
    expect(ids(off.upcoming)).toEqual(ordered)
    expect(off.shuffle).toBe(false)
  })

  it('restores the order of only the items still upcoming', () => {
    let s = Q.setShuffle(start(), true, { rng: seededRng(5) })
    const played = [s.upcoming[0]!.track.nativeId, s.upcoming[1]!.track.nativeId]
    s = Q.next(Q.next(s, 'off')!, 'off')!
    const off = Q.setShuffle(s, false)
    expect(ids(off.upcoming)).toEqual(ordered.filter((id) => !played.includes(id)))
  })

  it('keeps items added while shuffled, at the end of the restored order', () => {
    let s = Q.setShuffle(start(), true, { rng: seededRng(11) })
    s = Q.addToQueue(s, tracks('x', 'y'))
    const off = Q.setShuffle(s, false)
    expect(ids(off.upcoming)).toEqual([...ordered, 'x', 'y'])
  })

  it('keeps playNext items at the front when shuffle turns off', () => {
    let s = Q.setShuffle(start(), true, { rng: seededRng(13) })
    s = Q.playNext(s, tracks('a', 'b'))
    expect(ids(s.upcoming).slice(0, 2)).toEqual(['a', 'b'])
    const off = Q.setShuffle(s, false)
    expect(ids(off.upcoming)).toEqual(['a', 'b', ...ordered])
  })

  it('respects items reordered before shuffling', () => {
    let s = Q.move(start(), 0, 6) // 3 4 5 6 7 8 2
    s = Q.setShuffle(s, true, { rng: seededRng(2) })
    expect(ids(Q.setShuffle(s, false).upcoming)).toEqual(['3', '4', '5', '6', '7', '8', '2'])
  })

  it('setShuffle to the same value is a no-op', () => {
    const s = start()
    expect(Q.setShuffle(s, false)).toBe(s)
  })

  it('shuffleItems is a permutation', () => {
    const out = Q.shuffleItems([1, 2, 3, 4, 5], seededRng(1))
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
  })
})
