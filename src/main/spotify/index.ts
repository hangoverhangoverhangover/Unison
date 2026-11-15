// Spotify IPC: wires the session to Electron (safeStorage, shell, ipcMain).
import { ipcMain, safeStorage, shell, type WebContents } from 'electron'
import type { AppKeys } from '@shared/config'
import type { InvokeChannel } from '@shared/ipc'
import type { SpotifyStatus } from '@shared/spotify'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import type { SpotifyProvider } from './provider'
import { SpotifySession } from './session'
import { dbSettingsStore } from './tokens'

export { SpotifyProvider } from './provider'

const CHANNELS: InvokeChannel[] = [
  'spotify:getStatus',
  'spotify:login',
  'spotify:logout',
  'spotify:getAccessToken',
  'spotify:play',
  'spotify:getFollowings'
]

export const NO_KEY_MESSAGE = 'Add your Spotify Client ID in Settings → Spotify to use Spotify.'

export interface SpotifyOptions {
  db: Db
  keys: AppKeys
  getWebContents: () => WebContents | undefined
}

export function registerSpotify(opts: SpotifyOptions): {
  provider: SpotifyProvider | null
  isConnected(): boolean
  dispose(): void
} {
  const clientId = opts.keys.spotifyClientId.trim()
  const dispose = (): void => {
    for (const channel of CHANNELS) ipcMain.removeHandler(channel)
  }

  if (!clientId) {
    const status: SpotifyStatus = { state: 'disconnected', hasKey: false }
    const noKey = (): never => {
      throw new Error(NO_KEY_MESSAGE)
    }
    handle('spotify:getStatus', () => status)
    handle('spotify:login', noKey)
    handle('spotify:logout', () => status)
    handle('spotify:getAccessToken', noKey)
    handle('spotify:play', noKey)
    handle('spotify:getFollowings', noKey)
    return { provider: null, isConnected: () => false, dispose }
  }

  const session = new SpotifySession({
    clientId,
    box: safeStorage,
    settings: dbSettingsStore(opts.db),
    openExternal: (url) => shell.openExternal(url),
    onStatus: (status) => emit(opts.getWebContents(), 'spotify:status', status)
  })

  handle('spotify:getStatus', () => session.status)
  handle('spotify:login', () => session.login())
  handle('spotify:logout', () => session.logout())
  handle('spotify:getAccessToken', () => session.getAccessToken())
  handle('spotify:play', (deviceId, nativeIds, positionMs) =>
    session.play(deviceId, nativeIds, positionMs)
  )
  handle('spotify:getFollowings', () => session.getFollowings())

  return {
    provider: session.provider,
    isConnected: () => session.status.state === 'connected',
    dispose() {
      session.dispose()
      dispose()
    }
  }
}
