// The Redirect URI registered on the user's Spotify developer app. Spotify matches it
// exactly, port included, so the login server listens on that URI's port. People use
// different ports (8888 and 3000 are common), so it's a setting; 8888 by default.
import type { Db } from '../db'

export const REDIRECT_KEY = 'spotify.redirectUri'
export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:8888/callback'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

export interface LoopbackRedirect {
  uri: string
  /** Address the login server listens on. */
  host: string
  port: number
  path: string
}

/** Parses a loopback Redirect URI, or throws a readable message. */
export function parseRedirectUri(input: unknown): LoopbackRedirect {
  if (typeof input !== 'string') throw new Error('Paste the Redirect URI as text.')
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error(
      'That isn’t a web address. Copy the Redirect URI from your app at developer.spotify.com, like http://127.0.0.1:8888/callback.'
    )
  }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) {
    throw new Error(
      'The Redirect URI must start with http://127.0.0.1 (or http://localhost), like http://127.0.0.1:8888/callback.'
    )
  }
  if (!url.port) {
    throw new Error('Add the port from your Spotify app, like http://127.0.0.1:8888/callback.')
  }
  if (url.search || url.hash) throw new Error('Leave out anything after ? or #.')
  return {
    uri: `http://${url.host}${url.pathname}`,
    host: url.hostname === '[::1]' ? '::1' : '127.0.0.1',
    port: Number(url.port),
    path: url.pathname
  }
}

export function readRedirectUri(db: Db): string {
  const raw = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(REDIRECT_KEY) as
    string | undefined
  if (!raw) return DEFAULT_REDIRECT_URI
  try {
    return parseRedirectUri(JSON.parse(raw)).uri
  } catch {
    return DEFAULT_REDIRECT_URI
  }
}

/** Save the Redirect URI ('' goes back to the default). Returns the URI now in use. */
export function writeRedirectUri(db: Db, input: unknown): string {
  if (typeof input === 'string' && input.trim() === '') {
    db.prepare('DELETE FROM settings WHERE key = ?').run(REDIRECT_KEY)
    return DEFAULT_REDIRECT_URI
  }
  const { uri } = parseRedirectUri(input)
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(REDIRECT_KEY, JSON.stringify(uri))
  return uri
}
