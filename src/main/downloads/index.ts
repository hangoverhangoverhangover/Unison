// downloads:* IPC handlers over the download queue (Phase 7).
import { ipcMain, type WebContents } from 'electron'
import type { InvokeChannel } from '@shared/ipc'
import type { SoundCloudProvider } from '@shared/provider'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { createDownloader, type Downloader } from './manager'

export { createDownloader, type Downloader, type DownloaderDeps } from './manager'

const CHANNELS: InvokeChannel[] = [
  'downloads:getStatus',
  'downloads:list',
  'downloads:enqueue',
  'downloads:enqueueMany',
  'downloads:retry',
  'downloads:cancel',
  'downloads:clearHistory',
  'downloads:chooseFolder',
  'downloads:reveal'
]

export interface DownloadsOptions {
  db: Db
  userDataDir: string
  /** Folder holding the bundled yt-dlp.exe and ffmpeg.exe (dev: <project>/bin). */
  bundledBinDir: string
  getWebContents(): WebContents | undefined
  soundcloud: SoundCloudProvider
  /** The SoundCloud oauth_token when logged in. */
  getSoundCloudToken(): Promise<string | undefined>
  /** Default download folder (main passes Music\Unison, or the older Music\Combined Player). */
  defaultFolder: string
  /** Native folder picker; main passes a dialog.showOpenDialog wrapper. Null = cancelled. */
  pickFolder(): Promise<string | null>
  /** Show a file in Explorer; main passes shell.showItemInFolder. */
  revealFile(path: string): void
}

export function registerDownloads(opts: DownloadsOptions): {
  downloader: Downloader
  dispose(): Promise<void>
} {
  const wc = opts.getWebContents
  const downloader = createDownloader({
    db: opts.db,
    userDataDir: opts.userDataDir,
    bundledBinDir: opts.bundledBinDir,
    defaultFolder: opts.defaultFolder,
    soundcloud: opts.soundcloud,
    getSoundCloudToken: opts.getSoundCloudToken,
    revealFile: opts.revealFile,
    onStatus: (status) => emit(wc(), 'downloads:status', status),
    onChanged: () => emit(wc(), 'downloads:changed', null),
    onProgress: (id, progress) => emit(wc(), 'downloads:progress', { id, progress }),
    onLibraryChanged: () => emit(wc(), 'library:changed', null)
  })

  handle('downloads:getStatus', () => downloader.getStatus())
  handle('downloads:list', () => downloader.list())
  handle('downloads:enqueue', (track) => downloader.enqueue(track))
  handle('downloads:enqueueMany', (tracks) => downloader.enqueueMany(tracks))
  handle('downloads:retry', (id) => downloader.retry(Number(id)))
  handle('downloads:cancel', (id) => downloader.cancel(Number(id)))
  handle('downloads:clearHistory', () => downloader.clearHistory())
  handle('downloads:chooseFolder', async () => {
    const picked = await opts.pickFolder()
    return picked ? downloader.setFolder(picked) : null
  })
  handle('downloads:reveal', (id) => downloader.reveal(Number(id)))

  void downloader.start().catch((err) => console.error('[downloads] start failed:', err))

  return {
    downloader,
    async dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
      await downloader.dispose()
    }
  }
}
