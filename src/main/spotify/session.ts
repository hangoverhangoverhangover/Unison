// Spotify connection state: login/logout, status, and the objects built on the tokens.
// Electron-free so it can be tested; index.ts wires in safeStorage, shell and IPC.
import { SPOTIFY_SCOPES, type SpotifyStatus } from '@shared/spotify'
import type { Artist } from '@shared/types'
import { notConnectedMessage } from '../music/router'
import { SpotifyApi } from './api'
import { LoginCancelledError, runLoopbackLogin, type FetchFn, type TokenResponse } from './auth'
import { play } from './player'
import { SpotifyFollowScopeError, SpotifyProvider } from './provider'
import { TokenStore, type SecretBox, type SettingsStore, type SpotifyTokens } from './tokens'

export interface SessionOptions {
  clientId: string
  box: SecretBox
  settings: SettingsStore
  openExternal: (url: string) => Promise<void> | void
  onStatus: (status: SpotifyStatus) => void
  fetch?: FetchFn
  sleep?: (ms: number) => Promise<void>
  /** Override for tests; defaults to the loopback PKCE flow. */
  login?: (signal: AbortSignal) => Promise<TokenResponse>
}

interface SpMe {
  id: string
  display_name?: string | null
  /** Added May 2026; the stable user key when present. */
  account_id?: string
}

function sameStatus(a: SpotifyStatus, b: SpotifyStatus): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export class SpotifySession {
  readonly tokens: TokenStore
  readonly api: SpotifyApi
  readonly provider: SpotifyProvider
  private current: SpotifyStatus
  private loginAbort: AbortController | null = null
  private readonly fetchFn: FetchFn

  constructor(private readonly opts: SessionOptions) {
    this.fetchFn = opts.fetch ?? ((...a: Parameters<FetchFn>) => fetch(...a))
    this.tokens = new TokenStore({
      clientId: opts.clientId,
      box: opts.box,
      settings: opts.settings,
      fetch: this.fetchFn,
      onExpired: () => this.setStatus({ state: 'expired', reason: 'refresh' })
    })
    this.api = new SpotifyApi(this.tokens, { fetch: this.fetchFn, sleep: opts.sleep })
    this.provider = new SpotifyProvider({ api: this.api, getUserId: () => this.userId() })
    this.current = this.statusFromTokens(this.tokens.get())
  }

  get status(): SpotifyStatus {
    return this.current
  }

  /**
   * Opens the browser and waits for the callback. Only one login runs at a time: a new
   * call cancels the one in flight. Denial, timeout and cancellation resolve with the
   * unchanged status; other failures throw.
   */
  async login(): Promise<SpotifyStatus> {
    this.loginAbort?.abort()
    const abort = new AbortController()
    this.loginAbort = abort
    try {
      const res = this.opts.login
        ? await this.opts.login(abort.signal)
        : await runLoopbackLogin({
            clientId: this.opts.clientId,
            openExternal: this.opts.openExternal,
            fetch: this.fetchFn,
            signal: abort.signal
          })
      if (abort.signal.aborted) return this.current
      const me = await this.fetchMe(res.access_token)
      if (abort.signal.aborted) return this.current
      const tokens = this.tokens.fromResponse(res, {
        accountId: me.account_id || me.id,
        displayName: me.display_name || me.id,
        userId: me.id
      })
      this.tokens.set(tokens)
      this.setStatus(this.statusFromTokens(tokens))
      return this.current
    } catch (err) {
      if (err instanceof LoginCancelledError) return this.current
      throw err
    } finally {
      if (this.loginAbort === abort) this.loginAbort = null
    }
  }

  logout(): SpotifyStatus {
    this.loginAbort?.abort()
    this.loginAbort = null
    this.tokens.clear()
    this.setStatus({ state: 'disconnected', hasKey: true })
    return this.current
  }

  getAccessToken(): Promise<string> {
    return this.tokens.getAccessToken()
  }

  play(deviceId: string, nativeIds: string[], positionMs: number): Promise<void> {
    return play(this.api, deviceId, nativeIds, positionMs)
  }

  /**
   * spotify:getFollowings. `user-follow-read` is optional, so logins saved before the app
   * asked for it stay connected; only this call asks the user to log in again.
   */
  async getFollowings(): Promise<Artist[]> {
    if (this.current.state !== 'connected') throw new Error(notConnectedMessage('spotify'))
    if (!hasScope(this.tokens.get()?.scope, 'user-follow-read')) throw new SpotifyFollowScopeError()
    return this.provider.getFollowedArtists()
  }

  dispose(): void {
    this.loginAbort?.abort()
    this.loginAbort = null
  }

  private setStatus(next: SpotifyStatus): void {
    if (sameStatus(next, this.current)) return
    this.current = next
    this.opts.onStatus(next)
  }

  private statusFromTokens(t: SpotifyTokens | null): SpotifyStatus {
    if (!t) return { state: 'disconnected', hasKey: true }
    if (missingScopes(t.scope).length > 0) return { state: 'expired', reason: 'permissions' }
    return { state: 'connected', displayName: t.displayName, accountId: t.accountId }
  }

  /** `/me` with a token that isn't stored yet (login), so it bypasses the TokenStore. */
  private async fetchMe(accessToken: string): Promise<SpMe> {
    const api = new SpotifyApi(
      { getAccessToken: async () => accessToken, refresh: async () => accessToken },
      { fetch: this.fetchFn, sleep: this.opts.sleep }
    )
    const me = await api.get<SpMe>('/me')
    if (!me?.id) throw new Error('Spotify login worked, but the profile request returned no user.')
    return me
  }

  /** Stored user id, or one `/me` call for tokens saved before it was recorded. */
  private async userId(): Promise<string | undefined> {
    const t = this.tokens.get()
    if (!t) return undefined
    if (t.userId) return t.userId
    const me = await this.api.get<SpMe>('/me')
    const latest = this.tokens.get()
    if (me?.id && latest && latest.refreshToken === t.refreshToken)
      this.tokens.set({ ...latest, userId: me.id })
    return me?.id
  }
}

export function hasScope(granted: string | undefined, scope: string): boolean {
  return (granted ?? '').split(/\s+/).includes(scope)
}

/** Scopes the app needs that this login didn't grant. No recorded scope counts as none. */
export function missingScopes(granted: string | undefined): string[] {
  const have = new Set((granted ?? '').split(/\s+/).filter(Boolean))
  return SPOTIFY_SCOPES.filter((s) => !have.has(s))
}
