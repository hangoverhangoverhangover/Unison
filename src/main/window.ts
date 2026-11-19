import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { Theme } from '@shared/config'
import type { CustomTheme } from '@shared/theme'

/** Height of the custom title bar; the renderer's drag strip matches it. */
export const TITLE_BAR_HEIGHT = 40

// Window colour before the renderer paints (tokens.ts glass.dark.base / glass.light.base).
const SHELL_BG = '#141522'
const SHELL_BG_LIGHT = '#eef0f5'

/** Window / taskbar icon (packaged builds also embed build/icon.ico in the exe). */
export const APP_ICON = join(app.getAppPath(), 'resources', 'icon.png')

/** Background a window shows before its first paint, so Light doesn't flash dark. */
export function shellBackground(theme: Theme, custom?: CustomTheme): string {
  if (theme === 'custom' && custom) return custom.background
  return theme === 'light' ? SHELL_BG_LIGHT : SHELL_BG
}

/**
 * Caption button colours. The overlay itself stays transparent so the renderer's
 * glass title bar (and the artwork wash) shows behind the min/max/close buttons;
 * only the symbols follow the theme.
 */
export function overlayColors(
  theme: Theme,
  custom?: CustomTheme
): { color: string; symbolColor: string } {
  if (theme === 'custom' && custom) return { color: '#00000000', symbolColor: custom.text }
  return { color: '#00000000', symbolColor: theme === 'light' ? '#1b1c22' : '#e6e6ee' }
}

export function createMainWindow(theme: Theme = 'artwork', custom?: CustomTheme): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Unison',
    icon: APP_ICON,
    backgroundColor: shellBackground(theme, custom),
    // Frameless: the renderer draws the title bar, Windows draws only the
    // caption buttons (keeps Snap Layouts on hover over maximize).
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...overlayColors(theme, custom), height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())
  // Chromium remembers page zoom per origin; the app zooms itself, so keep this at 100%.
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(1))

  // External links open in the default browser, never in an app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(win)
  return win
}

/** Load the renderer bundle; `hash` picks a lighter entry (e.g. 'mini'). */
export function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    // Dev only: mirror renderer warnings/errors into the terminal running `npm run dev`.
    win.webContents.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error' || e.message.includes('playlists loaded')) {
        const tag = hash ? `renderer:${hash}:${e.level}` : `renderer:${e.level}`
        console.log(`[${tag}] ${e.message} (${e.sourceId}:${e.lineNumber})`)
      }
    })
    const url = process.env['ELECTRON_RENDERER_URL']
    void win.loadURL(hash ? `${url}#${hash}` : url)
  } else {
    const file = join(__dirname, '../renderer/index.html')
    void (hash ? win.loadFile(file, { hash }) : win.loadFile(file))
  }
}

export { SHELL_BG }
