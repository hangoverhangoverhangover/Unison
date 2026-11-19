// App updates IPC: status for Settings, check now, restart into a downloaded update.
import { app, ipcMain, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { InvokeChannel } from '@shared/ipc'
import { emit, handle } from '../ipc'
import { createUpdates, type Updater } from './service'

const CHANNELS: InvokeChannel[] = ['updates:getStatus', 'updates:check', 'updates:install']

export function registerUpdates(opts: { getWebContents(): WebContents | undefined }): {
  dispose(): void
} {
  // Quiet by default; its logger would print every HTTP request to the console.
  autoUpdater.logger = null
  const updates = createUpdates({
    updater: autoUpdater as unknown as Updater,
    packaged: app.isPackaged,
    currentVersion: app.getVersion(),
    emit: (status) => emit(opts.getWebContents(), 'updates:status', status)
  })
  handle('updates:getStatus', () => updates.status())
  handle('updates:check', async () => {
    await updates.check()
    return updates.status()
  })
  handle('updates:install', () => updates.install())
  return {
    dispose() {
      for (const c of CHANNELS) ipcMain.removeHandler(c)
      updates.dispose()
    }
  }
}
