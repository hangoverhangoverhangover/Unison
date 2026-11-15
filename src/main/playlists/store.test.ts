import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { openDb, type Db } from '../db'
import { AppPlaylistStore, NAME_MAX, PlaylistNotFoundError } from './store'

function svc(provider: 'spotify' | 'soundcloud', id: string, art?: string): Track {
  const t: Track = {
    id: `${provider}:${id}`,
    provider,
    nativeId: id,
    title: `Song ${id}`,
    artists: ['A'],
    durationMs: 1000
  }
  if (art) t.artworkUrl = art
  return t
}

function local(id: string): Track {
  return {
    id: `local:${id}`,
    provider: 'local',
    nativeId: id,
    title: `Local ${id}`,
    artists: [],
    durationMs: 2000,
    localPath: `C:\\music\\${id}.mp3`
  }
}

function insertLocal(db: Db, t: Track): void {
  db.prepare(
    `INSERT INTO tracks (id, provider, native_id, title, artists, duration_ms, local_path, artwork_url)
     VALUES (?, 'local', ?, ?, '[]', ?, ?, ?)`
  ).run(t.id, t.nativeId, t.title, t.durationMs, t.localPath, 'media://art/abc')
}

let db: Db
let store: AppPlaylistStore

beforeEach(() => {
  db = openDb(':memory:')
  store = new AppPlaylistStore(db)
})
afterEach(() => db.close())

const ids = (id: string): string[] => store.getTracks(id).map((t) => t.id)

describe('AppPlaylistStore', () => {
  it('creates, lists newest first, renames and deletes', () => {
    const a = store.create('  First  ').playlist
    const b = store.create('Second').playlist
    expect(a).toMatchObject({
      source: 'app',
      name: 'First',
      ownerName: 'You',
      trackCount: 0,
      canEdit: true
    })
    expect(a.id).toBe(`app:${a.nativeId}`)
    expect(a.nativeId).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.artworkUrl).toBeUndefined()
    expect(store.list().map((p) => p.id)).toEqual([b.id, a.id])

    expect(store.rename(a.id, ' Renamed ').name).toBe('Renamed')
    store.delete(b.id)
    expect(store.list().map((p) => p.name)).toEqual(['Renamed'])
  })

  it('validates names and ids', () => {
    expect(() => store.create('   ')).toThrow('Give the playlist a name.')
    expect(() => store.create('x'.repeat(NAME_MAX + 1))).toThrow(/at most 100/)
    expect(store.create('x'.repeat(NAME_MAX)).playlist.name).toHaveLength(NAME_MAX)
    expect(() => store.rename('app:nope', 'x')).toThrow(PlaylistNotFoundError)
    expect(() => store.delete('app:nope')).toThrow(PlaylistNotFoundError)
    expect(() => store.getTracks('spotify:abc')).toThrow(PlaylistNotFoundError)
    expect(() => store.addTracks('app:nope', [svc('spotify', 'a')])).toThrow(PlaylistNotFoundError)
    const p = store.create('P').playlist
    expect(() => store.addTracks(p.id, [{ id: 'bad' } as Track])).toThrow(/Not a valid track/)
  })

  it('mixes providers, keeps order and duplicates, computes count and artwork', () => {
    const l = local('l1')
    insertLocal(db, l)
    const { playlist, added, skipped } = store.create('Mix', [
      svc('spotify', 's1', 'https://i/s1'),
      svc('soundcloud', '1'),
      l,
      svc('spotify', 's1', 'https://i/s1')
    ])
    expect(added).toBe(4)
    expect(skipped).toEqual([])
    expect(playlist.trackCount).toBe(4)
    expect(playlist.artworkUrl).toBe('https://i/s1')
    expect(ids(playlist.id)).toEqual(['spotify:s1', 'soundcloud:1', 'local:l1', 'spotify:s1'])
    const got = store.getTracks(playlist.id)
    expect(got[2]).toMatchObject({ provider: 'local', localPath: l.localPath, title: 'Local l1' })
    expect(got[0]).toMatchObject({ title: 'Song s1', artists: ['A'] })
  })

  it('skips local tracks that are not in the library', () => {
    const p = store.create('P').playlist
    const res = store.addTracks(p.id, [svc('spotify', 'a'), local('ghost'), svc('spotify', 'b')])
    expect(res).toEqual({ added: 2, skipped: ['local:ghost'] })
    expect(ids(p.id)).toEqual(['spotify:a', 'spotify:b'])
    // Never creates a row for the unknown local file.
    expect(db.prepare(`SELECT COUNT(*) FROM tracks WHERE id = 'local:ghost'`).pluck().get()).toBe(0)
  })

  it('appends after existing entries', () => {
    const p = store.create('P', [svc('spotify', 'a')]).playlist
    store.addTracks(p.id, [svc('spotify', 'b'), svc('spotify', 'a')])
    expect(ids(p.id)).toEqual(['spotify:a', 'spotify:b', 'spotify:a'])
  })

  it('removeAt drops entries and renumbers positions contiguously', () => {
    const p = store.create(
      'P',
      ['a', 'b', 'c', 'd', 'e'].map((x) => svc('spotify', x))
    ).playlist
    store.removeAt(p.id, [3, 1, 1])
    expect(ids(p.id)).toEqual(['spotify:a', 'spotify:c', 'spotify:e'])
    const positions = db
      .prepare(`SELECT position FROM playlist_items WHERE playlist_id = ? ORDER BY position`)
      .pluck()
      .all(p.id)
    expect(positions).toEqual([0, 1, 2])
    expect(() => store.removeAt(p.id, [3])).toThrow(/out of range/)
    expect(() => store.removeAt(p.id, [-1])).toThrow(/out of range/)
    expect(() => store.removeAt(p.id, [0.5])).toThrow(/out of range/)
    // A bad position anywhere rejects the whole call.
    expect(() => store.removeAt(p.id, [0, 9])).toThrow(/out of range/)
    expect(ids(p.id)).toHaveLength(3)
  })

  it('removes one duplicate entry by position, not every copy', () => {
    const p = store.create('P', [
      svc('spotify', 'a'),
      svc('spotify', 'b'),
      svc('spotify', 'a')
    ]).playlist
    store.removeAt(p.id, [2])
    expect(ids(p.id)).toEqual(['spotify:a', 'spotify:b'])
  })

  it('moves entries both ways and validates positions', () => {
    const p = store.create(
      'P',
      ['a', 'b', 'c', 'd'].map((x) => svc('spotify', x, `art-${x}`))
    ).playlist
    store.move(p.id, 0, 2)
    expect(ids(p.id)).toEqual(['spotify:b', 'spotify:c', 'spotify:a', 'spotify:d'])
    store.move(p.id, 3, 0)
    expect(ids(p.id)).toEqual(['spotify:d', 'spotify:b', 'spotify:c', 'spotify:a'])
    expect(store.get(p.id).artworkUrl).toBe('art-d')
    expect(() => store.move(p.id, 0, 4)).toThrow(/out of range/)
    expect(() => store.move(p.id, -1, 0)).toThrow(/out of range/)
  })

  it('cascades items on delete', () => {
    const p = store.create('P', [svc('spotify', 'a')]).playlist
    store.delete(p.id)
    expect(db.prepare(`SELECT COUNT(*) FROM playlist_items`).pluck().get()).toBe(0)
  })

  it('rolls back a failed add, including the track upsert', () => {
    const p = store.create('P', [svc('spotify', 'a')]).playlist
    const bad = { ...svc('spotify', 'bad'), availability: 'bogus' } as unknown as Track
    expect(() => store.addTracks(p.id, [svc('spotify', 'b'), bad])).toThrow()
    expect(ids(p.id)).toEqual(['spotify:a'])
    expect(db.prepare(`SELECT COUNT(*) FROM tracks WHERE id = 'spotify:b'`).pluck().get()).toBe(0)
  })

  it('rolls back a failed create', () => {
    const bad = { ...svc('spotify', 'bad'), availability: 'bogus' } as unknown as Track
    expect(() => store.create('P', [bad])).toThrow()
    expect(store.list()).toEqual([])
  })
})

describe('AppPlaylistStore custom covers', () => {
  const custom = 'media://art/0123456789abcdef0123456789abcdef01234567'

  it('keeps a custom cover across track changes and restores the automatic one', () => {
    const p = store.create('Mix', [svc('spotify', 'a', 'art-a')]).playlist
    expect(p.artworkUrl).toBe('art-a')
    expect(p.customArtwork).toBeUndefined()

    const set = store.setCustomArtwork(p.id, custom)
    expect(set.artworkUrl).toBe(custom)
    expect(set.customArtwork).toBe(true)

    // Automatic cover inputs change: new first track, moves, removals, a fresh artwork url.
    store.addTracks(p.id, [svc('soundcloud', '1', 'art-1')])
    store.move(p.id, 1, 0)
    store.addTracks(p.id, [svc('soundcloud', '1', 'art-1b')])
    store.removeAt(p.id, [1])
    expect(store.get(p.id)).toMatchObject({ artworkUrl: custom, customArtwork: true })
    expect(store.list()[0]).toMatchObject({ artworkUrl: custom, customArtwork: true })

    const cleared = store.clearCustomArtwork(p.id)
    expect(cleared.customArtwork).toBeUndefined()
    // Whatever the first track's artwork is now.
    expect(cleared.artworkUrl).toBe('art-1b')
    expect(store.get(p.id).artworkUrl).toBe('art-1b')
  })

  it('clearing a cover on an empty playlist leaves no artwork', () => {
    const p = store.create('Empty').playlist
    store.setCustomArtwork(p.id, custom)
    expect(store.clearCustomArtwork(p.id).artworkUrl).toBeUndefined()
  })

  it('refuses unknown playlists', () => {
    expect(() => store.setCustomArtwork('app:nope', custom)).toThrow(PlaylistNotFoundError)
    expect(() => store.clearCustomArtwork('spotify:x')).toThrow(PlaylistNotFoundError)
  })
})
