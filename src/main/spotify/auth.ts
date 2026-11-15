// Spotify Authorization Code with PKCE over a loopback redirect.
// Reference: docs/research/spotify-web-api.md section 1.
import { createHash, randomBytes } from 'crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { SPOTIFY_OPTIONAL_SCOPES, SPOTIFY_REDIRECT_PATH, SPOTIFY_SCOPES } from '@shared/spotify'

export const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'
export const TOKEN_URL = 'https://accounts.spotify.com/api/token'
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

/** What a login asks for: the required scopes, then the optional ones. */
export const LOGIN_SCOPES: readonly string[] = [...SPOTIFY_SCOPES, ...SPOTIFY_OPTIONAL_SCOPES]

export type FetchFn = typeof fetch

/** Raw token endpoint response. `refresh_token` is optional on refresh (rotation). */
export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope?: string
  refresh_token?: string
}

/** Error from accounts.spotify.com/api/token, e.g. `400 invalid_grant`. */
export class SpotifyTokenError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    description?: string
  ) {
    super(
      `Spotify token request failed (${status} ${code})${description ? `: ${description}` : ''}`
    )
    this.name = 'SpotifyTokenError'
  }
}

export function isInvalidGrant(err: unknown): boolean {
  return err instanceof SpotifyTokenError && err.status === 400 && err.code === 'invalid_grant'
}

export type LoginCancelReason = 'denied' | 'timeout' | 'aborted'

/** The user denied access, the login timed out, or a newer login / logout replaced it. */
export class LoginCancelledError extends Error {
  constructor(
    readonly reason: LoginCancelReason,
    message: string
  ) {
    super(message)
    this.name = 'LoginCancelledError'
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** S256 code challenge: base64url(SHA-256(verifier)), no padding. */
export function codeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier, 'ascii').digest())
}

/** 64 random bytes -> 86 base64url chars, inside Spotify's 43..128 range. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(64))
  return { verifier, challenge: codeChallenge(verifier) }
}

export function buildAuthorizeUrl(p: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  scopes?: readonly string[]
}): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', p.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', p.redirectUri)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('code_challenge', p.challenge)
  url.searchParams.set('state', p.state)
  url.searchParams.set('scope', (p.scopes ?? LOGIN_SCOPES).join(' '))
  return url.toString()
}

async function postToken(fetchFn: FetchFn, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    // Non-JSON error page; fall through with an empty body.
  }
  if (!res.ok) {
    const code = typeof json.error === 'string' ? json.error : 'http_error'
    const desc = typeof json.error_description === 'string' ? json.error_description : undefined
    throw new SpotifyTokenError(res.status, code, desc)
  }
  if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
    throw new SpotifyTokenError(res.status, 'bad_response', 'token response had no access_token')
  }
  return json as unknown as TokenResponse
}

export function exchangeCode(
  fetchFn: FetchFn,
  p: { clientId: string; code: string; redirectUri: string; verifier: string }
): Promise<TokenResponse> {
  return postToken(fetchFn, {
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: p.clientId,
    code_verifier: p.verifier
  })
}

/** PKCE clients send no Authorization header on refresh. */
export function refreshTokens(
  fetchFn: FetchFn,
  p: { clientId: string; refreshToken: string }
): Promise<TokenResponse> {
  return postToken(fetchFn, {
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
    client_id: p.clientId
  })
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#121212;color:#f2f2f2}
main{max-width:28rem;padding:2rem;text-align:center}
h1{font-size:1.25rem;margin:0 0 .5rem}
p{margin:0;color:#b3b3b3}
</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`
}

const PAGE_OK = page('Logged in to Spotify', 'You can close this tab and return to the app.')
const PAGE_CANCELLED = page(
  'Spotify login cancelled',
  'You can close this tab and return to the app.'
)
const PAGE_FAILED = page(
  'Spotify login failed',
  'Something went wrong. You can close this tab and try again from the app.'
)
const PAGE_BAD_STATE = page(
  'Login link not recognised',
  'This login link is stale or did not come from the app. Start the login again from the app.'
)

export interface LoopbackLoginOptions {
  clientId: string
  /** Opens the authorize URL; main passes `shell.openExternal`. */
  openExternal: (url: string) => Promise<void> | void
  /** Used only for the token exchange. */
  fetch?: FetchFn
  scopes?: readonly string[]
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * Full PKCE login: start a loopback server on 127.0.0.1 with a dynamic port, open the
 * browser, wait for `/callback`, check `state`, exchange the code. The server is always
 * closed. Rejects with LoginCancelledError on denial, timeout or abort.
 */
export function runLoopbackLogin(opts: LoopbackLoginOptions): Promise<TokenResponse> {
  const fetchFn = opts.fetch ?? ((...a: Parameters<FetchFn>) => fetch(...a))
  const { verifier, challenge } = createPkcePair()
  const state = base64url(randomBytes(24))
  const timeoutMs = opts.timeoutMs ?? LOGIN_TIMEOUT_MS

  return new Promise<TokenResponse>((resolve, reject) => {
    let settled = false
    let redirectUri = ''
    let timer: NodeJS.Timeout | undefined

    const server = createServer((req, res) => void onRequest(req, res))

    function finish(err: Error | null, tokens?: TokenResponse): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      server.close()
      // Browsers keep loopback connections alive; drop them so close() completes.
      setImmediate(() => server.closeAllConnections())
      if (err) reject(err)
      else resolve(tokens!)
    }

    function onAbort(): void {
      finish(new LoginCancelledError('aborted', 'Spotify login was cancelled.'))
    }

    function send(res: ServerResponse, status: number, html: string): void {
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'close'
      })
      res.end(html)
    }

    async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method !== 'GET' || url.pathname !== SPOTIFY_REDIRECT_PATH) {
        res.writeHead(404, { Connection: 'close' }).end()
        return
      }
      if (settled) {
        send(res, 410, PAGE_BAD_STATE)
        return
      }
      // A request without our state isn't from Spotify's redirect: ignore it and keep waiting.
      if (url.searchParams.get('state') !== state) {
        send(res, 400, PAGE_BAD_STATE)
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      if (error || !code) {
        send(res, 200, PAGE_CANCELLED)
        finish(
          new LoginCancelledError(
            'denied',
            error === 'access_denied'
              ? 'Spotify access was denied.'
              : `Spotify login failed: ${error ?? 'no authorization code'}.`
          )
        )
        return
      }
      try {
        const tokens = await exchangeCode(fetchFn, {
          clientId: opts.clientId,
          code,
          redirectUri,
          verifier
        })
        send(res, 200, PAGE_OK)
        finish(null, tokens)
      } catch (err) {
        send(res, 500, PAGE_FAILED)
        finish(err instanceof Error ? err : new Error(String(err)))
      }
    }

    if (opts.signal?.aborted) {
      settled = true
      reject(new LoginCancelledError('aborted', 'Spotify login was cancelled.'))
      return
    }
    opts.signal?.addEventListener('abort', onAbort)
    server.on('error', (err) => finish(err))
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      // Registered in the dashboard without a port; Spotify accepts the dynamic loopback port.
      redirectUri = `http://127.0.0.1:${port}${SPOTIFY_REDIRECT_PATH}`
      timer = setTimeout(
        () =>
          finish(new LoginCancelledError('timeout', 'Spotify login timed out after 5 minutes.')),
        timeoutMs
      )
      const authorizeUrl = buildAuthorizeUrl({
        clientId: opts.clientId,
        redirectUri,
        challenge,
        state,
        scopes: opts.scopes
      })
      Promise.resolve()
        .then(() => opts.openExternal(authorizeUrl))
        .catch((err: unknown) =>
          finish(new Error(`Couldn't open the browser for Spotify login: ${String(err)}`))
        )
    })
  })
}
