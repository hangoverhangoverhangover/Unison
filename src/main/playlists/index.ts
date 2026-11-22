// playlists:* IPC handlers (see service.ts for the routing).
import { join } from 'path'
import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import type { InvokeChannel, ServiceProvider } from '@shared/ipc'
import type { Track } from '@shared/types'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { COVER_EXTENSIONS, importCover } from './cover'
import { forgetPlaylist, readPrefs, writePrefs } from './prefs'
import { createPlaylistService, type EditableProvider } from './service'
import { AppPlaylistStore } from './store'

export { AppPlaylistStore, isAppPlaylistId } from './store'
export { createPlaylistService, type EditableProvider, type PlaylistService } from './service'
export { readPrefs } from './prefs'

const CHANNELS: InvokeChannel[] = [
  'playlists:getApp',
  'playlists:create',
  'playlists:rename',
  'playlists:delete',
  'playlists:addTracks',
  'playlists:checkAdd',
  'playlists:removeAt',
  'playlists:move',
  'playlists:chooseCover',
  'playlists:clearCover',
  'playlists:getPrefs',
  'playlists:setPrefs'
]

export interface PlaylistsOptions {
  db: Db
  getProvider: (source: ServiceProvider) => EditableProvider | undefined
  /** Same list music:getPlaylistTracks returns, so renderer positions line up. */
  getServicePlaylistTracks: (playlistId: string) => Promise<Track[]>
  getWebContents: () => WebContents | undefined
  /** Where `media://art/<sha1>` files live. Default: `<userData>/artwork`. */
  artworkDir?: string
  /** Native image picker for covers; null = cancelled. Default: an open dialog on the main window. */
  pickCoverFile?: () => Promise<string | null>
}

async function defaultPickCover(
  getWebContents: () => WebContents | undefined
): Promise<string | null> {
  const wc = getWebContents()
  const win = wc ? BrowserWindow.fromWebContents(wc) : null
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a playlist cover',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: [...COVER_EXTENSIONS] }]
  }
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return r.canceled ? null : (r.filePaths[0] ?? null)
}

export function registerPlaylists(opts: PlaylistsOptions): {
  store: AppPlaylistStore
  dispose(): void
} {
  const store = new AppPlaylistStore(opts.db)
  let disposed = false
  const artworkDir = opts.artworkDir ?? join(app.getPath('userData'), 'artwork')
  const db = opts.db
  const service = createPlaylistService({
    store,
    getProvider: opts.getProvider,
    getServicePlaylistTracks: opts.getServicePlaylistTracks,
    prefs: {
      read: () => readPrefs(db),
      write: (prefs) => writePrefs(db, prefs),
      forget: (id) => forgetPlaylist(db, id)
    },
    covers: {
      pick: opts.pickCoverFile ?? (() => defaultPickCover(opts.getWebContents)),
      importCover: (path) => importCover(path, { artworkDir })
    },
    notify: (playlistId) => {
      if (!disposed) emit(opts.getWebContents(), 'playlists:changed', { playlistId })
    }
  })
  handle('playlists:getApp', () => service.getApp())
  handle('playlists:create', (name, tracks) => service.create(name, tracks))
  handle('playlists:rename', (id, name) => service.rename(id, name))
  handle('playlists:delete', (id) => service.delete(id))
  handle('playlists:addTracks', (id, tracks) => service.addTracks(id, tracks))
  handle('playlists:checkAdd', (id, tracks) => service.checkAdd(id, tracks))
  handle('playlists:removeAt', (id, positions) => service.removeAt(id, positions))
  handle('playlists:move', (id, from, to) => service.move(id, from, to))
  handle('playlists:chooseCover', (id) => service.chooseCover(id))
  handle('playlists:clearCover', (id) => service.clearCover(id))
  handle('playlists:getPrefs', () => service.getPrefs())
  handle('playlists:setPrefs', (prefs) => service.setPrefs(prefs))
  return {
    store,
    dispose() {
      disposed = true
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
    }
  }
}
