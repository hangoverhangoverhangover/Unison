import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { openDb, type Db } from '../db'
import { upsertServiceTracks } from '../db/tracks'
import {
  DISMISSED_KEY,
  DISMISSED_MAX,
  dismissDuplicate,
  findAlreadyIn,
  findDuplicateGroups,
  findDuplicates,
  groupKey,
  readDismissed
} from './duplicates'

const t = (id: string, title: string, artists: string[], extra: Partial<Track> = {}): Track => {
  const [provider, nativeId] = id.split(':') as [Track['provider'], string]
  return { id, provider, nativeId, title, artists, durationMs: 200_000, ...extra }
}

describe('findDuplicateGroups', () => {
  it('groups by isrc, exact and close', () => {
    const groups = findDuplicateGroups([
      t('spotify:1', 'One', ['A'], { isrc: 'USAAA2400001' }),
      t('local:1', 'Totally different tag', ['B'], { isrc: 'US-AAA-24-00001' }),
      t('spotify:2', 'Two (feat. Z)', ['Artist Two']),
      t('local:2', 'Two', ['artist two']),
      t('soundcloud:3', 'Three Little Birds', ['Bob Marley']),
      t('local:3', 'Three Little Birds (Live)', ['Bob Marley & The Wailers']),
      t('spotify:4', 'Lonely', ['Nobody'])
    ])
    expect(groups.map((g) => [g.confidence, g.tracks.map((x) => x.id)])).toEqual([
      ['isrc', ['spotify:1', 'local:1']],
      ['exact', ['spotify:2', 'local:2']],
      ['close', ['soundcloud:3', 'local:3']]
    ])
  })

  it('matches archive "Artist - Title" uploads to the plain title', () => {
    const groups = findDuplicateGroups([
      t('spotify:1', 'Flickermood', ['Forss']),
      t('soundcloud:9', 'Forss – Flickermood', ['some archive']),
      t('local:5', 'Forss - Flickermood', [])
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.confidence).toBe('exact')
    expect(groups[0]!.tracks.map((x) => x.id)).toEqual(['spotify:1', 'soundcloud:9', 'local:5'])
  })

  it('keeps a song liked twice on one service, drops groups of only local files', () => {
    const groups = findDuplicateGroups([
      t('spotify:a', 'Same', ['X']),
      t('spotify:b', 'Same', ['X']),
      t('local:1', 'Copy', ['Y']),
      t('local:2', 'Copy', ['Y'])
    ])
    expect(groups.map((g) => g.key)).toEqual(['spotify:a|spotify:b'])
  })

  it('needs an artist match: same title by different artists is not a duplicate', () => {
    expect(
      findDuplicateGroups([t('spotify:1', 'Intro', ['A']), t('local:1', 'Intro', ['B'])])
    ).toEqual([])
  })

  it('uses a stable sorted key and skips dismissed groups', () => {
    const tracks = [t('local:z', 'Song', ['A']), t('spotify:a', 'Song', ['A'])]
    const [g] = findDuplicateGroups(tracks)
    expect(g!.key).toBe(groupKey([{ id: 'spotify:a' }, { id: 'local:z' }]))
    expect(g!.key).toBe('local:z|spotify:a')
    expect(findDuplicateGroups(tracks, new Set([g!.key]))).toEqual([])
  })

  it('finds pairs across sources through the word buckets, whatever the input order', () => {
    const filler = Array.from({ length: 200 }, (_, i) => t(`local:f${i}`, `Filler ${i}`, ['F']))
    const groups = findDuplicateGroups([
      t('local:x', 'Midnight City', ['M83']),
      ...filler,
      t('spotify:x', 'Midnight City - Remastered 2011', ['M83'])
    ])
    expect(groups.map((g) => g.key)).toEqual(['local:x|spotify:x'])
  })

  it('caps the number of groups', () => {
    const tracks = Array.from({ length: 20 }, (_, i) => [
      t(`spotify:${i}`, `Song number ${i}`, [`Artist ${i}`]),
      t(`local:${i}`, `Song number ${i}`, [`Artist ${i}`])
    ]).flat()
    expect(findDuplicateGroups(tracks, new Set(), 7)).toHaveLength(7)
  })

  it('stays fast for ~4,000 tracks', () => {
    const words = ['love', 'night', 'heart', 'fire', 'dream', 'rain', 'gold', 'blue', 'city', 'run']
    const tracks: Track[] = []
    for (let i = 0; i < 2000; i++) {
      const title = `${words[i % 10]} ${words[(i * 7) % 10]} ${i}`
      tracks.push(t(`spotify:s${i}`, title, [`Artist ${i % 300}`]))
      tracks.push(
        t(`local:l${i}`, i % 4 === 0 ? title : `${words[(i * 3) % 10]} track ${i + 5000}`, [
          `Artist ${i % 300}`
        ])
      )
    }
    const start = performance.now()
    const groups = findDuplicateGroups(tracks)
    const ms = performance.now() - start
    expect(groups.length).toBeGreaterThan(100)
    expect(ms).toBeLessThan(1000)
  })
})

describe('findAlreadyIn (QoL 4)', () => {
  const playlist = [
    t('spotify:1', 'Sumo', ['Hi-C']),
    t('soundcloud:2', 'Glasshouse', ['Neon Harbor'], { isrc: 'USRC17607839' })
  ]

  it('finds the very same track and the same song on another service', () => {
    const out = findAlreadyIn(
      [
        t('spotify:1', 'Sumo', ['Hi-C']),
        t('soundcloud:9', 'Sumo', ['Hi-C']),
        t('local:5', 'Other', ['X'], { isrc: 'USRC17607839' }),
        t('spotify:7', 'New Song', ['Hi-C'])
      ],
      playlist
    )
    expect(out.map((r) => [r.track.id, r.match.id, r.sameTrack])).toEqual([
      ['spotify:1', 'spotify:1', true],
      ['soundcloud:9', 'spotify:1', false],
      ['local:5', 'soundcloud:2', false]
    ])
  })

  it('finds nothing for new songs or an empty playlist', () => {
    expect(findAlreadyIn([t('spotify:8', 'Cobraz', ['Hi-C'])], playlist)).toEqual([])
    expect(findAlreadyIn(playlist, [])).toEqual([])
  })
})

describe('database', () => {
  let db: Db
  beforeEach(() => {
    db = openDb(':memory:')
  })
  afterEach(() => db.close())

  function like(track: Track): void {
    upsertServiceTracks(db, [track])
    db.prepare(`INSERT INTO likes (track_id, provider, liked_at) VALUES (?, ?, ?)`).run(
      track.id,
      track.provider,
      '2026-01-01T00:00:00Z'
    )
  }

  function addLocal(track: Track): void {
    db.prepare(
      `INSERT INTO tracks (id, provider, native_id, title, artists, duration_ms, local_path)
       VALUES (?, 'local', ?, ?, ?, ?, ?)`
    ).run(
      track.id,
      track.nativeId,
      track.title,
      JSON.stringify(track.artists),
      track.durationMs,
      `C:\\m\\${track.nativeId}.mp3`
    )
  }

  it('compares likes with local files; unliked service tracks are ignored', () => {
    like(t('spotify:1', 'Song', ['A']))
    upsertServiceTracks(db, [t('soundcloud:2', 'Song', ['A'])]) // seen, not liked
    addLocal(t('local:3', 'A - Song', []))
    const groups = findDuplicates(db)
    expect(groups.map((g) => g.tracks.map((x) => x.id))).toEqual([['spotify:1', 'local:3']])
  })

  it('stores dismissals in settings, deduped, newest last, capped', () => {
    like(t('spotify:1', 'Song', ['A']))
    addLocal(t('local:3', 'Song', ['A']))
    const [g] = findDuplicates(db)
    dismissDuplicate(db, g!.key)
    dismissDuplicate(db, g!.key)
    expect(readDismissed(db)).toEqual([g!.key])
    expect(findDuplicates(db)).toEqual([])
    const raw = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(DISMISSED_KEY)
    expect(JSON.parse(raw as string)).toEqual([g!.key])

    const full = Array.from({ length: DISMISSED_MAX }, (_, i) => `k${i}`)
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(
      JSON.stringify(full),
      DISMISSED_KEY
    )
    dismissDuplicate(db, 'newest')
    const kept = readDismissed(db)
    expect(kept).toHaveLength(DISMISSED_MAX)
    expect(kept[0]).toBe('k1')
    expect(kept.at(-1)).toBe('newest')
    expect(() => dismissDuplicate(db, '')).toThrow()
  })
})
