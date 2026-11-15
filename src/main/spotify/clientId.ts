// A Spotify Client ID entered in Settings, overriding SPOTIFY_CLIENT_ID from .env /
// config.json. Lets each person use their own Spotify developer app (in Development
// Mode only accounts allow-listed on an app can log in, and its owner needs Premium).
import type { SpotifyClientIdSetting } from '@shared/spotify'
import type { Db } from '../db'
import { TOKENS_KEY } from './tokens'

export const CLIENT_ID_KEY = 'spotify.clientId'
/** Spotify Client IDs are 32 hexadecimal characters. */
export const CLIENT_ID_RE = /^[0-9a-f]{32}$/i

export function readClientIdOverride(db: Db): string {
  const raw = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(CLIENT_ID_KEY) as
    string | undefined
  if (!raw) return ''
  try {
    const v: unknown = JSON.parse(raw)
    return typeof v === 'string' && CLIENT_ID_RE.test(v) ? v.toLowerCase() : ''
  } catch {
    return ''
  }
}

/** The ID the app uses: the Settings one when set, else the build/config one. */
export function effectiveClientId(db: Db, fallback: string): string {
  return readClientIdOverride(db) || fallback.trim()
}

export function describeClientId(db: Db, fallback: string, active: string): SpotifyClientIdSetting {
  const override = readClientIdOverride(db)
  const saved = override || fallback.trim()
  return {
    clientId: override,
    source: override ? 'settings' : fallback.trim() ? 'build' : 'none',
    // The running session keeps its ID until the app restarts.
    needsRestart: saved !== active
  }
}

/**
 * Save (or clear with '') the Settings Client ID. A different ID also signs out:
 * tokens belong to the app they were issued to and can't be refreshed by another.
 */
export function writeClientId(
  db: Db,
  input: unknown,
  fallback: string,
  active: string
): SpotifyClientIdSetting {
  if (typeof input !== 'string') throw new Error('Paste the Client ID as text.')
  const id = input.trim().toLowerCase()
  if (id !== '' && !CLIENT_ID_RE.test(id)) {
    throw new Error(
      'That doesn’t look like a Spotify Client ID. It’s 32 letters and numbers, shown on your app’s page at developer.spotify.com.'
    )
  }
  const before = effectiveClientId(db, fallback)
  if (id === '') db.prepare('DELETE FROM settings WHERE key = ?').run(CLIENT_ID_KEY)
  else
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    ).run(CLIENT_ID_KEY, JSON.stringify(id))
  if (effectiveClientId(db, fallback) !== before) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(TOKENS_KEY)
  }
  return describeClientId(db, fallback, active)
}
