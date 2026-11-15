import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import { SPOTIFY_OPTIONAL_SCOPES, SPOTIFY_SCOPES } from '@shared/spotify'
import {
  buildAuthorizeUrl,
  codeChallenge,
  createPkcePair,
  isInvalidGrant,
  LoginCancelledError,
  refreshTokens,
  runLoopbackLogin,
  TOKEN_URL,
  type TokenResponse
} from './auth'
import { json, scriptedFetch, type ScriptedFetch } from './testing'

const TOKENS = { access_token: 'at', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt' }

describe('PKCE', () => {
  it('challenge is base64url(SHA-256(verifier)) without padding', () => {
    const { verifier, challenge } = createPkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    const expected = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(challenge).toBe(expected)
    expect(challenge).not.toMatch(/[+/=]/)
  })

  it('matches the RFC 7636 appendix B example', () => {
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  it('builds the authorize URL', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:5000/callback',
        challenge: 'ch',
        state: 'st',
        scopes: ['a', 'b']
      })
    )
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:5000/callback',
      code_challenge_method: 'S256',
      code_challenge: 'ch',
      state: 'st',
      scope: 'a b'
    })
  })

  it('asks for the required and the optional scopes by default', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:5000/callback',
        challenge: 'ch',
        state: 'st'
      })
    )
    const scopes = url.searchParams.get('scope')!.split(' ')
    expect(scopes).toEqual([...SPOTIFY_SCOPES, ...SPOTIFY_OPTIONAL_SCOPES])
    expect(scopes).toContain('user-follow-read')
  })
})

describe('token endpoint', () => {
  it('flags 400 invalid_grant', async () => {
    const f = scriptedFetch(() => json({ error: 'invalid_grant' }, 400))
    const err = await refreshTokens(f, { clientId: 'c', refreshToken: 'r' }).catch((e) => e)
    expect(isInvalidGrant(err)).toBe(true)
    expect(f.calls[0]!.url).toBe(TOKEN_URL)
    expect(new URLSearchParams(f.calls[0]!.body)).toEqual(
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'r', client_id: 'c' })
    )
    expect(f.calls[0]!.headers).not.toHaveProperty('Authorization')
  })
})

describe('loopback login', () => {
  // These talk to a server on 127.0.0.1 only; the token exchange uses a scripted fetch.
  function login(
    onUrl: (authorizeUrl: URL) => Promise<void> | void,
    timeoutMs?: number
  ): { promise: Promise<TokenResponse>; tokenFetch: ScriptedFetch } {
    const tokenFetch = scriptedFetch(() => json(TOKENS))
    const promise = runLoopbackLogin({
      clientId: 'cid',
      fetch: tokenFetch,
      timeoutMs,
      openExternal: (u) => {
        void onUrl(new URL(u))
      }
    })
    return { promise, tokenFetch }
  }

  it('exchanges the code after a valid callback and closes the server', async () => {
    let redirect = ''
    let page = ''
    const { promise, tokenFetch } = login(async (u) => {
      redirect = u.searchParams.get('redirect_uri')!
      // A request with the wrong state is rejected and the login keeps waiting.
      const bad = await fetch(`${redirect}?code=x&state=wrong`)
      expect(bad.status).toBe(400)
      const ok = await fetch(`${redirect}?code=thecode&state=${u.searchParams.get('state')}`)
      page = await ok.text()
    })
    await expect(promise).resolves.toMatchObject({ access_token: 'at', refresh_token: 'rt' })
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    const body = new URLSearchParams(tokenFetch.calls[0]!.body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('thecode')
    expect(body.get('redirect_uri')).toBe(redirect)
    expect(codeChallenge(body.get('code_verifier')!)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 20))
    expect(page).toContain('You can close this tab')
    expect(page).not.toMatch(/<(script|link)|src=/)
    await expect(fetch(redirect)).rejects.toThrow()
  })

  it('rejects on access_denied', async () => {
    const { promise } = login(async (u) => {
      await fetch(
        `${u.searchParams.get('redirect_uri')}?error=access_denied&state=${u.searchParams.get('state')}`
      )
    })
    const err = await promise.catch((e) => e)
    expect(err).toBeInstanceOf(LoginCancelledError)
    expect(err.reason).toBe('denied')
  })

  it('times out', async () => {
    const { promise } = login(() => {}, 30)
    const err = await promise.catch((e) => e)
    expect(err).toBeInstanceOf(LoginCancelledError)
    expect(err.reason).toBe('timeout')
  })
})
