// likes:* IPC handlers over the local likes table, kept in step with the services.
import { ipcMain, type WebContents } from 'electron'
import type { InvokeChannel, ServiceProvider } from '@shared/ipc'
import type { MusicProvider } from '@shared/provider'
import type { Track } from '@shared/types'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { createLikesSync, type LikesSync } from './reconcile'
import { createLikesStore, type LikesStore } from './store'

export { createLikesSync, SYNC_INTERVAL_MS, type LikesSync } from './reconcile'
export { createLikesStore, type LikesStore } from './store'

const CHANNELS: InvokeChannel[] = ['likes:getAll', 'likes:getSyncStatus', 'likes:sync']

export interface LikesOptions {
  db: Db
  getProvider(provider: ServiceProvider): MusicProvider | undefined
  isConnected(provider: ServiceProvider): boolean
  getWebContents(): WebContents | undefined
  /**
   * SoundCloud tracks a reconcile found newly liked (not on the first sync ever, not for
   * tracks already stored). Wire to the downloader when auto-download is on.
   */
  onNewLikes?(tracks: Track[]): void
}

export interface Likes {
  store: LikesStore
  sync: LikesSync
  /** Call after a successful service like/unlike (same as sync.recordLikeChange). */
  recordLikeChange(track: Track, liked: boolean): boolean
  dispose(): void
}

export function registerLikes(opts: LikesOptions): Likes {
  const store = createLikesStore(opts.db)
  const sync = createLikesSync({
    store,
    getProvider: opts.getProvider,
    isConnected: opts.isConnected,
    onChanged: () => emit(opts.getWebContents(), 'likes:changed', null),
    onStatus: (status) => emit(opts.getWebContents(), 'likes:syncStatus', status),
    onNewLikes: opts.onNewLikes ? (tracks) => opts.onNewLikes?.(tracks) : undefined
  })

  handle('likes:getAll', () => store.getAll())
  handle('likes:getSyncStatus', () => sync.status())
  handle('likes:sync', () => sync.syncNow())

  sync.start()

  return {
    store,
    sync,
    recordLikeChange: (track, liked) => sync.recordLikeChange(track, liked),
    dispose() {
      sync.dispose()
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
    }
  }
}
