import { describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { ENABLED_KEY, readEnabled, writeEnabled } from './settings'

describe('discord.enabled setting', () => {
  it('defaults to true and round-trips as JSON', () => {
    const db = openDb(':memory:')
    expect(readEnabled(db)).toBe(true)
    writeEnabled(db, false)
    expect(readEnabled(db)).toBe(false)
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(ENABLED_KEY)).toBe(
      'false'
    )
    writeEnabled(db, true)
    expect(readEnabled(db)).toBe(true)
    db.close()
  })

  it('treats a malformed value as the default', () => {
    const db = openDb(':memory:')
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(ENABLED_KEY, '"nope"')
    expect(readEnabled(db)).toBe(true)
    db.close()
  })
})
