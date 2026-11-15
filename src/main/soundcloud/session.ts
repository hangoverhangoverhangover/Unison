// SoundCloud web-session connection state: login window, the oauth_token cookie (held
// in memory only), token refresh, status. Electron-free so it can be tested; index.ts
// wires in the partition's cookies, Session.fetch and the BrowserWindow.
import type { SoundCloudStatus } from '@shared/soundcloud'
import type { SettingsStore } from '../spotify/tokens'
import {
  isDataDomeBlock,
  SoundCloudApi,
  SoundCloudDataDomeError,
  SoundCloudLoginExpiredError,
  SoundCloudNotConnectedError,
  WEB_HEADERS,
  type ScAuthSource
} from './api'
import { ClientIdStore, type ScFetch } from './clientId'
import { FollowSecretStore } from './followSignature'
import { SoundCloudWebProvider, type ScUserRef } from './provider'
import { SoundCloudSocial } from './social'

/** Non-secret profile cache so a restart can show "connected" before /me answers. */
export const USER_KEY = 'soundcloud.user'
export const REFRESH_URL = 'https://soundcloud.com/n/api/refresh-token'
export const LOGIN_URL = 'https://soundcloud.com/signin'
export const LOGIN_POLL_MS = 1000

/** The partition's soundcloud.com cookies. */
export interface CookieJar {
  /** `oauth_token` on https://soundcloud.com. */
  getToken(): Promise<string | undefined>
  /** `datadome` cookie, sent as `x-datadome-clientid`. */
  getDataDome(): Promise<string | undefined>
  /** Stores `oauth_token` on https://soundcloud.com (pasted-token login). */
  setToken(token: string): Promise<void>
  /** Fires when the `oauth_token` cookie is set or removed. Returns an unsubscribe. */
  onTokenChange(listener: () => void): () => void
  /** Removes soundcloud.com cookies and site storage. */
  clear(): Promise<void>
}

export interface LoginWindow {
  /** Resolves when the window is closed, by the user or by close(). */
  closed: Promise<void>
  close(): void
  focus(): void
}

export interface SessionOptions {
  fetch: ScFetch
  settings: SettingsStore
  jar: CookieJar
  openLoginWindow: () => LoginWindow
  onStatus: (status: SoundCloudStatus) => void
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  /** User-Agent the fetch sends (the follow signature mixes it in). Follow fails without it. */
  getUserAgent?: () => string
  log?: Pick<Console, 'warn'>
}

interface ScMe {
  id?: number | string
  username?: string
}

function sameStatus(a: SoundCloudStatus, b: SoundCloudStatus): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function connected(user: ScUserRef): SoundCloudStatus {
  return { state: 'connected', username: user.username, userId: user.id, adapter: 'web' }
}

export class SoundCloudSession {
  readonly clientIds: ClientIdStore
  readonly api: SoundCloudApi
  readonly provider: SoundCloudWebProvider
  readonly social: SoundCloudSocial
  private token: string | null = null
  private user: ScUserRef | null
  private current: SoundCloudStatus
  private tokenLoaded: Promise<void> = Promise.resolve()
  private ready: Promise<void> = Promise.resolve()
  private refreshing: Promise<string | null> | null = null
  /** Bumped on login/logout so a refresh racing them can't resurrect an old token. */
  private generation = 0
  private loginRun: { window: LoginWindow; promise: Promise<SoundCloudStatus> } | null = null
  private disposed = false
  private readonly log: Pick<Console, 'warn'>

  constructor(private readonly opts: SessionOptions) {
    this.log = opts.log ?? console
    this.clientIds = new ClientIdStore({
      fetch: opts.fetch,
      settings: opts.settings,
      log: this.log
    })
    this.api = new SoundCloudApi({
      fetch: opts.fetch,
      clientIds: this.clientIds,
      auth: this.authSource(),
      sleep: opts.sleep,
      log: this.log
    })
    this.provider = new SoundCloudWebProvider({
      api: this.api,
      fetch: opts.fetch,
      requireUser: () => this.requireUser()
    })
    this.social = new SoundCloudSocial({
      api: this.api,
      clientIds: this.clientIds,
      secrets: new FollowSecretStore({ fetch: opts.fetch, log: this.log }),
      requireUser: () => this.requireUser(),
      getUserAgent: opts.getUserAgent
    })
    this.user = this.loadUser()
    this.current = this.user ? connected(this.user) : { state: 'disconnected' }
  }

  get status(): SoundCloudStatus {
    return this.current
  }

  /**
   * Startup: warm the client_id (cached or scraped) and, if the partition already holds
   * an `oauth_token`, validate it with /me in the background.
   */
  start(): Promise<void> {
    void this.clientIds.get().catch((err) => this.log.warn('[soundcloud] client_id:', err))
    this.tokenLoaded = this.opts.jar.getToken().then(
      (t) => {
        this.token = t ?? null
      },
      () => undefined
    )
    this.ready = this.tokenLoaded.then(() => this.validateStored())
    return this.ready
  }

  /**
   * Opens the soundcloud.com login window (one at a time; a second call focuses it) and
   * resolves when a new `oauth_token` works with /me, or with the unchanged status when
   * the user closes the window.
   */
  login(): Promise<SoundCloudStatus> {
    if (this.loginRun) {
      this.loginRun.window.focus()
      return this.loginRun.promise
    }
    const window = this.opts.openLoginWindow()
    const run = { window, promise: Promise.resolve(this.current) }
    run.promise = this.runLogin(window).finally(() => {
      if (this.loginRun === run) this.loginRun = null
    })
    this.loginRun = run
    return run.promise
  }

  /**
   * Connect with an `oauth_token` the user copied from soundcloud.com in their own
   * browser. Checked with /me before it's stored in the partition's cookie jar.
   */
  async loginWithToken(raw: string): Promise<SoundCloudStatus> {
    const token = String(raw ?? '')
      .trim()
      .replace(/^OAuth\s+/i, '')
    if (!/^[\w.~+/=-]{10,512}$/.test(token)) {
      throw new Error(
        "That doesn't look like a SoundCloud token. Copy the oauth_token cookie's value exactly."
      )
    }
    this.loginRun?.window.close()
    if (!(await this.tryToken(token))) {
      throw new Error(
        "SoundCloud didn't accept that token. Log in on soundcloud.com in your browser and copy oauth_token again."
      )
    }
    await this.opts.jar.setToken(token)
    return this.current
  }

  async logout(): Promise<SoundCloudStatus> {
    this.generation++
    this.token = null
    this.user = null
    this.opts.settings.delete(USER_KEY)
    this.provider.reset()
    this.social.reset()
    this.setStatus({ state: 'disconnected' })
    this.loginRun?.window.close()
    try {
      await this.opts.jar.clear()
    } catch (err) {
      this.log.warn('[soundcloud] clearing cookies failed:', err)
    }
    return this.current
  }

  dispose(): void {
    this.disposed = true
    this.loginRun?.window.close()
  }

  /** The logged-in user, or the not-connected / expired error. */
  async requireUser(): Promise<ScUserRef> {
    await this.ready
    if (this.current.state === 'connected' && this.user && this.token) return this.user
    if (this.current.state === 'expired') throw new SoundCloudLoginExpiredError()
    throw new SoundCloudNotConnectedError()
  }

  private authSource(): ScAuthSource {
    return {
      getToken: async () => {
        await this.tokenLoaded
        return this.token
      },
      refresh: (stale) => {
        this.refreshing ??= this.refreshToken(stale).finally(() => {
          this.refreshing = null
        })
        return this.refreshing
      },
      onExpired: () => this.expire(),
      getDataDomeClientId: () => this.opts.jar.getDataDome().catch(() => undefined)
    }
  }

  /**
   * After a 401: the page may already have rotated the cookie; otherwise ask the web
   * app's refresh proxy (which reads the `oauth_refresh_token` cookie) and re-read it.
   */
  private async refreshToken(stale: string): Promise<string | null> {
    const gen = this.generation
    const adopt = (t: string | null | undefined): string | null => {
      if (!t || t === stale || gen !== this.generation) return null
      this.token = t
      return t
    }
    const before = await this.opts.jar.getToken().catch(() => undefined)
    if (adopt(before)) return before!

    let fromBody: string | undefined
    try {
      const res = await this.opts.fetch(REFRESH_URL, {
        method: 'POST',
        headers: { ...WEB_HEADERS, Accept: 'application/json' }
      })
      const text = await res.text()
      if (isDataDomeBlock(res, text)) throw new SoundCloudDataDomeError()
      if (!res.ok) this.log.warn(`[soundcloud] token refresh answered ${res.status}`)
      try {
        const body = JSON.parse(text) as Record<string, unknown>
        const t = body.access_token ?? body.oauth_token
        if (typeof t === 'string') fromBody = t
      } catch {
        // Empty or non-JSON body: the cookie is what matters.
      }
    } catch (err) {
      if (err instanceof SoundCloudDataDomeError) throw err
      this.log.warn('[soundcloud] token refresh failed:', (err as Error)?.message ?? err)
    }
    const after = await this.opts.jar.getToken().catch(() => undefined)
    return adopt(after) ?? adopt(fromBody)
  }

  private expire(): void {
    if (!this.token && this.current.state !== 'connected') return
    this.token = null
    this.user = null
    this.opts.settings.delete(USER_KEY)
    this.provider.reset()
    this.social.reset()
    this.setStatus({ state: 'expired' })
  }

  private async validateStored(): Promise<void> {
    if (!this.token) {
      this.user = null
      this.opts.settings.delete(USER_KEY)
      this.setStatus({ state: 'disconnected' })
      return
    }
    try {
      const me = await this.fetchMe(this.api)
      this.setUser(me)
    } catch (err) {
      if (err instanceof SoundCloudNotConnectedError) return // expire() already ran
      // Offline or DataDome: keep the cached profile if there is one.
      this.log.warn('[soundcloud] could not validate the saved login:', (err as Error)?.message)
    }
  }

  private async fetchMe(api: SoundCloudApi): Promise<ScUserRef> {
    const me = await api.get<ScMe>('me', undefined, 'required')
    const id =
      typeof me?.id === 'number' ? String(me.id) : typeof me?.id === 'string' ? me.id : undefined
    if (!id || !/^\d+$/.test(id))
      throw new Error('SoundCloud login worked, but the profile request returned no user.')
    return { id, username: me?.username || id }
  }

  /** /me with a token that isn't adopted yet, bypassing refresh and expiry. */
  private async tryToken(token: string): Promise<boolean> {
    const api = new SoundCloudApi({
      fetch: this.opts.fetch,
      clientIds: this.clientIds,
      auth: {
        getToken: async () => token,
        refresh: async () => null,
        onExpired: () => undefined,
        getDataDomeClientId: () => this.opts.jar.getDataDome().catch(() => undefined)
      },
      sleep: this.opts.sleep,
      log: this.log
    })
    try {
      const me = await this.fetchMe(api)
      this.generation++
      this.token = token
      this.setUser(me)
      return true
    } catch (err) {
      this.log.warn('[soundcloud] login check failed:', (err as Error)?.message)
      return false
    }
  }

  private runLogin(window: LoginWindow): Promise<SoundCloudStatus> {
    return new Promise((resolve) => {
      let done = false
      let checking = false
      let lastTried: string | undefined
      let unsubscribe = (): void => undefined
      let timer: ReturnType<typeof setInterval> | undefined

      const finish = (): void => {
        if (done) return
        done = true
        unsubscribe()
        if (timer) clearInterval(timer)
        resolve(this.current)
      }

      const check = async (): Promise<void> => {
        if (done || checking) return
        checking = true
        try {
          const token = await this.opts.jar.getToken()
          if (!token || token === lastTried || done) return
          lastTried = token
          if (await this.tryToken(token)) {
            finish()
            window.close()
          }
        } catch (err) {
          this.log.warn('[soundcloud] login watch:', (err as Error)?.message)
        } finally {
          checking = false
        }
      }

      // The cookie that's there when the window opens is the old login (or none); only a
      // new one counts as a fresh login.
      void this.opts.jar
        .getToken()
        .catch(() => undefined)
        .then((initial) => {
          if (done) return
          lastTried = initial
          unsubscribe = this.opts.jar.onTokenChange(() => void check())
          timer = setInterval(() => void check(), this.opts.pollMs ?? LOGIN_POLL_MS)
        })

      void window.closed.then(async () => {
        if (done) return
        unsubscribe()
        if (timer) clearInterval(timer)
        // The page may have refreshed the token, or the user may have solved a DataDome
        // check while already logged in: re-check what the partition holds now.
        if (!this.disposed) {
          const token = await this.opts.jar.getToken().catch(() => undefined)
          if (token && (token !== this.token || this.current.state !== 'connected'))
            await this.tryToken(token)
        }
        finish()
      })
    })
  }

  private setUser(me: ScUserRef): void {
    if (this.user && this.user.id !== me.id) {
      this.provider.reset()
      this.social.reset()
    }
    this.user = me
    this.opts.settings.set(USER_KEY, JSON.stringify(me))
    this.setStatus(connected(me))
  }

  private setStatus(next: SoundCloudStatus): void {
    if (sameStatus(next, this.current)) return
    this.current = next
    this.opts.onStatus(next)
  }

  private loadUser(): ScUserRef | null {
    const raw = this.opts.settings.get(USER_KEY)
    if (!raw) return null
    try {
      const v = JSON.parse(raw) as Partial<ScUserRef>
      return typeof v.id === 'string' && typeof v.username === 'string'
        ? { id: v.id, username: v.username }
        : null
    } catch {
      return null
    }
  }
}
