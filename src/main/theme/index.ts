// Custom theme IPC (QoL 3): the background image (kept out of the prefs so they stay
// small) and saving / opening theme files.
import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { readFile, stat, writeFile } from 'fs/promises'
import type { InvokeChannel } from '@shared/ipc'
import { MAX_THEME_FILE_BYTES, isImageDataUrl } from '@shared/theme'
import type { Db } from '../db'
import { handle } from '../ipc'
import { dbSettingsStore } from '../spotify/tokens'

export const THEME_IMAGE_KEY = 'theme.image'
/** The renderer downsizes images first; this only stops something unreasonable. */
const MAX_IMAGE_CHARS = 10 * 1024 * 1024

const CHANNELS: InvokeChannel[] = [
  'theme:getImage',
  'theme:setImage',
  'theme:exportFile',
  'theme:importFile'
]

const FILTERS = [{ name: 'Unison theme', extensions: ['unisontheme', 'json'] }]

export function registerTheme(opts: { db: Db; getWebContents(): WebContents | undefined }): {
  dispose(): void
} {
  const settings = dbSettingsStore(opts.db)
  const parent = (): BrowserWindow | null => {
    const wc = opts.getWebContents()
    return wc ? BrowserWindow.fromWebContents(wc) : null
  }

  handle('theme:getImage', () => settings.get(THEME_IMAGE_KEY) ?? null)
  handle('theme:setImage', (image) => {
    if (image === null) return void settings.delete(THEME_IMAGE_KEY)
    if (!isImageDataUrl(image) || image.length > MAX_IMAGE_CHARS)
      throw new Error('That image could not be used. Try a JPEG or PNG.')
    settings.set(THEME_IMAGE_KEY, image)
  })
  handle('theme:exportFile', async (text) => {
    if (typeof text !== 'string' || text.length > MAX_THEME_FILE_BYTES)
      throw new Error('That theme is too large to save.')
    const options: Electron.SaveDialogOptions = {
      title: 'Save theme',
      defaultPath: 'My theme.unisontheme',
      filters: FILTERS
    }
    const win = parent()
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (r.canceled || !r.filePath) return false
    await writeFile(r.filePath, text, 'utf8')
    return true
  })
  handle('theme:importFile', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Open a theme',
      properties: ['openFile'],
      filters: FILTERS
    }
    const win = parent()
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = r.canceled ? undefined : r.filePaths[0]
    if (!path) return null
    if ((await stat(path)).size > MAX_THEME_FILE_BYTES)
      throw new Error('That file is too large to be a theme.')
    return readFile(path, 'utf8')
  })

  return {
    dispose() {
      for (const c of CHANNELS) ipcMain.removeHandler(c)
    }
  }
}
