import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { join } from 'path'
import type { FSWatcher } from 'chokidar'
import type { ScanStatus } from '@shared/library'
import type { InvokeChannel } from '@shared/ipc'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { addFolderTo, removeFolderFrom } from './paths'
import { removeDir, removeFile, scanLibrary, updateFile } from './scanner'
import { countLocalTracks, getFolders, getLocalTracks, setFolders } from './store'
import { watchFolders } from './watcher'

const CHANGED_DEBOUNCE_MS = 500
const PROGRESS_INTERVAL_MS = 100

const CHANNELS: InvokeChannel[] = [
  'library:getFolders',
  'library:addFolder',
  'library:removeFolder',
  'library:getTracks',
  'library:getScanStatus',
  'library:rescan'
]

export interface LibraryOptions {
  db: Db
  userDataDir: string
  getWebContents: () => WebContents | undefined
}

/** Local library: IPC handlers, folder watchers and the background scanner. */
export function registerLibrary(opts: LibraryOptions): { dispose(): Promise<void> } {
  const { db, getWebContents } = opts
  const artworkDir = join(opts.userDataDir, 'artwork')
  let disposed = false
  let status: ScanStatus = { state: 'idle', trackCount: countLocalTracks(db) }
  let watcher: FSWatcher | null = null
  let scanning: Promise<void> | null = null
  let rescanQueued = false
  let changedTimer: NodeJS.Timeout | undefined
  let lastProgress = 0

  const isDisposed = (): boolean => disposed

  function setStatus(next: ScanStatus, force = false): void {
    status = next
    const now = Date.now()
    if (!force && now - lastProgress < PROGRESS_INTERVAL_MS) return
    lastProgress = now
    emit(getWebContents(), 'library:scanStatus', next)
  }

  function notifyChanged(): void {
    if (disposed) return
    clearTimeout(changedTimer)
    changedTimer = setTimeout(() => {
      emit(getWebContents(), 'library:changed', null)
      if (status.state === 'idle')
        setStatus({ state: 'idle', trackCount: countLocalTracks(db) }, true)
    }, CHANGED_DEBOUNCE_MS)
  }

  async function runScans(): Promise<void> {
    do {
      rescanQueued = false
      setStatus({ state: 'scanning', scanned: 0, total: 0 }, true)
      let changed = false
      try {
        changed = await scanLibrary({
          db,
          folders: getFolders(db),
          artworkDir,
          isCancelled: isDisposed,
          onProgress: (scanned, total) => setStatus({ state: 'scanning', scanned, total })
        })
      } catch (err) {
        console.error('[library] scan failed:', err)
      }
      if (disposed) return
      setStatus({ state: 'idle', trackCount: countLocalTracks(db) }, true)
      if (changed) notifyChanged()
    } while (rescanQueued && !disposed)
  }

  /** Start a scan, or queue one more if a scan is already running. */
  function requestScan(): void {
    if (disposed) return
    if (scanning) {
      rescanQueued = true
      return
    }
    scanning = runScans().finally(() => {
      scanning = null
    })
  }

  function restartWatcher(): void {
    const old = watcher
    watcher = null
    if (old) void old.close()
    if (disposed) return
    watcher = watchFolders(getFolders(db), {
      onFile: (path) => {
        void updateFile(db, path, artworkDir, isDisposed).then((c) => c && notifyChanged())
      },
      onUnlink: (path) => {
        if (!disposed && removeFile(db, path)) notifyChanged()
      },
      onUnlinkDir: (path) => {
        if (!disposed && removeDir(db, path)) notifyChanged()
      }
    })
  }

  function foldersChanged(next: string[]): string[] {
    setFolders(db, next)
    restartWatcher()
    requestScan()
    return next
  }

  handle('library:getFolders', () => getFolders(db))
  handle('library:addFolder', async () => {
    const wc = getWebContents()
    const win = wc ? BrowserWindow.fromWebContents(wc) : null
    const options = { properties: ['openDirectory' as const] }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    const current = getFolders(db)
    const next = addFolderTo(current, picked)
    const same = next.length === current.length && next.every((f, i) => f === current[i])
    return same ? current : foldersChanged(next)
  })
  handle('library:removeFolder', (path) => {
    const current = getFolders(db)
    const next = removeFolderFrom(current, path)
    return next.length === current.length ? current : foldersChanged(next)
  })
  handle('library:getTracks', () => getLocalTracks(db))
  handle('library:getScanStatus', () => status)
  handle('library:rescan', () => requestScan())

  restartWatcher()
  requestScan()

  return {
    async dispose() {
      if (disposed) return
      disposed = true
      clearTimeout(changedTimer)
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
      const w = watcher
      watcher = null
      await Promise.all([w?.close(), scanning])
    }
  }
}
