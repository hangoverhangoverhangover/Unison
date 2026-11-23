import { describe, expect, it, vi } from 'vitest'
import type { DiscographyStatus } from '@shared/discography'
import { DiscographySession, USER_KEY, type DgLoginWindow } from './session'

function settings(): {
  get(k: string): string | undefined
  set(k: string, v: string): void
  delete(k: string): void
  map: Map<string, string>
} {
  const map = new Map<string, string>()
  return {
    map,
    get: (k) => map.get(k),
    set: (k, v) => void map.set(k, v),
    delete: (k) => void map.delete(k)
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test helper
function setup(route: (url: string, init?: RequestInit) => Response) {
  const calls: string[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://discography.stream/api', '')}`)
    return route(url, init)
  })
  const statuses: DiscographyStatus[] = []
  let closeWin!: () => void
  const win: DgLoginWindow & { closedCount: number } = {
    closedCount: 0,
    closed: new Promise<void>((r) => (closeWin = r)),
    close: () => {
      win.closedCount++
      closeWin()
    },
    focus: () => undefined
  }
  const store = settings()
  const clearSite = vi.fn(async () => undefined)
  let now = 1_000_000
  const s = new DiscographySession({
    fetch,
    settings: store,
    openLoginWindow: () => win,
    clearSite,
    onStatus: (st) => statuses.push(st),
    sleep: async () => undefined,
    now: () => now,
    log: { warn: () => undefined }
  })
  return { s, calls, statuses, win, store, clearSite, setNow: (n: number) => (now = n) }
}

describe('DiscographySession', () => {
  it('logs in once /me names a user, then closes the window', async () => {
    let n = 0
    const { s, win, store, statuses } = setup((url) =>
      url.endsWith('/me')
        ? ++n < 3
          ? json({ detail: 'no' }, 401)
          : json({ id: 'u1', username: 'tripp', premium: false })
        : json({}, 404)
    )
    const st = await s.login()
    expect(st).toEqual({ state: 'connected', username: 'tripp', userId: 'u1', premium: false })
    expect(win.closedCount).toBe(1)
    expect(JSON.parse(store.map.get(USER_KEY)!)).toMatchObject({ id: 'u1' })
    expect(statuses.at(-1)?.state).toBe('connected')
  })

  it('searches and maps songs; refuses when not connected', async () => {
    const { s, calls } = setup((url) =>
      url.endsWith('/me')
        ? json({ id: 'u1', username: 'tripp' })
        : json({ tracks: [{ id: 't1', title: 'Song', artists: ['A'], duration: 2 }], artists: [] })
    )
    await expect(s.provider.search('lucki', 0)).rejects.toThrow("isn't connected")
    await s.start()
    const tracks = await s.provider.search('lucki', 1)
    expect(tracks.map((t) => t.id)).toEqual(['discography:t1'])
    expect(calls.at(-1)).toBe('GET /search?q=lucki&limit=30&offset=30')
  })

  it('reuses a signed stream URL until shortly before it expires', async () => {
    let k = 0
    const exp = 1_000_000 / 1000 + 6 * 3600
    const { s, setNow } = setup((url) =>
      url.endsWith('/me')
        ? json({ id: 'u1', username: 'tripp' })
        : json({
            id: 't1',
            title: 'S',
            stream_url: `https://media.discography.stream/audio/t1.mp3?exp=${exp}&sig=${++k}`
          })
    )
    await s.start()
    const a = await s.streamUrl('t1')
    expect(await s.streamUrl('t1')).toBe(a)
    setNow(exp * 1000 - 5 * 60_000)
    expect(await s.streamUrl('t1')).not.toBe(a)
  })

  it('a 401 on a call marks the login expired', async () => {
    const { s } = setup((url) =>
      url.endsWith('/me') ? json({ id: 'u1', username: 'x' }) : json({ detail: 'x' }, 401)
    )
    await s.start()
    await expect(s.provider.search('q', 0)).rejects.toThrow('expired')
    expect(s.status.state).toBe('expired')
  })

  it('logs out: tells the site, clears its data and the cached user', async () => {
    const { s, calls, clearSite, store } = setup((url) =>
      url.endsWith('/me') ? json({ id: 'u1', username: 'x' }) : json({})
    )
    await s.start()
    expect((await s.logout()).state).toBe('disconnected')
    expect(calls).toContain('POST /auth/logout')
    expect(clearSite).toHaveBeenCalled()
    expect(store.map.has(USER_KEY)).toBe(false)
  })
})
