// The `signature` query parameter soundcloud.com adds to `POST me/followings/:id`
// (myFollowingsCreate). Read from the web client's bundle on 2026-11-12: the followings
// model has `getCreateEndpointQueryParams(id) -> { signature: sign(currentUserId, id,
// client_id, __FOLLOWS_SIGNATURE_SECRET__) }`, and `sign` is a small obfuscated module
// (de-obfuscated below). Unfollow (DELETE) sends no signature. Likes and reposts aren't signed.
import type { ScFetch } from './clientId'
import { findScriptUrls, HOME_URL } from './clientId'

/** `__FOLLOWS_SIGNATURE_VERSION__` in the bundle. */
export const FOLLOW_SIGNATURE_VERSION = '1'

/** `__FOLLOWS_SIGNATURE_SECRET__` as shipped on 2026-11-12; used when a scrape fails. */
export const FOLLOW_SECRET_FALLBACK = '5Dpr3ubBw8LFtbvQcd4Hx6hU'

const SECRET_RE = /__FOLLOWS_SIGNATURE_SECRET__\s*=\s*"([^"]{8,128})"/

export function findFollowSecret(js: string): string | undefined {
  return SECRET_RE.exec(js)?.[1]
}

/** UTF-8 bytes as a binary string, like `unescape(encodeURIComponent(s))`. */
function utf8Binary(s: string): string {
  let out = ''
  for (const b of new TextEncoder().encode(s)) out += String.fromCharCode(b)
  return out
}

/**
 * The web client's `sign(currentUserId, targetUserId, clientId, secret)`. It mixes in
 * one token of the browser's user agent (split on spaces and slashes), so the server
 * presumably checks it against the request's User-Agent: pass the UA the request goes
 * out with.
 */
export function signFollow(
  currentUserId: string,
  targetUserId: string,
  clientId: string,
  secret: string,
  userAgent: string
): string {
  const parts = userAgent.split(/[ /]/)
  const uaToken = parts[parts[0]!.length % parts.length] ?? ''
  const input = utf8Binary(
    FOLLOW_SIGNATURE_VERSION + secret + clientId + secret + targetUserId + currentUserId + uaToken
  )
  let u = 7996111
  for (let i = 0; i < input.length; i++) {
    u = (u >> 1) + ((1 & u) << 23)
    u += input.charCodeAt(i)
    u &= 0xffffff
  }
  return `${FOLLOW_SIGNATURE_VERSION}:${u.toString(16)}`
}

/** Scrapes the secret from soundcloud.com's bundles once; falls back to the known value. */
export class FollowSecretStore {
  private secret: string | undefined
  private scraping: Promise<string> | null = null

  constructor(private readonly opts: { fetch: ScFetch; log?: Pick<Console, 'warn'> }) {}

  /** Cached secret, or a scrape (the fallback when the scrape finds nothing). */
  get(): Promise<string> {
    return this.secret ? Promise.resolve(this.secret) : this.scrape()
  }

  /** After a rejected follow: scrape again. True when the secret changed. */
  async refresh(stale: string): Promise<boolean> {
    if (this.secret && this.secret !== stale) return true
    this.secret = undefined
    return (await this.scrape()) !== stale
  }

  private scrape(): Promise<string> {
    this.scraping ??= scrapeFollowSecret(this.opts.fetch)
      .catch((err: unknown) => {
        ;(this.opts.log ?? console).warn(
          '[soundcloud] follow secret scrape failed; using the built-in one:',
          err instanceof Error ? err.message : err
        )
        return FOLLOW_SECRET_FALLBACK
      })
      .then((s) => {
        this.secret = s
        return s
      })
      .finally(() => {
        this.scraping = null
      })
    return this.scraping
  }
}

/** Home page, then every bundle (last first) until one holds the secret. */
export async function scrapeFollowSecret(fetchFn: ScFetch): Promise<string> {
  const res = await fetchFn(HOME_URL, {
    headers: { Accept: 'text/html,*/*;q=0.8', Referer: HOME_URL }
  })
  if (!res.ok) throw new Error(`Couldn't load soundcloud.com (${res.status}).`)
  const scripts = findScriptUrls(await res.text())
  for (const src of scripts.reverse()) {
    const js = await fetchFn(src, { headers: { Accept: '*/*', Referer: HOME_URL } })
    if (!js.ok) continue
    const secret = findFollowSecret(await js.text())
    if (secret) return secret
  }
  throw new Error('No follow signature secret in the bundles.')
}
