// Lyrics IPC: the user's own lyrics and LRCLIB lookups.
import { app, ipcMain } from 'electron'
import type { InvokeChannel } from '@shared/ipc'
import type { Db } from '../db'
import { handle } from '../ipc'
import { dbSettingsStore } from '../spotify/tokens'
import { createLyrics } from './service'

const CHANNELS: InvokeChannel[] = ['lyrics:get', 'lyrics:save', 'lyrics:delete']

export function registerLyrics(opts: { db: Db }): { dispose(): void } {
  const lyrics = createLyrics({
    settings: dbSettingsStore(opts.db),
    fetch: (input, init) => fetch(input, init),
    // LRCLIB asks clients to name themselves.
    userAgent: `Unison/${app.getVersion()} (https://github.com/hangoverhangoverhangover/Unison)`
  })
  handle('lyrics:get', (track) => lyrics.get(track))
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
