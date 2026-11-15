// transfer:* and duplicates:* IPC handlers (QoL round 2). Logic lives in plan.ts and
// duplicates.ts; this file only wires channels and events.
import { ipcMain, type WebContents } from 'electron'
import type { EventChannel, InvokeChannel, IpcEventMap, ServiceProvider } from '@shared/ipc'
import type { MusicProvider } from '@shared/provider'
import type { Track } from '@shared/types'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { AppPlaylistStore, isAppPlaylistId } from '../playlists/store'
import { dismissDuplicate, findDuplicates } from './duplicates'
import { createSearchGates, createTransfer, planTransfer } from './plan'

export { findDuplicateGroups } from './duplicates'
export { createTransfer, planTransfer } from './plan'

const CHANNELS: InvokeChannel[] = [
  'transfer:plan',
  'transfer:create',
  'duplicates:find',
  'duplicates:dismiss'
]

export interface TransferOptions {
  db: Db
  getProvider: (service: ServiceProvider) => MusicProvider | undefined
  /**
   * Tracks of a service playlist (`spotify:` / `soundcloud:`), the same list
   * music:getPlaylistTracks returns. `app:` playlists are read from the store here.
   */
  getPlaylistTracks: (playlistId: string) => Promise<Track[]>
  getWebContents: () => WebContents | undefined
}

export function registerTransfer(opts: TransferOptions): { dispose(): void } {
  const store = new AppPlaylistStore(opts.db)
  let disposed = false
  // Shared by every plan so SoundCloud's pacing holds even if two plans overlap.
  const gates = createSearchGates()
  // A new plan cancels the one before it (the dialog reopened, or React StrictMode ran
  // the effect twice): two plans on one progress channel made the bar jump back and forth
  // and doubled the searches.
  let currentPlan: AbortController | null = null
  const send = <C extends EventChannel>(channel: C, payload: IpcEventMap[C]): void => {
    if (!disposed) emit(opts.getWebContents(), channel, payload)
  }

  handle('transfer:plan', async (playlistId, target) => {
    currentPlan?.abort()
    const plan = new AbortController()
    currentPlan = plan
    try {
      return await planTransfer(
        {
          getProvider: opts.getProvider,
          getPlaylistTracks: (id) =>
            isAppPlaylistId(id) ? store.getTracks(id) : opts.getPlaylistTracks(id),
          onProgress: (p) => {
            if (!plan.signal.aborted) send('transfer:progress', p)
          },
          gates,
          signal: plan.signal
        },
        playlistId,
        target
      )
    } finally {
      if (currentPlan === plan) currentPlan = null
    }
  })
  handle('transfer:create', (request) =>
    createTransfer(
      {
        getProvider: opts.getProvider,
        onCreated: () => send('playlists:changed', { playlistId: null })
      },
      request
    )
  )
  handle('duplicates:find', () => findDuplicates(opts.db))
  handle('duplicates:dismiss', (key) => dismissDuplicate(opts.db, key))

  return {
    dispose() {
      disposed = true
      currentPlan?.abort()
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
    }
  }
}
