import { describe, expect, it, vi } from 'vitest'
import { SPOTIFY_SCOPES, type SpotifyStatus } from '@shared/spotify'
import { LoginCancelledError, type TokenResponse } from './auth'
import { missingScopes, SpotifySession } from './session'
import {
  fakeBox,
  json,
  memorySettings,
  scriptedFetch,
  type Responder,
  type ScriptedFetch
} from './testing'

const TOKENS: TokenResponse = {
  access_token: 'at',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'rt',
  scope: SPOTIFY_SCOPES.join(' ')
}

function setup(
  login: (signal: AbortSignal) => Promise<TokenResponse>,
  ...responders: Responder[]
): {
  session: SpotifySession
  statuses: SpotifyStatus[]
  fetch: ScriptedFetch
  settings: ReturnType<typeof memorySettings>
} {
  const fetch = scriptedFetch(...responders)
  const statuses: SpotifyStatus[] = []
  const settings = memorySettings()
  const session = new SpotifySession({
    clientId: 'cid',
    box: fakeBox(),
    settings,
    fetch,
    login,
    openExternal: () => {},
    onStatus: (s) => statuses.push(s)
  })
  return { session, statuses, fetch, settings }
}

describe('SpotifySession', () => {
  it('starts disconnected with a key', () => {
    const { session } = setup(async () => TOKENS)
    expect(session.status).toEqual({ state: 'disconnected', hasKey: true })
  })

  it('logs in, reads /me (account_id preferred) and emits connected', async () => {
    const { session, statuses, fetch } = setup(
      async () => TOKENS,
      () => json({ id: 'user1', display_name: 'Tripp', account_id: 'acct-9' })
    )
    const status = await session.login()
    expect(status).toEqual({ state: 'connected', displayName: 'Tripp', accountId: 'acct-9' })
    expect(statuses).toEqual([status])
    expect(fetch.calls[0]!.url).toBe('https://api.spotify.com/v1/me')
    expect(fetch.calls[0]!.headers.Authorization).toBe('Bearer at')
    expect(session.tokens.get()).toMatchObject({ refreshToken: 'rt', userId: 'user1' })
  })

  it('falls back to id when account_id is missing', async () => {
    const { session } = setup(
      async () => TOKENS,
      () => json({ id: 'user1', display_name: null })
    )
    await expect(session.login()).resolves.toEqual({
      state: 'connected',
      displayName: 'user1',
      accountId: 'user1'
    })
  })

  it('returns the unchanged status when login is denied', async () => {
    const { session, statuses } = setup(async () => {
      throw new LoginCancelledError('denied', 'no')
    })
    await expect(session.login()).resolves.toEqual({ state: 'disconnected', hasKey: true })
    expect(statuses).toEqual([])
  })

  it('cancels an in-flight login when a new one starts', async () => {
    const signals: AbortSignal[] = []
    const login = vi.fn(
      (signal: AbortSignal) =>
        new Promise<TokenResponse>((resolve, reject) => {
          signals.push(signal)
          if (signals.length === 1)
            signal.addEventListener('abort', () => reject(new LoginCancelledError('aborted', 'x')))
          else resolve(TOKENS)
        })
    )
    const { session } = setup(login, () => json({ id: 'u', display_name: 'U' }))
    const first = session.login()
    const second = session.login()
    expect(signals[0]!.aborted).toBe(true)
    await expect(second).resolves.toMatchObject({ state: 'connected' })
    await expect(first).resolves.toBeDefined()
  })

  it('emits expired when refresh hits invalid_grant', async () => {
    const { session, statuses } = setup(
      async () => ({ ...TOKENS, expires_in: 0 }),
      () => json({ id: 'u', display_name: 'U' }),
      () => json({ error: 'invalid_grant' }, 400)
    )
    await session.login()
    await expect(session.getAccessToken()).rejects.toThrow(/expired/)
    expect(session.status).toEqual({ state: 'expired', reason: 'refresh' })
    expect(statuses.at(-1)).toEqual({ state: 'expired', reason: 'refresh' })
  })

  it('logs out and clears stored tokens', async () => {
    const { session, statuses, settings } = setup(
      async () => TOKENS,
      () => json({ id: 'u', display_name: 'U' })
    )
    await session.login()
    expect(settings.data.size).toBe(1)
    expect(session.logout()).toEqual({ state: 'disconnected', hasKey: true })
    expect(settings.data.size).toBe(0)
    expect(statuses.at(-1)).toEqual({ state: 'disconnected', hasKey: true })
    await expect(session.provider.getLikes()).rejects.toThrow("Spotify isn't connected")
  })
})

describe('missingScopes', () => {
  it('lists required scopes a saved login lacks', () => {
    expect(missingScopes(SPOTIFY_SCOPES.join(' '))).toEqual([])
    expect(missingScopes('streaming playlist-read-private')).toContain('user-read-private')
    // Logins saved before scopes were recorded must log in again.
    expect(missingScopes(undefined)).toEqual([...SPOTIFY_SCOPES])
  })
})
