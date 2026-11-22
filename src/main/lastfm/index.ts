// Last.fm IPC: wires the scrobbling service to Electron (safeStorage, shell, ipcMain).
import { ipcMain, safeStorage, shell, type WebContents } from 'electron'
import type { InvokeChannel } from '@shared/ipc'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { dbSettingsStore } from '../spotify/tokens'
import { createLastfm } from './service'

const CHANNELS: InvokeChannel[] = [
  'lastfm:getStatus',
  'lastfm:setKeys',
  'lastfm:connect',
  'lastfm:disconnect',
  'lastfm:setScrobbleSpotify',
  'lastfm:nowPlaying',
  'lastfm:scrobble',
  'lastfm:artistInfo'
]

export function registerLastfm(opts: { db: Db; getWebContents(): WebContents | undefined }): {
  dispose(): void
} {
  const lastfm = createLastfm({
    settings: dbSettingsStore(opts.db),
    box: safeStorage,
    fetch: (input, init) => fetch(input, init),
    openExternal: (url) => void shell.openExternal(url),
    onStatus: (status) => emit(opts.getWebContents(), 'lastfm:status', status)
  })

  handle('lastfm:getStatus', () => lastfm.status())
  handle('lastfm:setKeys', (apiKey, secret) => {
    lastfm.setKeys(apiKey, secret)
    return lastfm.status()
  })
  handle('lastfm:connect', async () => {
    await lastfm.connect()
    return lastfm.status()
  })
  handle('lastfm:disconnect', () => {
    lastfm.disconnect()
    return lastfm.status()
  })
  handle('lastfm:setScrobbleSpotify', (on) => {
    lastfm.setScrobbleSpotify(on)
    return lastfm.status()
  })
  handle('lastfm:nowPlaying', (track) => lastfm.nowPlaying(track))
  handle('lastfm:scrobble', (report) => lastfm.scrobble(report))
  handle('lastfm:artistInfo', (name) => lastfm.artistInfo(name))

  return {
    dispose() {
      lastfm.dispose()
      for (const c of CHANNELS) ipcMain.removeHandler(c)
    }
  }
}
