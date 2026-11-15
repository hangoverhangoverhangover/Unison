// Thin Spotify Web API client: auth header, 401 refresh-once, 429 backoff, typed errors.
import type { FetchFn } from './auth'

export const API_BASE = 'https://api.spotify.com/v1'
/** Longest we'll wait on a single Retry-After. */
export const MAX_RETRY_AFTER_S = 30
/** Retries after a rate-limit 429 (QUOTA_EXCEEDED is never retried). */
export const MAX_429_RETRIES = 2
/** Safety stop for runaway pagination (50 per page -> 50k items). */
const MAX_PAGES = 1000
/** Pages fetched at once after the first one tells us the total. */
export const PAGE_CONCURRENCY = 4

export interface ApiAuth {
  getAccessToken(): Promise<string>
  /** Forced refresh after a 401. */
  refresh(): Promise<string>
}

export class SpotifyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Spotify's own error message, if the body had one. */
    readonly spotifyMessage?: string,
    /** e.g. `QUOTA_EXCEEDED`, `NO_ACTIVE_DEVICE`. */
    readonly reason?: string
  ) {
    super(message)
    this.name = 'SpotifyApiError'
  }
}

export class SpotifyQuotaError extends SpotifyApiError {
  constructor(spotifyMessage?: string) {
    super(
      429,
      "Spotify's API quota for this app is used up (QUOTA_EXCEEDED). Try again later.",
      spotifyMessage,
      'QUOTA_EXCEEDED'
    )
    this.name = 'SpotifyQuotaError'
  }
}

export type Query = Record<string, string | number | boolean | undefined>

export interface RequestOptions {
  query?: Query
  /** JSON-encoded when present. */
  body?: unknown
}

export interface Paging<T> {
  items: (T | null)[]
  next: string | null
  total?: number
}

interface ParsedError {
  message?: string
  reason?: string
}

/**
 * Spotify uses `{ error: { status, message, reason? } }`, but the quota 429 is documented
 * as a flat `{ status, message, reason }`. Accept both.
 */
function parseError(body: unknown): ParsedError {
  if (typeof body !== 'object' || body === null) return {}
  const b = body as Record<string, unknown>
  const inner =
    typeof b.error === 'object' && b.error !== null ? (b.error as Record<string, unknown>) : b
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  return {
    message: str(inner.message) ?? str(b.message) ?? str(b.error_description),
    reason: str(inner.reason) ?? str(b.reason)
  }
}

function parseJson(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Retry-After is documented in seconds; tolerate an HTTP date too. */
export function retryAfterSeconds(header: string | null, nowMs = Date.now()): number {
  if (!header) return 1
  const n = Number(header)
  if (Number.isFinite(n)) return Math.max(0, n)
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, (date - nowMs) / 1000)
  return 1
}

export class SpotifyApi {
  private readonly fetchFn: FetchFn
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly auth: ApiAuth,
    opts: { fetch?: FetchFn; sleep?: (ms: number) => Promise<void> } = {}
  ) {
    this.fetchFn = opts.fetch ?? ((...a: Parameters<FetchFn>) => fetch(...a))
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  /** Path relative to the API base, or an absolute `next` URL from a paging object. */
  url(pathOrUrl: string, query?: Query): string {
    let url: URL
    if (/^https?:\/\//i.test(pathOrUrl)) {
      // Only ever send the bearer token to the API host.
      if (!pathOrUrl.startsWith(API_BASE + '/'))
        throw new Error(`Refusing non-Spotify API URL: ${pathOrUrl}`)
      url = new URL(pathOrUrl)
    } else {
      url = new URL(API_BASE + (pathOrUrl.startsWith('/') ? '' : '/') + pathOrUrl)
    }
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    return url.toString()
  }

  async request<T = unknown>(
    method: string,
    pathOrUrl: string,
    opts: RequestOptions = {}
  ): Promise<T> {
    const url = this.url(pathOrUrl, opts.query)
    const hasBody = opts.body !== undefined
    let token = await this.auth.getAccessToken()
    let refreshed = false
    let rateRetries = 0

    for (;;) {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
      if (hasBody) headers['Content-Type'] = 'application/json'
      const res = await this.fetchFn(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(opts.body) : undefined
      })
      const text = await res.text()
      const json = parseJson(text)

      if (res.status === 401 && !refreshed) {
        refreshed = true
        token = await this.auth.refresh()
        continue
      }
      if (res.status === 429) {
        const err = parseError(json)
        if (err.reason === 'QUOTA_EXCEEDED') throw new SpotifyQuotaError(err.message)
        if (rateRetries < MAX_429_RETRIES) {
          rateRetries++
          const wait = Math.min(
            retryAfterSeconds(res.headers.get('retry-after')),
            MAX_RETRY_AFTER_S
          )
          console.warn(`[spotify] rate limited on ${method} ${pathOrUrl}; waiting ${wait}s`)
          await this.sleep(wait * 1000)
          continue
        }
        throw new SpotifyApiError(
          429,
          'Spotify is rate limiting requests. Try again in a moment.',
          err.message,
          err.reason
        )
      }
      if (!res.ok) {
        const err = parseError(json)
        const detail = err.message ?? (res.statusText || 'request failed')
        throw new SpotifyApiError(
          res.status,
          `Spotify API ${method} ${new URL(url).pathname} failed (${res.status}): ${detail}`,
          err.message,
          err.reason
        )
      }
      return json as T
    }
  }

  get<T = unknown>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, { query })
  }

  /** Follows `next` links until the last page. Null items are kept for the caller to filter. */
  /**
   * Every item of an offset-paged endpoint. The first page gives `total`; the rest are
   * fetched PAGE_CONCURRENCY at a time by offset, in order. Falls back to following
   * `next` links when the response has no usable `total`.
   */
  async getAllPages<T>(path: string, query?: Query): Promise<(T | null)[]> {
    const firstUrl = this.url(path, query)
    const first = await this.get<Paging<T>>(firstUrl)
    if (!first) return []
    const out: (T | null)[] = [...(first.items ?? [])]
    const pageSize = first.items?.length ?? 0
    const total = typeof first.total === 'number' ? first.total : -1
    if (!first.next || pageSize === 0) return out

    if (total < 0) {
      let next: string | null = first.next
      for (let i = 1; next && i < MAX_PAGES; i++) {
        const page: Paging<T> | undefined = await this.get<Paging<T>>(next)
        if (!page) break
        out.push(...(page.items ?? []))
        next = page.next ?? null
      }
      return out
    }

    const base = new URL(first.next)
    const startOffset = Number(base.searchParams.get('offset') ?? pageSize)
    const offsets: number[] = []
    for (let o = startOffset; o < total && offsets.length < MAX_PAGES; o += pageSize)
      offsets.push(o)
    const pages: (T | null)[][] = new Array(offsets.length)
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < offsets.length) {
        const i = cursor++
        const u = new URL(base)
        u.searchParams.set('offset', String(offsets[i]))
        u.searchParams.set('limit', String(pageSize))
        const page = await this.get<Paging<T>>(u.toString())
        pages[i] = page?.items ?? []
      }
    }
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, worker))
    for (const p of pages) out.push(...(p ?? []))
    return out
  }
}
