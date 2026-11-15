// The Discord toggle in the settings table.
import type { Db } from '../db'

/** settings key for the Settings toggle (JSON boolean, default true). */
export const ENABLED_KEY = 'discord.enabled'

export function readEnabled(db: Db): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(ENABLED_KEY) as
    string | undefined
  if (row === undefined) return true
  try {
    const value: unknown = JSON.parse(row)
    return typeof value === 'boolean' ? value : true
  } catch {
    return true
  }
}

export function writeEnabled(db: Db, enabled: boolean): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(ENABLED_KEY, JSON.stringify(enabled))
}
