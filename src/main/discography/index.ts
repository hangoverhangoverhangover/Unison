// Discography IPC: wires the session to Electron (the login partition's Session.fetch,
// the login window, its cookies) and serves songs at media://discography/<id>.
import { BrowserWindow, ipcMain, session, type WebContents } from 'electron'
import { DISCOGRAPHY_ORIGIN, DISCOGRAPHY_PARTITION } from '@shared/discography'
import type { InvokeChannel } from '@shared/ipc'
import type { MusicProvider } from '@shared/provider'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { setMediaHost } from '../protocol'
import { dbSettingsStore } from '../spotify/tokens'
import { LOGIN_URL, DiscographySession, type DgLoginWindow } from './session'

const CHANNELS: InvokeChannel[] = [
  'discography:getStatus',
  'discography:login',
  'discography:logout',
  'discography:search'
]

export interface DiscographyOptions {
  db: Db
  getWebContents: () => WebContents | undefined
  getParentWindow: () => BrowserWindow | undefined
}

const webPreferences = {
  partition: DISCOGRAPHY_PARTITION,
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false
}

function openLoginWindow(parent: BrowserWindow | undefined): DgLoginWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 760,
    parent,
    modal: !!parent,
    title: 'Log in to Discography',
    autoHideMenuBar: true,
    webPreferences
  })
  // "Continue with Discord / Google" may open popups: keep them in the same partition.
  win.webContents.setWindowOpenHandler(({ url }) =>
    url.startsWith('https://')
      ? {
          action: 'allow',
          overrideBrowserWindowOptions: { parent: win, autoHideMenuBar: true, webPreferences }
        }
      : { action: 'deny' }
  )
  const closed = new Promise<void>((resolve) => win.once('closed', () => resolve()))
  void win.loadURL(LOGIN_URL).catch((err) => console.warn('[discography] login page:', err))
  return {
    closed,
    close: () => {
      if (!win.isDestroyed()) win.close()
    },
    focus: () => {
      if (win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  }
}

export function registerDiscography(opts: DiscographyOptions): {
  provider: MusicProvider
  isConnected(): boolean
  dispose(): void
} {
  // Chromium's network stack (plain curl can't even finish TLS with this site) with the
  // partition's cookies. Electron's own user agent, as for SoundCloud.
  const ses = session.fromPartition(DISCOGRAPHY_PARTITION)
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> =>
    ses.fetch(url, { credentials: 'include', ...init })

  const dg = new DiscographySession({
    fetch: fetchFn,
    settings: dbSettingsStore(opts.db),
    openLoginWindow: () => openLoginWindow(opts.getParentWindow()),
    clearSite: async () => {
      await ses.clearStorageData({ origin: DISCOGRAPHY_ORIGIN })
      await ses.cookies.flushStore()
    },
    onStatus: (status) => emit(opts.getWebContents(), 'discography:status', status)
  })

  handle('discography:getStatus', () => dg.status)
  handle('discography:login', () => dg.login())
  handle('discography:logout', () => dg.logout())
  handle('discography:search', (query, page) =>
    dg.provider.search(String(query ?? ''), Number.isFinite(page) ? Math.max(0, page) : 0)
  )

  // media://discography/<id>: the signed MP3, fetched with the player's Range header.
  // Served from our own scheme so Web Audio (EQ, levelling, level bars) can read it.
  setMediaHost('discography', async (req, id) => {
    let url: string
    try {
      url = await dg.streamUrl(id)
    } catch (err) {
      console.warn('[discography] stream:', err instanceof Error ? err.message : String(err))
      return new Response(null, { status: 404 })
    }
    const range = req.headers.get('Range')
    return ses.fetch(url, { method: req.method, headers: range ? { Range: range } : {} })
  })

  void dg.start()

  return {
    provider: dg.provider,
    isConnected: () => dg.status.state === 'connected',
    dispose() {
      dg.dispose()
      setMediaHost('discography', null)
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
    }
  }
}
