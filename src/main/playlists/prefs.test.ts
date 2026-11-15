import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../db'
import {
  forgetPlaylist,
  PREFS_KEY,
  PREFS_MAX_IDS,
  readPrefs,
  validatePrefs,
  writePrefs
} from './prefs'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
})
afterEach(() => db.close())

const raw = (): unknown =>
  JSON.parse(
    db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(PREFS_KEY) as string
  )

describe('playlist prefs', () => {
  it('reads empty lists when nothing is stored', () => {
    expect(readPrefs(db)).toEqual({ order: [], hidden: [] })
  })

  it('round-trips and dedupes (first occurrence wins)', () => {
    const stored = writePrefs(db, {
      order: ['app:1', 'spotify:x', 'app:1', 'soundcloud:5'],
      hidden: ['spotify:x', 'spotify:x']
    })
    expect(stored).toEqual({ order: ['app:1', 'spotify:x', 'soundcloud:5'], hidden: ['spotify:x'] })
    expect(readPrefs(db)).toEqual(stored)
    expect(raw()).toEqual(stored)
    // Overwrites, not merges.
    writePrefs(db, { order: [], hidden: ['app:2'] })
    expect(readPrefs(db)).toEqual({ order: [], hidden: ['app:2'] })
  })

  it('rejects bad shapes and ids with readable errors and stores nothing', () => {
    const bad: unknown[] = [
      null,
      [],
      'x',
      { order: [] },
      { hidden: [] },
      { order: 'app:1', hidden: [] },
      { order: [1], hidden: [] },
      { order: ['local:abc'], hidden: [] },
      { order: ['app:'], hidden: [] },
      { order: ['nope'], hidden: [] },
      { order: [], hidden: [null] },
      { order: [`app:${'x'.repeat(600)}`], hidden: [] }
    ]
    for (const b of bad) expect(() => writePrefs(db, b), JSON.stringify(b)).toThrow(/playlist/i)
    expect(readPrefs(db)).toEqual({ order: [], hidden: [] })
  })

  it(`caps each list at ${PREFS_MAX_IDS} entries`, () => {
    const many = Array.from({ length: PREFS_MAX_IDS }, (_, i) => `app:${i}`)
    expect(validatePrefs({ order: many, hidden: many }).order).toHaveLength(PREFS_MAX_IDS)
    expect(() => validatePrefs({ order: [...many, 'app:x'], hidden: [] })).toThrow(/at most 5000/)
    expect(() => validatePrefs({ order: [], hidden: [...many, 'app:x'] })).toThrow(/at most 5000/)
  })

  it('reads corrupt or invalid stored data as empty lists', () => {
    const put = (v: string): void =>
      void db
        .prepare(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`
        )
        .run(PREFS_KEY, v)
    for (const v of ['{oops', 'null', '[]', '{"order":[1],"hidden":[]}', '{"order":[]}']) {
      put(v)
      expect(readPrefs(db), v).toEqual({ order: [], hidden: [] })
    }
  })

  it('forgetPlaylist drops the id from both lists', () => {
    writePrefs(db, { order: ['app:1', 'app:2'], hidden: ['app:1', 'spotify:x'] })
    forgetPlaylist(db, 'app:1')
    expect(readPrefs(db)).toEqual({ order: ['app:2'], hidden: ['spotify:x'] })
    forgetPlaylist(db, 'app:nothing')
    expect(readPrefs(db)).toEqual({ order: ['app:2'], hidden: ['spotify:x'] })
  })
})
