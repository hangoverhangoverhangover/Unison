import { describe, expect, it } from 'vitest'
import type { LikedTrack, Track } from '@shared/types'
import { openDb, type Db } from '../db'
import { createLikesStore } from './store'

function svc(
  provider: 'spotify' | 'soundcloud',
  nativeId: string,
  extra: Partial<Track> = {}
): Track {
  return {
    id: `${provider}:${nativeId}`,
    provider,
    nativeId,
    title: `Title ${nativeId}`,
    artists: ['Artist'],
    durationMs: 1000,
    ...extra
  }
}

const like = (track: Track, likedAt: string): LikedTrack => ({ track, likedAt })

function insertLocal(db: Db): void {
  db.prepare(
    `INSERT INTO tracks (id, provider, native_id, title, artists, duration_ms, local_path,
                         updated_at)
     VALUES ('local:a', 'local', 'a', 'Local A', '["Me"]', 5, 'C:\\music\\a.mp3', 'X')`
  ).run()
}

const localRow = (db: Db): unknown => db.prepare(`SELECT * FROM tracks WHERE id = 'local:a'`).get()

describe('likes store', () => {
  it('orders getAll by liked_at desc across providers, ties by title', () => {
    const db = openDb(':memory:')
    const store = createLikesStore(db)
    store.replaceForProvider('spotify', [
      like(svc('spotify', '1', { title: 'b' }), '2024-01-02T00:00:00Z'),
      like(svc('spotify', '2', { title: 'Zed' }), '2024-01-05T00:00:00.000Z')
    ])
    store.replaceForProvider('soundcloud', [
      like(svc('soundcloud', '3', { title: 'a' }), '2024-01-02T00:00:00.000Z'),
      like(svc('soundcloud', '4'), '2024-01-03T10:00:00+02:00')
    ])
    expect(store.getAll().map((l) => l.track.id)).toEqual([
      'spotify:2',
      'soundcloud:4',
      'soundcloud:3',
      'spotify:1'
    ])
    expect(store.getAll()[1]!.likedAt).toBe('2024-01-03T08:00:00.000Z')
  })

  it('replaceForProvider adds, removes and updates, leaving the other provider alone', () => {
    const db = openDb(':memory:')
    const store = createLikesStore(db, () => new Date('2025-01-01T00:00:00Z'))
    store.replaceForProvider('spotify', [
      like(svc('spotify', '1'), '2024-01-01T00:00:00Z'),
      like(svc('spotify', '2'), '2024-01-02T00:00:00Z')
    ])
    store.replaceForProvider('soundcloud', [like(svc('soundcloud', '9'), '2024-01-01T00:00:00Z')])

    const changed = store.replaceForProvider('spotify', [
      like(svc('spotify', '2', { title: 'Renamed' }), '2024-02-02T00:00:00Z'),
      like(svc('spotify', '3'), '2024-01-03T00:00:00Z'),
      // Wrong provider and malformed ids are ignored.
      like(svc('soundcloud', '10'), '2024-01-03T00:00:00Z'),
      like({ ...svc('spotify', '11'), id: 'local:a' }, '2024-01-03T00:00:00Z')
    ])
    expect(changed).toBe(true)
    expect(store.getAll().map((l) => [l.track.id, l.likedAt, l.track.title])).toEqual([
      ['spotify:2', '2024-02-02T00:00:00.000Z', 'Renamed'],
      ['spotify:3', '2024-01-03T00:00:00.000Z', 'Title 3'],
      ['soundcloud:9', '2024-01-01T00:00:00.000Z', 'Title 9']
    ])
    expect(store.has('spotify:1')).toBe(false)
    expect(
      db.prepare(`SELECT synced_at FROM likes WHERE track_id = 'spotify:3'`).pluck().get()
    ).toBe('2025-01-01T00:00:00.000Z')
    // Same set again: nothing changed.
    expect(
      store.replaceForProvider('spotify', [
        like(svc('spotify', '2', { title: 'Renamed' }), '2024-02-02T00:00:00.000Z'),
        like(svc('spotify', '3'), '2024-01-03T00:00:00Z')
      ])
    ).toBe(false)
  })

  it('rolls the whole replace back if any write fails', () => {
    const db = openDb(':memory:')
    const store = createLikesStore(db)
    store.replaceForProvider('spotify', [like(svc('spotify', '1'), '2024-01-01T00:00:00Z')])
    // A row with a conflicting (provider, native_id) makes the track upsert throw.
    db.prepare(
      `INSERT INTO tracks (id, provider, native_id, title) VALUES ('odd', 'spotify', '2', 'x')`
    ).run()
    expect(() =>
      store.replaceForProvider('spotify', [
        like(svc('spotify', '3'), '2024-01-01T00:00:00Z'),
        like(svc('spotify', '2'), '2024-01-01T00:00:00Z')
      ])
    ).toThrow()
    expect(store.getAll().map((l) => l.track.id)).toEqual(['spotify:1'])
    expect(db.prepare(`SELECT COUNT(*) FROM tracks WHERE id = 'spotify:3'`).pluck().get()).toBe(0)
  })

  it('keeps the stored liked_at when the service sends an invalid date', () => {
    const db = openDb(':memory:')
    const store = createLikesStore(db)
    store.replaceForProvider('spotify', [like(svc('spotify', '1'), '2024-01-01T00:00:00Z')])
    expect(store.replaceForProvider('spotify', [like(svc('spotify', '1'), 'garbage')])).toBe(false)
    expect(store.getAll()[0]!.likedAt).toBe('2024-01-01T00:00:00.000Z')
  })

  it('add and remove', () => {
    const db = openDb(':memory:')
    const store = createLikesStore(db, () => new Date('2025-03-03T00:00:00Z'))
    const t = svc('soundcloud', '5')
    expect(store.add(t)).toBe(true)
    expect(store.add(t)).toBe(false)
    expect(store.has(t.id)).toBe(true)
    expect(store.getAll()).toEqual([{ track: t, likedAt: '2025-03-03T00:00:00.000Z' }])
    expect(store.add(svc('spotify', '6'), '2020-01-01T00:00:00Z')).toBe(true)
    expect(store.getAll()[1]!.likedAt).toBe('2020-01-01T00:00:00.000Z')
    expect(store.remove(t.id)).toBe(true)
    expect(store.remove(t.id)).toBe(false)
    expect(store.has(t.id)).toBe(false)
    // The track row stays (other tables may reference it).
    expect(db.prepare(`SELECT COUNT(*) FROM tracks WHERE id = ?`).pluck().get(t.id)).toBe(1)
  })

  it('refuses local tracks and never modifies local rows', () => {
    const db = openDb(':memory:')
    insertLocal(db)
    const before = localRow(db)
    const store = createLikesStore(db)
    const local: Track = {
      id: 'local:a',
      provider: 'local',
      nativeId: 'a',
      title: 'Hijack',
      artists: [],
      durationMs: 0
    }
    expect(() => store.add(local)).toThrow()
    store.replaceForProvider('spotify', [
      like(local, '2024-01-01T00:00:00Z'),
      like(svc('spotify', '1'), '2024-01-01T00:00:00Z')
    ])
    store.replaceForProvider('spotify', [])
    expect(store.remove('local:a')).toBe(false)
    expect(localRow(db)).toEqual(before)
    expect(store.getAll()).toEqual([])
  })

  it('round-trips availability and other Track fields', () => {
    const db = openDb(':memory:')
    const store = createLikesStore(db)
    const full: Track = svc('spotify', 'x', {
      title: 'Full',
      artists: ['A', 'B'],
      album: 'Album',
      durationMs: 123456,
      artworkUrl: 'https://img/x.jpg',
      isrc: 'USABC1234567',
      availability: 'drm'
    })
    const preview = svc('soundcloud', 'p', { availability: 'preview' })
    const plain = svc('soundcloud', 'q', { availability: 'full' })
    store.replaceForProvider('spotify', [like(full, '2024-01-03T00:00:00Z')])
    store.replaceForProvider('soundcloud', [
      like(preview, '2024-01-02T00:00:00Z'),
      like(plain, '2024-01-01T00:00:00Z')
    ])
    const got = store.getAll().map((l) => l.track)
    expect(got[0]).toEqual(full)
    expect(got[1]).toEqual(preview)
    // 'full' is the default and reads back as missing.
    expect(got[2]).toEqual({ ...plain, availability: undefined })
    expect('availability' in got[2]!).toBe(false)
  })
})
