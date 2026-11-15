// Encrypted Spotify token storage plus access-token refresh.
import type { Db } from '../db'
import { isInvalidGrant, refreshTokens, type FetchFn, type TokenResponse } from './auth'

export const TOKENS_KEY = 'spotify.tokens'
/** Refresh when the access token has less than this left. */
export const REFRESH_MARGIN_MS = 60_000

export interface SpotifyTokens {
  refreshToken: string
  accessToken: string
  /** Epoch ms. */
  expiresAt: number
  /** `account_id` from GET /me when present, else the user `id`. */
  accountId: string
  displayName: string
  /** Spotify user `id`, compared against playlist `owner.id`. */
  userId?: string
  /** Space-separated scopes Spotify granted (token response `scope`). */
  scope?: string
}

/** The subset of Electron's `safeStorage` we use, so tests can inject a fake. */
export interface SecretBox {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(cipher: Buffer): string
}

/** Key/value access to the `settings` table (values are JSON text). */
export interface SettingsStore {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
}

export function dbSettingsStore(db: Db): SettingsStore {
  const get = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
  const set = db.prepare<[string, string]>(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  )
  const del = db.prepare<[string]>('DELETE FROM settings WHERE key = ?')
  return {
    get: (key) => get.get(key)?.value,
    set: (key, value) => void set.run(key, value),
    delete: (key) => void del.run(key)
  }
}

export class SpotifyNotConnectedError extends Error {
  constructor(message = "Spotify isn't connected. Connect it in Settings.") {
    super(message)
    this.name = 'SpotifyNotConnectedError'
  }
}

export class SpotifyLoginExpiredError extends SpotifyNotConnectedError {
  constructor() {
    super('Your Spotify login has expired. Log in again in Settings.')
    this.name = 'SpotifyLoginExpiredError'
  }
}

export interface TokenStoreOptions {
  clientId: string
  box: SecretBox
  settings: SettingsStore
  fetch?: FetchFn
  now?: () => number
  /** Called after `400 invalid_grant` has cleared the tokens. */
  onExpired?: () => void
  log?: Pick<Console, 'warn'>
}

function isTokens(v: unknown): v is SpotifyTokens {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return (
    typeof t.refreshToken === 'string' &&
    typeof t.accessToken === 'string' &&
    typeof t.expiresAt === 'number' &&
    typeof t.accountId === 'string' &&
    typeof t.displayName === 'string'
  )
}

/**
 * Holds the tokens in memory and mirrors them, encrypted with safeStorage, into
 * `settings['spotify.tokens']` as a JSON string of base64 ciphertext. Without
 * encryption the tokens stay in memory only and are lost on restart.
 */
export class TokenStore {
  private tokens: SpotifyTokens | null = null
  private refreshing: Promise<string> | null = null
  /** Bumped on every set/clear so a refresh racing a logout can't resurrect tokens. */
  private generation = 0
  private warnedNoCrypto = false
  private readonly fetchFn: FetchFn
  private readonly now: () => number
  private readonly log: Pick<Console, 'warn'>

  constructor(private readonly opts: TokenStoreOptions) {
    this.fetchFn = opts.fetch ?? ((...a: Parameters<FetchFn>) => fetch(...a))
    this.now = opts.now ?? Date.now
    this.log = opts.log ?? console
    this.tokens = this.load()
  }

  get(): SpotifyTokens | null {
    return this.tokens ? { ...this.tokens } : null
  }

  set(tokens: SpotifyTokens): void {
    this.generation++
    this.refreshing = null
    this.tokens = { ...tokens }
    this.persist()
  }

  clear(): void {
    this.generation++
    this.refreshing = null
    this.tokens = null
    this.opts.settings.delete(TOKENS_KEY)
  }

  /** Builds stored tokens from a token response (login or refresh). */
  fromResponse(
    res: TokenResponse,
    account: Pick<SpotifyTokens, 'accountId' | 'displayName' | 'userId' | 'scope'>,
    previousRefreshToken?: string
  ): SpotifyTokens {
    const refreshToken = res.refresh_token ?? previousRefreshToken
    if (!refreshToken) throw new Error('Spotify did not return a refresh token.')
    const tokens: SpotifyTokens = {
      refreshToken,
      accessToken: res.access_token,
      expiresAt: this.now() + res.expires_in * 1000,
      accountId: account.accountId,
      displayName: account.displayName
    }
    if (account.userId) tokens.userId = account.userId
    // Refresh responses may omit `scope`; keep what the login granted.
    const scope = res.scope ?? account.scope
    if (scope) tokens.scope = scope
    return tokens
  }

  /** A valid access token, refreshed first if it expires within 60 s. */
  async getAccessToken(): Promise<string> {
    const t = this.tokens
    if (!t) throw new SpotifyNotConnectedError()
    if (t.expiresAt - this.now() > REFRESH_MARGIN_MS) return t.accessToken
    return this.refresh()
  }

  /** Force a refresh (used after a 401). Concurrent callers share one request. */
  refresh(): Promise<string> {
    if (!this.tokens) return Promise.reject(new SpotifyNotConnectedError())
    if (!this.refreshing) {
      const p = this.doRefresh(this.tokens, this.generation)
      this.refreshing = p
      const done = (): void => {
        if (this.refreshing === p) this.refreshing = null
      }
      p.then(done, done)
    }
    return this.refreshing
  }

  private async doRefresh(current: SpotifyTokens, gen: number): Promise<string> {
    let res: TokenResponse
    try {
      res = await refreshTokens(this.fetchFn, {
        clientId: this.opts.clientId,
        refreshToken: current.refreshToken
      })
    } catch (err) {
      if (isInvalidGrant(err)) {
        // Refresh token expired (6 months) or revoked: don't retry, require a new login.
        if (gen === this.generation) {
          this.clear()
          this.opts.onExpired?.()
        }
        throw new SpotifyLoginExpiredError()
      }
      throw err
    }
    if (gen !== this.generation) {
      // Logged out or logged in again while refreshing: drop this result.
      if (!this.tokens) throw new SpotifyNotConnectedError()
      return this.tokens.accessToken
    }
    // Rotation: keep the old refresh token unless Spotify sent a new one.
    this.tokens = this.fromResponse(res, current, current.refreshToken)
    this.persist()
    return this.tokens.accessToken
  }

  private persist(): void {
    if (!this.tokens) return
    if (!this.opts.box.isEncryptionAvailable()) {
      if (!this.warnedNoCrypto) {
        this.warnedNoCrypto = true
        this.log.warn(
          '[spotify] OS encryption is unavailable; tokens are kept in memory only and you will need to log in again after restart.'
        )
      }
      this.opts.settings.delete(TOKENS_KEY)
      return
    }
    const cipher = this.opts.box.encryptString(JSON.stringify(this.tokens))
    this.opts.settings.set(TOKENS_KEY, JSON.stringify(cipher.toString('base64')))
  }

  private load(): SpotifyTokens | null {
    const raw = this.opts.settings.get(TOKENS_KEY)
    if (raw === undefined) return null
    if (!this.opts.box.isEncryptionAvailable()) {
      this.log.warn('[spotify] OS encryption is unavailable; stored Spotify login ignored.')
      return null
    }
    try {
      const b64 = JSON.parse(raw) as unknown
      if (typeof b64 !== 'string') throw new Error('not a string')
      const parsed = JSON.parse(this.opts.box.decryptString(Buffer.from(b64, 'base64'))) as unknown
      if (!isTokens(parsed)) throw new Error('unexpected shape')
      return parsed
    } catch (err) {
      this.log.warn('[spotify] stored tokens could not be read; discarding them:', err)
      this.opts.settings.delete(TOKENS_KEY)
      return null
    }
  }
}
