// discography.stream web API, as its own site uses it (a FastAPI app under /api). Calls go
// through the login partition's Session.fetch, so they carry the HttpOnly session cookie.
// Keep the request rate low: the site starts refusing connections after a burst.
import { DISCOGRAPHY_ORIGIN } from '@shared/discography'

export type DgFetch = (url: string, init?: RequestInit) => Promise<Response>

export const API = `${DISCOGRAPHY_ORIGIN}/api`

export class DiscographyNotConnectedError extends Error {
  constructor() {
    super("Discography isn't connected. Connect it in Settings.")
    this.name = 'DiscographyNotConnectedError'
  }
}

export class DiscographyExpiredError extends Error {
  constructor() {
    super('Your Discography login expired. Log in again in Settings.')
    this.name = 'DiscographyExpiredError'
  }
}

export interface DgMe {
  id: string
  username?: string
  email?: string
  plan?: string
  premium?: boolean
}

export interface DgTrack {
  id: string
  title: string
  slug?: string
  artists?: string[]
  album?: string | null
  album_id?: string | null
  duration?: number
  mime?: string
  size?: number
  available?: boolean
  artwork_url?: string | null
  media_artwork_url?: string | null
  stream_url?: string | null
}

export interface DgArtistRef {
  id: string
  name: string
  slug: string
  artwork_url?: string | null
}

export interface DgSearch {
  tracks: DgTrack[]
  artists: DgArtistRef[]
  next_offset?: number | null
}

/** The site rejects search limits under 10. */
export const SEARCH_LIMIT = 30

export class DiscographyApi {
  constructor(
    private readonly opts: {
      fetch: DgFetch
      /** Called on 401/403: the session cookie is gone or expired. */
      onUnauthorized?: () => void
    }
  ) {}

  private async get<T>(path: string): Promise<T> {
    let res: Response
    try {
      res = await this.opts.fetch(`${API}${path}`, { headers: { Accept: 'application/json' } })
    } catch (err) {
      throw new Error(
        `Couldn't reach Discography (${err instanceof Error ? err.message : String(err)}).`,
        { cause: err }
      )
    }
    if (res.status === 401 || res.status === 403) {
      this.opts.onUnauthorized?.()
      throw new DiscographyExpiredError()
    }
    if (res.status === 404) throw new Error('Not found on Discography.')
    if (res.status === 429) throw new Error('Discography is busy. Try again in a minute.')
    if (!res.ok) throw new Error(`Discography answered ${res.status}.`)
    return (await res.json()) as T
  }

  /** Who is logged in, or null when nobody is (no 401 side effects). */
  async me(): Promise<DgMe | null> {
    const res = await this.opts.fetch(`${API}/me`, { headers: { Accept: 'application/json' } })
    if (res.status === 401 || res.status === 403) return null
    if (!res.ok) throw new Error(`Discography answered ${res.status}.`)
    const body = (await res.json()) as Partial<DgMe> | null
    return body && typeof body.id === 'string' ? (body as DgMe) : null
  }

  search(query: string, offset: number): Promise<DgSearch> {
    const q = new URLSearchParams({
      q: query,
      limit: String(SEARCH_LIMIT),
      offset: String(Math.max(0, Math.floor(offset)))
    })
    return this.get<DgSearch>(`/search?${q}`)
  }

  /** The track with a fresh signed `stream_url` (valid about 6 hours). */
  playback(id: string): Promise<DgTrack> {
    return this.get<DgTrack>(`/tracks/${encodeURIComponent(id)}/playback`)
  }

  async logout(): Promise<void> {
    await this.opts.fetch(`${API}/auth/logout`, { method: 'POST' }).catch(() => undefined)
  }
}
