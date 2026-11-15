// history:* IPC handlers: play history, smart playlists and listening stats (QoL round 2).
import { ipcMain, type WebContents } from 'electron'
import type { InvokeChannel } from '@shared/ipc'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { createHistoryStore, type HistoryStore } from './store'
import { createThrottle } from './throttle'

export { createHistoryStore, type HistoryStore } from './store'

/** history:changed goes out at most this often. */
export const CHANGED_THROTTLE_MS = 2000

const CHANNELS: InvokeChannel[] = [
  'history:record',
  'history:recent',
  'history:smart',
  'history:stats',
  'history:clear'
]

export interface HistoryOptions {
  db: Db
  getWebContents(): WebContents | undefined
  /** Epoch ms; for tests. Default Date.now. */
  now?: () => number
}

export function registerHistory(opts: HistoryOptions): {
  store: HistoryStore
  dispose(): void
} {
  const now = opts.now ?? Date.now
  const store = createHistoryStore(opts.db, now)
  const changed = createThrottle(
    () => emit(opts.getWebContents(), 'history:changed', null),
    CHANGED_THROTTLE_MS,
    now
  )

  handle('history:record', (report) => {
    if (store.record(report)) changed.fire()
  })
  handle('history:recent', (limit) => store.recent(limit))
  handle('history:smart', (kind) => store.smart(kind))
  handle('history:stats', (range) => store.stats(range))
  handle('history:clear', () => {
    store.clear()
    changed.fire()
  })

  return {
    store,
    dispose() {
      changed.cancel()
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
    }
  }
}
