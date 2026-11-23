// Mini player (Phase 8): a small always-on-top window that remote-controls playback.
// Playback stays in the main window's renderer; this window only shows what the main
// window publishes and sends controls back, so it costs the main window almost nothing.
import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import type { MiniState } from '@shared/match'
import type { Db } from './db'
import { emit, handle } from './ipc'
import { APP_ICON, loadRenderer, shellBackground } from './window'
import type { MiniLayout, Theme } from '@shared/config'
import type { CustomTheme } from '@shared/theme'

export const MINI_WIDTH = 380
export const MINI_HEIGHT = 112
/** The lyric-bar layout (QoL 4): wider and shorter. */
export const MINI_LYRICS_WIDTH = 480
export const MINI_LYRICS_HEIGHT = 76

export function miniSize(layout: MiniLayout | undefined): { width: number; height: number } {
  return layout === 'lyrics'
    ? { width: MINI_LYRICS_WIDTH, height: MINI_LYRICS_HEIGHT }
    : { width: MINI_WIDTH, height: MINI_HEIGHT }
}
/** Gap from the screen edge for the first position. */
const MARGIN = 24
const BOUNDS_KEY = 'mini.position'

const CHANNELS = [
  'mini:toggle',
  'mini:publish',
  'mini:getState',
  'mini:command',
  'mini:showMain'
] as const

export interface MiniOptions {
  db: Db
  getMainWindow(): BrowserWindow | null
  /** Current theme, for the window colour before first paint. */
  getTheme(): Theme
  getCustomTheme?(): CustomTheme
  getLayout?(): MiniLayout
}

function readPosition(db: Db): { x: number; y: number } | undefined {
  const raw = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(BOUNDS_KEY) as
    string | undefined
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw) as { x?: unknown; y?: unknown }
    if (typeof v.x !== 'number' || typeof v.y !== 'number') return undefined
    // Only reuse it if it's still on a connected display.
    const area = screen.getDisplayMatching({
      x: v.x,
      y: v.y,
      width: MINI_WIDTH,
      height: MINI_HEIGHT
    }).workArea
    const inside =
      v.x >= area.x - MINI_WIDTH / 2 &&
      v.y >= area.y &&
      v.x + MINI_WIDTH / 2 <= area.x + area.width &&
      v.y + MINI_HEIGHT <= area.y + area.height
    return inside ? { x: v.x, y: v.y } : undefined
  } catch {
    return undefined
  }
}

function writePosition(db: Db, pos: { x: number; y: number }): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(BOUNDS_KEY, JSON.stringify(pos))
}

export function registerMini(opts: MiniOptions): {
  /** Close the mini player (e.g. when the main window closes). */
  close(): void
  /** The mini window's contents while it's open (prefs changes go to it too). */
  webContents(): Electron.WebContents | undefined
  toggle(): boolean
  /** Resize for the current layout (player or lyric bar), keeping the bottom edge. */
  relayout(): void
  dispose(): void
} {
  let win: BrowserWindow | null = null
  let state: MiniState | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const mainContents = (): Electron.WebContents | undefined => {
    const m = opts.getMainWindow()
    return m && !m.isDestroyed() ? m.webContents : undefined
  }

  function open(): void {
    const area = screen.getPrimaryDisplay().workArea
    const size = miniSize(opts.getLayout?.())
    const pos = readPosition(opts.db) ?? {
      x: area.x + area.width - size.width - MARGIN,
      y: area.y + area.height - size.height - MARGIN
    }
    win = new BrowserWindow({
      ...pos,
      ...size,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      title: 'Unison',
      icon: APP_ICON,
      backgroundColor: shellBackground(opts.getTheme(), opts.getCustomTheme?.()),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    win.once('ready-to-show', () => {
      if (!win) return
      win.showInactive()
      // Applied after showing: on Windows the constructor flag alone didn't stick for a
      // window shown inactive. 'floating' keeps it above normal windows.
      win.setAlwaysOnTop(true, 'floating')
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // The Start menu, the taskbar or Win+D can push it behind other windows or minimize
    // it, and with no taskbar button it then looks gone. Put it back on top whenever
    // it loses focus, and undo any minimize.
    const reassert = (): void => {
      if (!win || win.isDestroyed()) return
      win.setAlwaysOnTop(true, 'floating')
      win.moveTop()
    }
    win.on('blur', () => setTimeout(reassert, 150))
    win.on('always-on-top-changed', (_e, onTop) => {
      if (!onTop) reassert()
    })
    win.on('minimize', () => {
      setTimeout(() => {
        if (!win || win.isDestroyed()) return
        win.restore()
        win.showInactive()
        reassert()
      }, 150)
    })
    win.on('hide', () => setTimeout(() => win && !win.isDestroyed() && win.showInactive(), 150))
    win.on('moved', () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        if (win && !win.isDestroyed()) {
          const [x, y] = win.getPosition()
          writePosition(opts.db, { x: x!, y: y! })
        }
      }, 400)
    })
    win.on('closed', () => {
      win = null
      emit(mainContents(), 'mini:open', false)
    })
    loadRenderer(win, 'mini')
    emit(mainContents(), 'mini:open', true)
  }

  function close(): void {
    if (win && !win.isDestroyed()) win.close()
  }

  /** Open, bring back (if hidden) or close; returns whether it's open now. */
  function toggle(): boolean {
    if (win && !win.isDestroyed()) {
      // Open but hidden or minimized: bring it back instead of closing it.
      if (!win.isVisible() || win.isMinimized()) {
        win.restore()
        win.showInactive()
        win.setAlwaysOnTop(true, 'floating')
        win.moveTop()
        return true
      }
      close()
      return false
    }
    open()
    return true
  }

  handle('mini:toggle', () => toggle())
  handle('mini:publish', (next) => {
    state = next
    if (win && !win.isDestroyed()) emit(win.webContents, 'mini:state', next)
  })
  handle('mini:getState', () => state)
  handle('mini:command', (command) => emit(mainContents(), 'mini:command', command))
  handle('mini:showMain', () => {
    const m = opts.getMainWindow()
    if (!m || m.isDestroyed()) return
    if (m.isMinimized()) m.restore()
    m.show()
    m.focus()
  })

  return {
    close,
    toggle,
    relayout() {
      if (!win || win.isDestroyed()) return
      const size = miniSize(opts.getLayout?.())
      const b = win.getBounds()
      if (b.width === size.width && b.height === size.height) return
      // Keep the bottom-right corner where it was (it usually sits in a screen corner).
      win.setBounds({ x: b.x + b.width - size.width, y: b.y + b.height - size.height, ...size })
    },
    webContents: () => (win && !win.isDestroyed() ? win.webContents : undefined),
    dispose() {
      if (saveTimer) clearTimeout(saveTimer)
      close()
      for (const c of CHANNELS) ipcMain.removeHandler(c)
    }
  }
}
