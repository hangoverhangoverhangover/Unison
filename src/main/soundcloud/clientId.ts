// Web client_id: scraped from soundcloud.com's JS bundles, cached in memory and in
// settings['soundcloud.clientId'] so a restart can reuse it. See the research doc, section 1.
import type { SettingsStore } from '../spotify/tokens'

export type ScFetch = (url: string, init?: RequestInit) => Promise<Response>

export const CLIENT_ID_KEY = 'soundcloud.clientId'
export const HOME_URL = 'https://soundcloud.com/'

const SCRIPT_RE = /<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g
const CLIENT_ID_RE = /client_id\s*:\s*"([0-9a-zA-Z]{32})"/

/** Bundle URLs in page order. */
export function findScriptUrls(html: string): string[] {
  return [...new Set([...html.matchAll(SCRIPT_RE)].map((m) => m[1]!))]
}

export function findClientId(js: string): string | undefined {
  return CLIENT_ID_RE.exec(js)?.[1]
}

const PAGE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: 'https://soundcloud.com/'
}

/** Fetches the home page, then its bundles from last to first, stopping at the first id. */
export async function scrapeClientId(fetchFn: ScFetch): Promise<string> {
  const res = await fetchFn(HOME_URL, { headers: PAGE_HEADERS })
  if (!res.ok) throw new Error(`Couldn't load soundcloud.com (${res.status}).`)
  const scripts = findScriptUrls(await res.text())
  for (const src of scripts.reverse()) {
    const js = await fetchFn(src, { headers: { Accept: '*/*', Referer: HOME_URL } })
    if (!js.ok) continue
    const id = findClientId(await js.text())
    if (id) return id
  }
  throw new Error("Couldn't find SoundCloud's web client id. SoundCloud may have changed its site.")
}

export class ClientIdStore {
  private id: string | undefined
  private scraping: Promise<string> | null = null

  constructor(
    private readonly opts: {
      fetch: ScFetch
      settings: SettingsStore
      log?: Pick<Console, 'warn'>
    }
  ) {
    this.id = this.load()
  }

  /** Cached id, or a scrape when there is none. */
  async get(): Promise<string> {
    return this.id ?? this.scrape()
  }

  /**
   * Called after a 401/403 made with `stale`. Re-scrapes unless another request already
   * did. True when the id is now different, so the caller should retry.
   */
  async refresh(stale: string): Promise<boolean> {
    if (this.id && this.id !== stale) return true
    try {
      return (await this.scrape()) !== stale
    } catch (err) {
      ;(this.opts.log ?? console).warn('[soundcloud] client_id re-scrape failed:', err)
      return false
    }
  }

  private scrape(): Promise<string> {
    if (this.scraping) return this.scraping
    this.scraping = scrapeClientId(this.opts.fetch)
      .then((id) => {
        this.id = id
        this.opts.settings.set(CLIENT_ID_KEY, JSON.stringify(id))
        return id
      })
      .finally(() => {
        this.scraping = null
      })
    return this.scraping
  }

  private load(): string | undefined {
    const raw = this.opts.settings.get(CLIENT_ID_KEY)
    if (!raw) return undefined
    try {
      const v: unknown = JSON.parse(raw)
      return typeof v === 'string' && /^[0-9a-zA-Z]{32}$/.test(v) ? v : undefined
    } catch {
      return undefined
    }
  }
}
