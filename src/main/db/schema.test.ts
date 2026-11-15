import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from './index'
import { MIGRATIONS } from './schema'

describe('migration 2', () => {
  it('adds local scan columns on top of a v1 database and keeps rows', () => {
    const db = new Database(':memory:')
    db.exec(MIGRATIONS[0]!)
    db.pragma('user_version = 1')
    db.prepare(
      `INSERT INTO tracks (id, provider, native_id, title) VALUES ('local:a', 'local', 'a', 't')`
    ).run()

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    const cols = db.prepare(`SELECT name FROM pragma_table_info('tracks')`).pluck().all()
    expect(cols).toEqual(
      expect.arrayContaining(['track_no', 'disc_no', 'file_mtime_ms', 'file_size', 'art_hash'])
    )
    expect(db.prepare(`SELECT title FROM tracks WHERE id = 'local:a'`).pluck().get()).toBe('t')
    db.close()
  })
})

describe('migration 7', () => {
  it('stores track links and keeps them when a later upsert has none', async () => {
    const { openDb } = await import('./index')
    const { rowToTrack, trackColumns, upsertServiceTracks } = await import('./tracks')
    const db = openDb(':memory:')
    const linked = {
      id: 'spotify:t1',
      provider: 'spotify' as const,
      nativeId: 't1',
      title: 'Song',
      artists: ['A'],
      artistRefs: [{ id: 'spotify:a', name: 'A', url: 'https://open.spotify.com/artist/a' }],
      album: 'Alb',
      albumRef: { id: 'spotify:al', name: 'Alb' },
      url: 'https://open.spotify.com/track/t1',
      durationMs: 1
    }
    upsertServiceTracks(db, [linked])
    const read = (): unknown =>
      rowToTrack(
        db.prepare(`SELECT ${trackColumns()} FROM tracks WHERE id = 'spotify:t1'`).get() as never
      )
    expect(read()).toEqual(linked)
    upsertServiceTracks(db, [
      { ...linked, artistRefs: undefined, albumRef: undefined, url: undefined, title: 'Renamed' }
    ])
    expect(read()).toEqual({ ...linked, title: 'Renamed' })
    // Garbage JSON is ignored rather than crashing reads.
    db.prepare(`UPDATE tracks SET artist_refs = 'nope', album_ref = '[1]'`).run()
    const t = read() as Record<string, unknown>
    expect(t.artistRefs).toBeUndefined()
    expect(t.albumRef).toBeUndefined()
    db.close()
  })
})
