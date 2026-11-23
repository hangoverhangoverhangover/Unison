// Discography login state and the provider behind it. Electron-free so it can be tested;
// index.ts wires in the partition's Session.fetch, the login window and the cookies.
//
// Login: discography.stream signs in with Discord or Google and keeps the session in an
// HttpOnly cookie we never read. The login window shares the API's partition, so the app
// just asks GET /api/me until it names a user, then closes the window.
import type { DiscographyStatus } from '@shared/discography'
import type { MusicProvider } from '@shared/provider'
import type { LikedTrack, Playlist, Track } from '@shared/types'
import type { SettingsStore } from '../spotify/tokens'
import {
  DiscographyApi,
  DiscographyExpiredError,
  DiscographyNotConnectedError,
  type DgFetch,
  type DgMe
} from './api'
import { streamExpiry, toTrack } from './mapping'

/** Non-secret profile cache so a restart can show "connected" before /me answers. */
export const USER_KEY = 'discography.user'
export const LOGIN_URL = 'https://discography.stream/login'
export const LOGIN_POLL_MS = 2000
/** A signed stream URL is replaced this long before it expires. */
export const STREAM_MARGIN_MS = 10 * 60_000

export interface DgLoginWindow {
  /** Resolves when the window is closed, by the user or by close(). */
  closed: Promise<void>
  close(): void
  focus(): void
}

export interface DiscographySessionOptions {
  fetch: DgFetch
  settings: SettingsStore
  openLoginWindow: () => DgLoginWindow
  /** Removes the site's cookies and storage from the partition. */
  clearSite: () => Promise<void>
  onStatus: (status: DiscographyStatus) => void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  pollMs?: number
  log?: Pick<Console, 'warn'>
}

interface User {
  id: string
  username: string
  premium: boolean
}

function userFrom(me: DgMe): User {
  return {
    id: me.id,
    username: me.username?.trim() || 'Discography user',
    premium: me.premium === true
  }
}

const NOT_YET = "Discography likes and playlists aren't in the app yet."

export class DiscographySession {
  readonly api: DiscographyApi
  readonly provider: MusicProvider
  private user: User | null
  private current: DiscographyStatus
  private loginRun: { window: DgLoginWindow; promise: Promise<DiscographyStatus> } | null = null
  private generation = 0
  private disposed = false
  private readonly streams = new Map<string, { url: string; expiresAt: number }>()
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly log: Pick<Console, 'warn'>

  constructor(private readonly opts: DiscographySessionOptions) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.now = opts.now ?? Date.now
    this.log = opts.log ?? console
    this.api = new DiscographyApi({ fetch: opts.fetch, onUnauthorized: () => this.expire() })
    this.user = this.loadUser()
    this.current = this.user ? this.connected(this.user) : { state: 'disconnected' }
    this.provider = this.makeProvider()
  }

  get status(): DiscographyStatus {
    return this.current
  }

  /** Startup: check the saved login with /me in the background. */
  async start(): Promise<void> {
    const gen = this.generation
    try {
      const me = await this.api.me()
      if (gen !== this.generation) return
      if (me) this.adopt(me)
      else if (this.user) this.expire()
    } catch (err) {
      // Offline or the site is down: keep what we had; the next call will tell.
      this.log.warn('[discography] checking the login failed:', err)
    }
  }

  /**
   * Opens the discography.stream login window (one at a time; a second call focuses
   * it) and resolves once /me names a user, or with the old status if it's closed.
   */
  login(): Promise<DiscographyStatus> {
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

  private async runLogin(window: DgLoginWindow): Promise<DiscographyStatus> {
    const gen = ++this.generation
    let closed = false
    void window.closed.then(() => (closed = true))
    while (!closed && !this.disposed && gen === this.generation) {
      await this.sleep(this.opts.pollMs ?? LOGIN_POLL_MS)
      if (closed || this.disposed || gen !== this.generation) break
      try {
        const me = await this.api.me()
        if (me && gen === this.generation) {
          this.adopt(me)
          window.close()
          break
        }
      } catch {
        // Not logged in yet, or a network hiccup: keep waiting while the window is open.
      }
    }
    return this.current
  }

  async logout(): Promise<DiscographyStatus> {
    this.generation++
    this.loginRun?.window.close()
    await this.api.logout()
    try {
      await this.opts.clearSite()
    } catch (err) {
      this.log.warn('[discography] clearing the login failed:', err)
    }
    this.user = null
    this.opts.settings.delete(USER_KEY)
    this.streams.clear()
    this.setStatus({ state: 'disconnected' })
    return this.current
  }

  dispose(): void {
    this.disposed = true
    this.loginRun?.window.close()
  }

  /**
   * A signed MP3 URL for the track, reused until shortly before it expires. Needs no
   * cookies, so the media protocol can fetch it directly.
   */
  async streamUrl(nativeId: string): Promise<string> {
    this.requireConnected()
    const hit = this.streams.get(nativeId)
    if (hit && this.now() < hit.expiresAt - STREAM_MARGIN_MS) return hit.url
    const t = await this.api.playback(nativeId)
    if (t.available === false) throw new Error("This song isn't available on Discography.")
    const url = typeof t.stream_url === 'string' ? t.stream_url : ''
    if (!url.startsWith('https://')) throw new Error('Discography sent no stream for this song.')
    // No expiry in the URL: assume an hour.
    const expiresAt = streamExpiry(url) ?? this.now() + 60 * 60_000
    this.streams.set(nativeId, { url, expiresAt })
    if (this.streams.size > 200) this.streams.delete(this.streams.keys().next().value!)
    return url
  }

  private requireConnected(): void {
    if (this.current.state === 'expired') throw new DiscographyExpiredError()
    if (this.current.state !== 'connected') throw new DiscographyNotConnectedError()
  }

  private makeProvider(): MusicProvider {
    return {
      search: async (query: string, page: number): Promise<Track[]> => {
        this.requireConnected()
        if (!query.trim()) return []
        const res = await this.api.search(query, Math.max(0, page) * 30)
        return (Array.isArray(res.tracks) ? res.tracks : [])
          .map(toTrack)
          .filter((t): t is Track => t !== null)
      },
      // Library sync comes later; for now Discography adds nothing to Liked Songs.
      getLikes: async (): Promise<LikedTrack[]> => [],
      like: async () => {
        throw new Error(NOT_YET)
      },
      unlike: async () => {
        throw new Error(NOT_YET)
      },
      getPlaylists: async (): Promise<Playlist[]> => [],
      getPlaylistTracks: async () => {
        throw new Error(NOT_YET)
      }
    }
  }

  private connected(user: User): DiscographyStatus {
    return {
      state: 'connected',
      username: user.username,
      userId: user.id,
      premium: user.premium
    }
  }

  private adopt(me: DgMe): void {
    const user = userFrom(me)
    this.user = user
    this.opts.settings.set(USER_KEY, JSON.stringify(user))
    this.setStatus(this.connected(user))
  }

  private expire(): void {
    if (this.current.state !== 'connected') return
    this.streams.clear()
    this.setStatus({ state: 'expired' })
  }

  private loadUser(): User | null {
    try {
      const raw = this.opts.settings.get(USER_KEY)
      const v = raw ? (JSON.parse(raw) as Partial<User>) : null
      return v && typeof v.id === 'string' && typeof v.username === 'string'
        ? { id: v.id, username: v.username, premium: v.premium === true }
        : null
    } catch {
      return null
    }
  }

  private setStatus(next: DiscographyStatus): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return
    this.current = next
    this.opts.onStatus(next)
  }
}
