// SoundCloud web-session IPC: wires the session to Electron (partition cookies,
// Chromium Session.fetch, the login BrowserWindow) and registers soundcloud:* handlers.
import { BrowserWindow, ipcMain, session, type Cookie, type WebContents } from 'electron'
import type { InvokeChannel } from '@shared/ipc'
import { UnplayableTrackError, type SoundCloudProvider } from '@shared/provider'
import { SOUNDCLOUD_PARTITION } from '@shared/soundcloud'
import type { Db } from '../db'
import { emit, handle } from '../ipc'
import { dbSettingsStore } from '../spotify/tokens'
import type { ScFetch } from './clientId'
import { LOGIN_URL, SoundCloudSession, type CookieJar, type LoginWindow } from './session'

export { SoundCloudWebProvider } from './provider'

const CHANNELS: InvokeChannel[] = [
  'soundcloud:getStatus',
  'soundcloud:login',
  'soundcloud:logout',
  'soundcloud:loginWithToken',
  'soundcloud:getStream',
  'soundcloud:getWaveform',
  'soundcloud:getComments',
  'soundcloud:getTrackPage',
  'soundcloud:searchSets',
  'soundcloud:postComment',
  'soundcloud:getFeed',
  'soundcloud:getReposts',
  'soundcloud:getFollowings',
  'soundcloud:isFollowing',
  'soundcloud:setFollowing',
  'soundcloud:isReposted',
  'soundcloud:setReposted'
]

const SC_URL = 'https://soundcloud.com'

export interface SoundCloudOptions {
  db: Db
  getWebContents: () => WebContents | undefined
  getParentWindow: () => BrowserWindow | undefined
}

function isScCookie(c: Cookie): boolean {
  const d = (c.domain ?? '').replace(/^\./, '').toLowerCase()
  return d === 'soundcloud.com' || d.endsWith('.soundcloud.com')
}

function partitionJar(ses: Electron.Session): CookieJar {
  const read = async (name: string): Promise<string | undefined> =>
    (await ses.cookies.get({ url: SC_URL, name }))[0]?.value || undefined
  return {
    getToken: () => read('oauth_token'),
    getDataDome: () => read('datadome'),
    async setToken(token) {
      await ses.cookies.set({
        url: SC_URL,
        name: 'oauth_token',
        value: token,
        secure: true,
        expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      })
      await ses.cookies.flushStore()
    },
    onTokenChange(listener) {
      const onChanged = (_e: Electron.Event, cookie: Cookie): void => {
        if (cookie.name === 'oauth_token' && isScCookie(cookie)) listener()
      }
      ses.cookies.on('changed', onChanged)
      return () => void ses.cookies.removeListener('changed', onChanged)
    },
    async clear() {
      await ses.clearStorageData({ origin: SC_URL })
      const all = await ses.cookies.get({})
      await Promise.all(
        all.filter(isScCookie).map((c) => {
          const host = (c.domain ?? '').replace(/^\./, '')
          return ses.cookies.remove(`https://${host}${c.path ?? '/'}`, c.name)
        })
      )
      await ses.cookies.flushStore()
    }
  }
}

function openLoginWindow(parent: BrowserWindow | undefined): LoginWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    parent,
    modal: !!parent,
    title: 'Log in to SoundCloud',
    autoHideMenuBar: true,
    webPreferences: {
      partition: SOUNDCLOUD_PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  // "Continue with Google/Apple/Facebook" open popups; keep them in the same partition.
  win.webContents.setWindowOpenHandler(({ url }) =>
    url.startsWith('https://')
      ? {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: win,
            autoHideMenuBar: true,
            webPreferences: {
              partition: SOUNDCLOUD_PARTITION,
              contextIsolation: true,
              sandbox: true,
              nodeIntegration: false
            }
          }
        }
      : { action: 'deny' }
  )
  const closed = new Promise<void>((resolve) => win.once('closed', () => resolve()))
  void win.loadURL(LOGIN_URL).catch((err) => console.warn('[soundcloud] login page:', err))
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

export function registerSoundCloud(opts: SoundCloudOptions): {
  provider: SoundCloudProvider
  isConnected(): boolean
  /** The oauth_token from the login partition, when logged in. Never log it. */
  getOAuthToken(): Promise<string | undefined>
  dispose(): void
} {
  // Keep Electron's own user agent: a Chrome UA on an Electron fingerprint is exactly the
  // kind of mismatch DataDome flags (the login window was hard-blocked with it).
  const ses = session.fromPartition(SOUNDCLOUD_PARTITION)
  // Chromium network stack with the partition's cookies (DataDome, refresh token).
  const fetchFn: ScFetch = (url, init) => ses.fetch(url, { credentials: 'include', ...init })

  const jar = partitionJar(ses)
  const sc = new SoundCloudSession({
    fetch: fetchFn,
    settings: dbSettingsStore(opts.db),
    jar,
    openLoginWindow: () => openLoginWindow(opts.getParentWindow()),
    // Session.fetch sends the partition's user agent; the follow signature must match it.
    getUserAgent: () => ses.getUserAgent(),
    onStatus: (status) => emit(opts.getWebContents(), 'soundcloud:status', status)
  })

  handle('soundcloud:getStatus', () => sc.status)
  handle('soundcloud:login', () => sc.login())
  handle('soundcloud:logout', () => sc.logout())
  handle('soundcloud:loginWithToken', (token) => sc.loginWithToken(token))
  handle('soundcloud:getWaveform', (nativeId) => sc.provider.getWaveform(nativeId))
  handle('soundcloud:getComments', (nativeId) => sc.provider.getComments(nativeId))
  handle('soundcloud:getTrackPage', (nativeId) => sc.provider.getTrackPage(nativeId))
  handle('soundcloud:searchSets', (query) => sc.provider.searchSets(query))
  handle('soundcloud:postComment', (nativeId, body, timestampMs) =>
    sc.provider.postComment(nativeId, body, timestampMs)
  )
  // Social (QoL round 2). setFollowing / setReposted are public actions: the renderer
  // confirms with the user before invoking them; nothing in main calls them.
  handle('soundcloud:getFeed', (cursor) => sc.social.getFeed(cursor))
  handle('soundcloud:getReposts', (userId, cursor) => sc.social.getReposts(userId, cursor))
  handle('soundcloud:getFollowings', () => sc.social.getFollowings())
  handle('soundcloud:isFollowing', (userId) => sc.social.isFollowing(userId))
  handle('soundcloud:setFollowing', (userId, follow) =>
    sc.social.setFollowing(userId, follow === true)
  )
  handle('soundcloud:isReposted', (trackId) => sc.social.isReposted(trackId))
  handle('soundcloud:setReposted', (trackId, repost) =>
    sc.social.setReposted(trackId, repost === true)
  )
  handle('soundcloud:getStream', async (nativeId) => {
    try {
      return await sc.provider.getStreamUrl(nativeId)
    } catch (err) {
      // Electron forwards only the message of a thrown error; make it the plain one.
      if (err instanceof UnplayableTrackError) throw new Error(err.message, { cause: err })
      throw err
    }
  })

  void sc.start()

  return {
    provider: sc.provider,
    isConnected: () => sc.status.state === 'connected',
    getOAuthToken: () => jar.getToken().catch(() => undefined),
    dispose() {
      sc.dispose()
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
    }
  }
}
