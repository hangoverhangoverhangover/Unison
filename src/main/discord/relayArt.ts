// Local cover art on Discord through Unison's relay (QoL 4), the way Music Presence does
// it: a small copy of the file's own cover gets a short-lived, unguessable https URL.
// Only one image is up at a time: the previous one is deleted when the song changes or
// the presence stops, and the relay expires anything left after two hours.

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/** Re-upload before the relay's two-hour expiry (a long pause, a long mix). */
export const REUPLOAD_AFTER_MS = 100 * 60 * 1000

export interface RelayArt {
  /** The URL already up for this cover, if any. */
  cached(hash: string): string | undefined
  /** Upload this cover (or reuse it); null when off, without a relay, or on failure. */
  urlFor(hash: string): Promise<string | null>
  /** Take the current image down (presence stopped). */
  release(): Promise<void>
}

export function createRelayArt(deps: {
  fetch: Fetch
  /** Relay base URL (https://…), or null when there is none. */
  baseUrl(): string | null
  enabled(): boolean
  /** The cover shrunk to a small JPEG, or null when the file has none. */
  readCover(hash: string): Promise<Uint8Array | null>
  now?: () => number
  log?: (message: string, err?: unknown) => void
}): RelayArt {
  const now = deps.now ?? Date.now
  let current: { hash: string; id: string; secret: string; url: string; at: number } | null = null
  const pending = new Map<string, Promise<string | null>>()

  const remove = async (art: NonNullable<typeof current>, base: string): Promise<void> => {
    await deps
      .fetch(`${base}/art/${art.id}`, { method: 'DELETE', headers: { 'X-Art-Secret': art.secret } })
      .catch(() => undefined)
  }

  const fresh = (hash: string): boolean =>
    !!current && current.hash === hash && now() - current.at < REUPLOAD_AFTER_MS

  const upload = async (hash: string): Promise<string | null> => {
    const base = deps.baseUrl()?.replace(/\/+$/, '')
    if (!base || !deps.enabled()) return null
    try {
      const bytes = await deps.readCover(hash)
      if (!bytes) return null
      const res = await deps.fetch(`${base}/art`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: bytes as unknown as BodyInit
      })
      if (res.status !== 201) {
        deps.log?.(`[discord] relay art upload refused: HTTP ${res.status}`)
        return null
      }
      const { id, secret } = (await res.json()) as { id: string; secret: string }
      const old = current
      current = { hash, id, secret, url: `${base}/art/${id}`, at: now() }
      if (old) void remove(old, base)
      return current.url
    } catch (err) {
      deps.log?.('[discord] relay art upload failed', err)
      return null
    }
  }

  return {
    cached: (hash) => (fresh(hash) ? current!.url : undefined),
    urlFor(hash) {
      if (fresh(hash)) return Promise.resolve(current!.url)
      let p = pending.get(hash)
      if (!p) {
        p = upload(hash).finally(() => pending.delete(hash))
        pending.set(hash, p)
      }
      return p
    },
    async release() {
      const base = deps.baseUrl()?.replace(/\/+$/, '')
      const old = current
      current = null
      if (old && base) await remove(old, base)
    }
  }
}
