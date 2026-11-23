// Lyrics IPC: the user's own lyrics and LRCLIB lookups.
import { app, ipcMain, safeStorage } from 'electron'
import type { InvokeChannel } from '@shared/ipc'
import type { Db } from '../db'
import { handle } from '../ipc'
import { dbSettingsStore } from '../spotify/tokens'
import { createLyrics } from './service'
import { testGeniusToken } from './genius'

const CHANNELS: InvokeChannel[] = [
  'lyrics:get',
  'lyrics:save',
  'lyrics:delete',
  'genius:hasToken',
  'genius:setToken',
  'genius:test'
]

/** Your Genius API token, encrypted with the OS key store (QoL 4). */
const GENIUS_KEY = 'genius.token'
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,200}$/

export function registerLyrics(opts: { db: Db }): { dispose(): void } {
  const settings = dbSettingsStore(opts.db)
  const userAgent = `Unison/${app.getVersion()} (https://github.com/hangoverhangoverhangover/Unison)`
  const geniusToken = (): string | null => {
    const sealed = settings.get(GENIUS_KEY)
    if (!sealed) return null
    try {
      return safeStorage.decryptString(Buffer.from(sealed, 'base64'))
    } catch {
      return null
    }
  }
  const lyrics = createLyrics({
    settings,
    geniusToken,
    fetch: (input, init) => fetch(input, init),
    // LRCLIB asks clients to name themselves.
    userAgent
  })
  handle('lyrics:get', (track) => lyrics.get(track))
  handle('genius:hasToken', () => geniusToken() !== null)
  handle('genius:test', async () => {
    const token = geniusToken()
    return token ? testGeniusToken((u, i) => fetch(u, i), token, userAgent) : 'No token saved.'
  })
  handle('genius:setToken', (token) => {
    if (token === null) {
      settings.delete(GENIUS_KEY)
      return false
    }
    const clean = typeof token === 'string' ? token.trim() : ''
    if (!TOKEN_SHAPE.test(clean)) throw new Error("That doesn't look like a Genius access token.")
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("Windows can't encrypt the token here, so it wasn't saved.")
    settings.set(GENIUS_KEY, safeStorage.encryptString(clean).toString('base64'))
    return true
  })
  handle('lyrics:save', (track, text) => {
    lyrics.save(track, text)
    return lyrics.get(track)
  })
  handle('lyrics:delete', (track) => {
    lyrics.remove(track)
    return lyrics.get(track)
  })
  return {
    dispose() {
      for (const c of CHANNELS) ipcMain.removeHandler(c)
    }
  }
}
