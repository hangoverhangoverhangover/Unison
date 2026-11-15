import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/types'
import { openDb, type Db } from '../db'
import { clampLimit, createHistoryStore, type HistoryStore } from './store'
import { createThrottle } from './throttle'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0)

let db: Db
let store: HistoryStore
beforeEach(() => {
  db = openDb(':memory:')
  store = createHistoryStore(db, () => NOW)
})
afterEach(() => db.close())

function sc(n: string, extra: Partial<Track> = {}): Track {
  return {
    id: `soundcloud:${n}`,
    provider: 'soundcloud',
    nativeId: n,
    title: `Track ${n}`,
    artists: ['Artist'],
    durationMs: 180_000,
    ...extra
  }
}

function play(track: Track, startedAt: number, playedMs = 60_000): void {
  expect(store.record({ track, playedMs, startedAt })).toBe(true)
}

const playCount = (): number => db.prepare('SELECT COUNT(*) FROM plays').pluck().get() as number

describe('history record', () => {
  it('rejects bad reports', () => {
    const t = sc('1')
    const bad: unknown[] = [
      null,
      { track: { ...t, id: 'soundcloud:2' }, playedMs: 1, startedAt: NOW },
      { track: { ...t, provider: 'tidal' }, playedMs: 1, startedAt: NOW },
      { track: { ...t, artists: [1] }, playedMs: 1, startedAt: NOW },
      { track: t, playedMs: -1, startedAt: NOW },
      { track: t, playedMs: Infinity, startedAt: NOW },
      { track: t, playedMs: 1, startedAt: NaN },
      { track: t, playedMs: 1, startedAt: '2026' }
    ]
    for (const r of bad) expect(() => store.record(r)).toThrow()
    expect(playCount()).toBe(0)
  })

  it('upserts service tracks and stores the play', () => {
    const t = sc('1', { artworkUrl: 'https://img/1.jpg', title: 'Old' })
    play(t, NOW - 1000, 1234.6)
    play({ ...t, title: 'New' }, NOW)
    const row = db.prepare('SELECT * FROM plays ORDER BY id LIMIT 1').get() as Record<
      string,
      unknown
    >
    expect(row).toMatchObject({
      track_id: 'soundcloud:1',
      provider: 'soundcloud',
      played_at: new Date(NOW - 1000).toISOString(),
      played_ms: 1235
    })
    expect(db.prepare('SELECT title FROM tracks WHERE id = ?').pluck().get(t.id)).toBe('New')
  })

  it('skips local tracks without a row, stores ones with a row', () => {
    const local: Track = {
      id: 'local:abc',
      provider: 'local',
      nativeId: 'abc',
      title: 'Song',
      artists: ['Me'],
      durationMs: 1000
    }
    expect(store.record({ track: local, playedMs: 10, startedAt: NOW })).toBe(false)
    expect(playCount()).toBe(0)
    db.prepare(
      `INSERT INTO tracks (id, provider, native_id, title, artists) VALUES ('local:abc', 'local', 'abc', 'Song', '["Me"]')`
    ).run()
    expect(store.record({ track: local, playedMs: 10, startedAt: NOW })).toBe(true)
    expect(playCount()).toBe(1)
  })
})

describe('history recent', () => {
  it('returns newest first, clamps the limit and drops orphans', () => {
    for (let i = 0; i < 5; i++) play(sc(String(i)), NOW - (5 - i) * 1000)
    db.prepare(
      `INSERT INTO plays (track_id, provider, played_at, played_ms) VALUES ('soundcloud:gone', 'soundcloud', ?, 1)`
    ).run(new Date(NOW).toISOString())
    const all = store.recent(100)
    expect(all.map((p) => p.track.id)).toEqual([4, 3, 2, 1, 0].map((i) => `soundcloud:${i}`))
    expect(all[0]!.playedAt).toBe(new Date(NOW - 1000).toISOString())
    expect(store.recent(2)).toHaveLength(2)
    expect(store.recent(0)).toHaveLength(1)
    expect(clampLimit(10_000)).toBe(500)
    expect(clampLimit(2.9)).toBe(2)
    expect(clampLimit('x')).toBe(50)
  })
})

describe('smart playlists', () => {
  it('recent: distinct tracks by last play', () => {
    play(sc('a'), NOW - 3000)
    play(sc('b'), NOW - 2000)
    play(sc('a'), NOW - 1000)
    const p = store.smart('recent')
    expect(p).toMatchObject({ kind: 'recent', name: 'Recently played' })
    expect(p.description).toBeTruthy()
    expect(p.tracks.map((t) => t.id)).toEqual(['soundcloud:a', 'soundcloud:b'])
  })

  it('on repeat: 3+ plays in 30 days, most played then most recent', () => {
    for (let i = 0; i < 4; i++) play(sc('many'), NOW - (10 + i) * DAY)
    for (let i = 0; i < 3; i++) play(sc('three-old'), NOW - (20 + i) * DAY)
    for (let i = 0; i < 3; i++) play(sc('three-new'), NOW - (1 + i) * DAY)
    play(sc('two'), NOW - DAY)
    play(sc('two'), NOW - DAY)
    // Plays outside the window don't count.
    play(sc('stale'), NOW - 2 * DAY)
    play(sc('stale'), NOW - 3 * DAY)
    play(sc('stale'), NOW - 31 * DAY)
    const p = store.smart('on-repeat')
    expect(p.name).toBe('On repeat')
    expect(p.tracks.map((t) => t.nativeId)).toEqual(['many', 'three-new', 'three-old'])
  })

  it('forgotten: 5+ plays all-time, none in 60 days', () => {
    for (let i = 0; i < 6; i++) play(sc('six'), NOW - (100 + i) * DAY)
    for (let i = 0; i < 5; i++) play(sc('five'), NOW - (61 + i) * DAY)
    for (let i = 0; i < 4; i++) play(sc('four'), NOW - (100 + i) * DAY)
    for (let i = 0; i < 5; i++) play(sc('recent'), NOW - (100 + i) * DAY)
    play(sc('recent'), NOW - 59 * DAY)
    const p = store.smart('forgotten')
    expect(p.name).toBe('Forgotten favourites')
    expect(p.tracks.map((t) => t.nativeId)).toEqual(['six', 'five'])
  })

  it('rejects an unknown kind', () => {
    expect(() => store.smart('nope')).toThrow()
  })
})

describe('stats', () => {
  it('counts per range, source and artist', () => {
    const duo = sc('duo', {
      artists: ['Alpha', 'Beta'],
      artistRefs: [
        { id: 'soundcloud:1', name: 'Alpha' },
        { id: 'soundcloud:2', name: 'Beta' }
      ],
      artworkUrl: 'https://img/duo.jpg'
    })
    const solo: Track = {
      id: 'spotify:solo',
      provider: 'spotify',
      nativeId: 'solo',
      title: 'Solo',
      artists: ['alpha'],
      durationMs: 1000
    }
    play(duo, NOW - DAY, 100)
    play(duo, NOW - 2 * DAY, 100)
    play(solo, NOW - 3 * DAY, 50)
    play(solo, NOW - 20 * DAY, 50)
    play(sc('old', { artists: ['Gamma'] }), NOW - 200 * DAY, 10)
    play(sc('ancient', { artists: ['Gamma'] }), NOW - 400 * DAY, 10)

    const week = store.stats('week')
    expect(week).toMatchObject({
      range: 'week',
      totalPlays: 3,
      totalMs: 250,
      bySource: { spotify: 1, soundcloud: 2, local: 0 }
    })
    expect(week.topArtists).toEqual([
      {
        name: 'Alpha',
        plays: 3,
        playedMs: 250,
        artworkUrl: 'https://img/duo.jpg',
        artistId: 'soundcloud:1'
      },
      {
        name: 'Beta',
        plays: 2,
        playedMs: 200,
        artworkUrl: 'https://img/duo.jpg',
        artistId: 'soundcloud:2'
      }
    ])
    expect(week.topTracks.map((t) => [t.track.id, t.plays, t.playedMs])).toEqual([
      ['soundcloud:duo', 2, 200],
      ['spotify:solo', 1, 50]
    ])

    expect(store.stats('month').totalPlays).toBe(4)
    expect(store.stats('year').totalPlays).toBe(5)
    const all = store.stats('all')
    expect(all.totalPlays).toBe(6)
    expect(all.topArtists.find((a) => a.name === 'Gamma')).toMatchObject({ plays: 2 })
    expect(() => store.stats('decade')).toThrow()
  })

  it('ties top tracks by listening time', () => {
    play(sc('short'), NOW - 1000, 10)
    play(sc('long'), NOW - 2000, 99)
    expect(store.stats('all').topTracks.map((t) => t.track.nativeId)).toEqual(['long', 'short'])
  })
})

describe('clear', () => {
  it('deletes every play but keeps tracks', () => {
    play(sc('1'), NOW)
    store.clear()
    expect(playCount()).toBe(0)
    expect(store.recent(10)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) FROM tracks').pluck().get()).toBe(1)
  })
})

describe('throttle', () => {
  it('runs at once, then once at the end of the window', () => {
    vi.useFakeTimers()
    try {
      let t = 0
      const fn = vi.fn()
      const th = createThrottle(fn, 2000, () => t)
      th.fire()
      expect(fn).toHaveBeenCalledTimes(1)
      t = 500
      th.fire()
      th.fire()
      expect(fn).toHaveBeenCalledTimes(1)
      t = 2000
      vi.advanceTimersByTime(1500)
      expect(fn).toHaveBeenCalledTimes(2)
      th.fire()
      th.cancel()
      vi.advanceTimersByTime(5000)
      expect(fn).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
