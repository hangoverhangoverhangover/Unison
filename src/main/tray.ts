// Tray icon (QoL round 2): play/pause, next, previous, show the window, mini player,
// quit. With "close to tray" on, closing the main window hides it instead of quitting.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { join } from 'path'
import type { MediaKey, NowPlaying } from '@shared/playback'
import { handle } from './ipc'

export interface TrayOptions {
  getMainWindow(): BrowserWindow | null
  /** Re-create the main window when it was closed (tray "Show"). */
  openMainWindow(): void
  send(key: MediaKey): void
  toggleMini(): void
  /** Read on every close so the Settings switch applies at once. */
  closeToTray(): boolean
  /** What's playing changed (the taskbar buttons follow it). */
  onNowPlaying?(now: NowPlaying | null): void
}

/** Tooltip text is capped by Windows at 127 characters. */
export function tooltipFor(now: NowPlaying | null): string {
  if (!now) return 'Unison'
  const line = `${now.playing ? '▶' : '❚❚'} ${now.title}${now.artists ? ` — ${now.artists}` : ''}`
  return line.length > 127 ? `${line.slice(0, 126)}…` : line
}

export function registerTray(opts: TrayOptions): {
  /** True while the app is really quitting (tray Quit, or close-to-tray off). */
  isQuitting(): boolean
  /** Hook for the main window's 'close' event: hide instead of close when wanted. */
  onMainClose(e: Electron.Event, win: BrowserWindow): void
  dispose(): void
} {
  let quitting = false
  let now: NowPlaying | null = null
  const iconPath = join(app.getAppPath(), 'resources', 'icon.png')
  const tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }))

  const show = (): void => {
    const win = opts.getMainWindow()
    if (!win || win.isDestroyed()) {
      opts.openMainWindow()
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  const rebuild = (): void => {
    tray.setToolTip(tooltipFor(now))
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: now ? now.title.slice(0, 60) : 'Nothing playing',
          enabled: false
        },
        { type: 'separator' },
        {
          label: now?.playing ? 'Pause' : 'Play',
          enabled: !!now,
          click: () => opts.send('playpause')
        },
        { label: 'Next', enabled: !!now, click: () => opts.send('next') },
        { label: 'Previous', enabled: !!now, click: () => opts.send('previous') },
        { type: 'separator' },
        { label: 'Show Unison', click: show },
        { label: 'Mini player', click: () => opts.toggleMini() },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            quitting = true
            app.quit()
          }
        }
      ])
    )
  }

  tray.on('click', show)
  app.on('before-quit', () => {
    quitting = true
  })
  handle('tray:nowPlaying', (next) => {
    now = next && typeof next.title === 'string' ? next : null
    rebuild()
    opts.onNowPlaying?.(now)
  })
  rebuild()

  return {
    isQuitting: () => quitting,
    onMainClose(e, win) {
      if (quitting || !opts.closeToTray()) return
      e.preventDefault()
      win.hide()
    },
    dispose() {
      ipcMain.removeHandler('tray:nowPlaying')
      if (!tray.isDestroyed()) tray.destroy()
    }
  }
}
