import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { migrate, openDb } from './index'
import { MIGRATIONS } from './schema'

describe('library database', () => {
  it('creates every table and records the schema version', () => {
    const db = openDb(':memory:')
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .pluck()
      .all()
    expect(new Set(tables)).toEqual(
      new Set([
        'tracks',
        'likes',
        'playlists',
        'playlist_items',
        'downloads',
        'cover_art_cache',
        'plays',
        'settings'
      ])
    )
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    db.close()
  })

  it('indexes downloads by SoundCloud track', () => {
    const db = openDb(':memory:')
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'downloads'`)
      .pluck()
      .all()
    expect(indexes).toContain('downloads_sc_track')
    db.close()
  })

  it('is a no-op when reopened at the latest version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'db-'))
    const file = join(dir, 'library.db')
    openDb(file).close()
    const db = openDb(file)
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a database from a newer app version', () => {
    const db = openDb(':memory:')
    db.pragma(`user_version = ${MIGRATIONS.length + 1}`)
    expect(() => migrate(db)).toThrow(/newer than this app/)
    db.close()
  })

  it('enforces foreign keys and provider checks', () => {
    const db = openDb(':memory:')
    expect(() =>
      db
        .prepare(`INSERT INTO likes (track_id, provider, liked_at) VALUES ('x', 'spotify', 'now')`)
        .run()
    ).toThrow(/FOREIGN KEY/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO tracks (id, provider, native_id, title) VALUES ('a:1', 'apple', '1', 't')`
        )
        .run()
    ).toThrow(/CHECK/)
    db.close()
  })

  it('cascades likes when a track is removed', () => {
    const db = openDb(':memory:')
    db.prepare(
      `INSERT INTO tracks (id, provider, native_id, title) VALUES ('spotify:1', 'spotify', '1', 't')`
    ).run()
    db.prepare(
      `INSERT INTO likes (track_id, provider, liked_at) VALUES ('spotify:1', 'spotify', '2026-01-01T00:00:00Z')`
    ).run()
    db.prepare(`DELETE FROM tracks WHERE id = 'spotify:1'`).run()
    expect(db.prepare('SELECT COUNT(*) FROM likes').pluck().get()).toBe(0)
    db.close()
  })
})
