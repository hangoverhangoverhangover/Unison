// Thin api-v2 client: client_id on every call, OAuth header, 401 token refresh and
// client_id re-scrape, DataDome detection, 429 backoff. All traffic goes through the
// injected fetch, which in the app is the SoundCloud partition's Chromium `Session.fetch`
// (DataDome rejects non-browser TLS fingerprints; research doc section 2).
import { notConnectedMessage } from '../music/router'
import { retryAfterSeconds } from '../spotify/api'
import type { ClientIdStore, ScFetch } from './clientId'

export const API_BASE = 'https://api-v2.soundcloud.com'
export const MAX_RETRY_AFTER_S = 30
export const MAX_429_RETRIES = 2

export const NOT_CONNECTED_MESSAGE = notConnectedMessage('soundcloud')
export const EXPIRED_MESSAGE = 'Your SoundCloud login has expired. Log in again in Settings.'
export const DATADOME_MESSAGE =
  "SoundCloud wants to check you're human. Open Settings and log in to SoundCloud again to complete the check."

/** Headers the soundcloud.com web client sends to api-v2. */
export const WEB_HEADERS: Readonly<Record<string, string>> = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  Origin: 'https://soundcloud.com',
  Referer: 'https://soundcloud.com/'
}

export class SoundCloudApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'SoundCloudApiError'
  }
}

export class SoundCloudDataDomeError extends SoundCloudApiError {
  constructor() {
    super(403, DATADOME_MESSAGE)
    this.name = 'SoundCloudDataDomeError'
  }
}

export class SoundCloudNotConnectedError extends Error {
  constructor(message = NOT_CONNECTED_MESSAGE) {
    super(message)
    this.name = 'SoundCloudNotConnectedError'
  }
}

export class SoundCloudLoginExpiredError extends SoundCloudNotConnectedError {
  constructor() {
    super(EXPIRED_MESSAGE)
    this.name = 'SoundCloudLoginExpiredError'
  }
}

/** Where the OAuth token comes from (the partition's `oauth_token` cookie, held in memory). */
export interface ScAuthSource {
  /** Current token, or null when not logged in. */
  getToken(): Promise<string | null>
  /** After a 401 made with `stale`: a different, working-looking token, or null. */
  refresh(stale: string): Promise<string | null>
  /** Refresh failed: the login is dead. */
  onExpired(): void
  /** Value for `x-datadome-clientid` (the `datadome` cookie), when known. */
  getDataDomeClientId?(): Promise<string | undefined>
}

/**
 * - `required`: must be logged in; a dead login throws SoundCloudLoginExpiredError.
 * - `optional`: sends the token when there is one; a dead login falls back to anonymous.
 * - `none`: never sends the token.
 */
export type AuthMode = 'required' | 'optional' | 'none'

export type Query = Record<string, string | number | boolean | undefined>

export interface RequestOptions {
  query?: Query
  body?: unknown
  auth?: AuthMode
}

export interface ScPage<T> {
  collection?: (T | null)[]
  next_href?: string | null
}

/** Safety stop for runaway pagination. */
export const MAX_PAGES = 500

function parseJson(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function isDataDomeBlock(res: Response, body: string): boolean {
  if (res.status !== 403) return false
  return !!res.headers.get('x-datadome') || body.includes('captcha-delivery.com')
}

export class SoundCloudApi {
  private readonly sleep: (ms: number) => Promise<void>
  private readonly log: Pick<Console, 'warn'>

  constructor(
    private readonly opts: {
      fetch: ScFetch
      clientIds: ClientIdStore
      auth: ScAuthSource
      sleep?: (ms: number) => Promise<void>
      log?: Pick<Console, 'warn'>
    }
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.log = opts.log ?? console
  }

  /** Path relative to api-v2, or an absolute api-v2 URL (next_href, transcoding url). */
  url(pathOrUrl: string, query?: Query): URL {
    let url: URL
    if (/^https?:\/\//i.test(pathOrUrl)) {
      url = new URL(pathOrUrl)
      // Only ever send the OAuth token to api-v2.
      if (url.origin !== API_BASE) throw new Error(`Refusing non-api-v2 URL: ${url.origin}`)
    } else {
      url = new URL(API_BASE + (pathOrUrl.startsWith('/') ? '' : '/') + pathOrUrl)
    }
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    return url
  }

  async request<T = unknown>(
    method: string,
    pathOrUrl: string,
    opts: RequestOptions = {}
  ): Promise<T> {
    const url = this.url(pathOrUrl, opts.query)
    const mode = opts.auth ?? 'optional'
    const hasBody = opts.body !== undefined
    const { auth, clientIds } = this.opts

    let token = mode === 'none' ? null : await auth.getToken()
    if (mode === 'required' && !token) throw new SoundCloudNotConnectedError()
    let clientId = await clientIds.get()
    let triedTokenRefresh = false
    let triedRescrape = false
    let rateRetries = 0

    for (;;) {
      url.searchParams.set('client_id', clientId)
      const headers: Record<string, string> = { ...WEB_HEADERS }
      if (token) headers.Authorization = `OAuth ${token}`
      if (hasBody) headers['Content-Type'] = 'application/json'
      const dd = await auth.getDataDomeClientId?.()
      if (dd) headers['x-datadome-clientid'] = dd

      const res = await this.opts.fetch(url.toString(), {
        method,
        headers,
        body: hasBody ? JSON.stringify(opts.body) : undefined
      })
      const text = await res.text()

      if (isDataDomeBlock(res, text)) {
        this.log.warn(`[soundcloud] DataDome blocked ${method} ${url.pathname}`)
        throw new SoundCloudDataDomeError()
      }

      if (res.status === 401) {
        if (token && !triedTokenRefresh) {
          triedTokenRefresh = true
          const fresh = await auth.refresh(token)
          if (fresh) {
            token = fresh
            continue
          }
        }
        if (!triedRescrape) {
          triedRescrape = true
          if (await clientIds.refresh(clientId)) {
            clientId = await clientIds.get()
            continue
          }
        }
        if (token) {
          auth.onExpired()
          if (mode === 'required') throw new SoundCloudLoginExpiredError()
          // Public call made with a dead token: try once more without it.
          token = null
          continue
        }
        if (mode === 'required') throw new SoundCloudNotConnectedError()
        throw new SoundCloudApiError(401, `SoundCloud refused ${method} ${url.pathname} (401).`)
      }

      if (res.status === 403 && !triedRescrape) {
        // A 403 without DataDome markers can also mean a rotated client_id (yt-dlp does this).
        triedRescrape = true
        if (await clientIds.refresh(clientId)) {
          clientId = await clientIds.get()
          continue
        }
      }

      if (res.status === 429) {
        if (rateRetries < MAX_429_RETRIES) {
          rateRetries++
          const wait = Math.min(
            retryAfterSeconds(res.headers.get('retry-after')),
            MAX_RETRY_AFTER_S
          )
          this.log.warn(`[soundcloud] rate limited on ${method} ${url.pathname}; waiting ${wait}s`)
          await this.sleep(wait * 1000)
          continue
        }
        throw new SoundCloudApiError(
          429,
          'SoundCloud is rate limiting requests. Try again in a few minutes.'
        )
      }

      if (!res.ok) {
        // Keep SoundCloud's own reason (short, no tokens) for the log and error.
        const reason = text.replace(/\s+/g, ' ').trim().slice(0, 200)
        throw new SoundCloudApiError(
          res.status,
          `SoundCloud ${method} ${url.pathname} failed (${res.status})${reason ? `: ${reason}` : '.'}`
        )
      }
      return parseJson(text) as T
    }
  }

  get<T = unknown>(pathOrUrl: string, query?: Query, auth?: AuthMode): Promise<T> {
    return this.request<T>('GET', pathOrUrl, { query, auth })
  }

  /** Every item of a `linked_partitioning` collection, following `next_href` until null. */
  async getAll<T>(
    path: string,
    query: Query,
    auth: AuthMode,
    maxPages = MAX_PAGES
  ): Promise<(T | null)[]> {
    const out: (T | null)[] = []
    let next: string | null | undefined = this.url(path, {
      linked_partitioning: 1,
      ...query
    }).toString()
    for (let i = 0; next && i < maxPages; i++) {
      const page: ScPage<T> | undefined = await this.get<ScPage<T>>(next, undefined, auth)
      out.push(...(Array.isArray(page?.collection) ? page.collection : []))
      next = page?.next_href ?? null
    }
    return out
  }
}
