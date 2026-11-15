import { describe, expect, it, vi } from 'vitest'
import type { SoundCloudStatus } from '@shared/soundcloud'
import { DATADOME_MESSAGE, EXPIRED_MESSAGE, NOT_CONNECTED_MESSAGE } from './api'
import { REFRESH_URL, SoundCloudSession, USER_KEY } from './session'
import {
  fakeJar,
  fakeWindow,
  json,
  routedFetch,
  settingsWithClientId,
  silentLog,
  type Call,
  type FakeJar,
  type FakeWindow
} from './testing'

interface Harness {
  session: SoundCloudSession
  fetch: ReturnType<typeof routedFetch>
  settings: ReturnType<typeof settingsWithClientId>
  jar: FakeJar
  statuses: SoundCloudStatus[]
  windows: FakeWindow[]
}

function setup(
  handler: (call: Call, url: URL) => Response | Promise<Response>,
  opts: { token?: string; cachedUser?: boolean } = {}
): Harness {
  const fetch = routedFetch(handler)
  const settings = settingsWithClientId()
  if (opts.cachedUser) settings.set(USER_KEY, JSON.stringify({ id: '9', username: 'cached' }))
  const jar = fakeJar(opts.token)
  const statuses: SoundCloudStatus[] = []
  const windows: FakeWindow[] = []
  const session = new SoundCloudSession({
    fetch,
    settings,
    jar,
    openLoginWindow: () => {
      const w = fakeWindow()
      windows.push(w)
      return w
    },
    onStatus: (s) => statuses.push(s),
    sleep: async () => {},
    pollMs: 5,
    log: silentLog
  })
  return { session, fetch, settings, jar, statuses, windows }
}

const meFor =
  (good: string) =>
  (c: Call, u: URL): Response => {
    if (u.pathname === '/me')
      return c.headers.Authorization === `OAuth ${good}`
        ? json({ id: 9, username: 'me' })
        : new Response('', { status: 401 })
    if (c.url === REFRESH_URL) return new Response('', { status: 401 })
    if (u.pathname === '/search/tracks') return json({ collection: [], next_href: null })
    return json({}, 404)
  }

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('SoundCloudSession', () => {
  it('validates a saved cookie with /me at startup', async () => {
    const { session, statuses, settings } = setup(meFor('tok'), { token: 'tok' })
    await session.start()
    expect(session.status).toEqual({
      state: 'connected',
      username: 'me',
      userId: '9',
      adapter: 'web'
    })
    expect(statuses).toHaveLength(1)
    // Only the profile is cached; the token never lands in settings.
    expect([...settings.data.values()].join()).not.toContain('tok')
  })

  it('is disconnected with no cookie', async () => {
    const { session } = setup(meFor('tok'), { cachedUser: true })
    expect(session.status.state).toBe('connected')
    await session.start()
    expect(session.status).toEqual({ state: 'disconnected' })
    await expect(session.provider.getLikes()).rejects.toThrow(NOT_CONNECTED_MESSAGE)
  })

  it('401 -> refresh via the web proxy -> retry with the new cookie', async () => {
    const h = setup(
      (c, u) => {
        if (c.url === REFRESH_URL) {
          h.jar.token = 'fresh'
          return new Response('{}', { status: 200 })
        }
        return meFor('fresh')(c, u)
      },
      { token: 'stale' }
    )
    await h.session.start()
    expect(h.session.status.state).toBe('connected')
    const refresh = h.fetch.calls.find((c) => c.url === REFRESH_URL)!
    expect(refresh.method).toBe('POST')
    expect(refresh.headers.Authorization).toBeUndefined()
  })

  it('expires and emits soundcloud:status when refresh fails', async () => {
    const { session, statuses } = setup(meFor('never'), { token: 'stale', cachedUser: true })
    await session.start()
    expect(session.status).toEqual({ state: 'expired' })
    expect(statuses.at(-1)).toEqual({ state: 'expired' })
    await expect(session.provider.getLikes()).rejects.toThrow(EXPIRED_MESSAGE)
    // Search still works anonymously.
    await expect(session.provider.search('x', 0)).resolves.toEqual([])
  })

  it('login waits for a new oauth_token, checks /me, then closes the window', async () => {
    const { session, jar, windows, statuses } = setup(meFor('new'))
    await session.start()
    const p = session.login()
    // A second call focuses the same window.
    const p2 = session.login()
    expect(windows).toHaveLength(1)
    expect(windows[0]!.focusCalls).toBe(1)
    await tick()
    jar.setToken('new')
    await expect(p).resolves.toMatchObject({ state: 'connected', username: 'me' })
    await expect(p2).resolves.toMatchObject({ state: 'connected' })
    expect(windows[0]!.closeCalls).toBe(1)
    expect(statuses.at(-1)?.state).toBe('connected')
  })

  it('login picks the token up by polling too', async () => {
    const { session, jar } = setup(meFor('new'))
    await session.start()
    const p = session.login()
    await tick()
    jar.token = 'new' // no change event
    await expect(p).resolves.toMatchObject({ state: 'connected' })
  })

  it('closing the login window resolves with the unchanged status', async () => {
    const { session, windows } = setup(meFor('x'))
    await session.start()
    const p = session.login()
    await tick()
    windows[0]!.userClose()
    await expect(p).resolves.toEqual({ state: 'disconnected' })
    // A new login opens a new window.
    void session.login()
    expect(windows).toHaveLength(2)
  })

  it('logout clears cookies and resets status', async () => {
    const { session, jar, settings } = setup(meFor('tok'), { token: 'tok' })
    await session.start()
    await expect(session.logout()).resolves.toEqual({ state: 'disconnected' })
    expect(jar.cleared).toBe(1)
    expect(settings.data.has(USER_KEY)).toBe(false)
    await expect(session.provider.getLikes()).rejects.toThrow(NOT_CONNECTED_MESSAGE)
  })

  it('surfaces DataDome on the startup check without expiring', async () => {
    const onDd = vi.fn(
      () => new Response('', { status: 403, headers: { 'x-datadome': 'protected' } })
    )
    const { session } = setup(onDd, { token: 'tok', cachedUser: true })
    await session.start()
    expect(session.status.state).toBe('connected')
    expect(onDd).toHaveBeenCalledTimes(1)
    const err = await session.provider.getLikes().catch((e: Error) => e)
    expect((err as Error).message).toBe(DATADOME_MESSAGE)
  })
})

describe('SoundCloudSession.loginWithToken', () => {
  it('accepts a token that works with /me and stores it in the cookie jar', async () => {
    const h = setup(meFor('good-token-123'))
    await h.session.start()
    await expect(h.session.loginWithToken('  OAuth good-token-123 ')).resolves.toEqual({
      state: 'connected',
      username: 'me',
      userId: '9',
      adapter: 'web'
    })
    expect(h.jar.token).toBe('good-token-123')
  })

  it('rejects a malformed or refused token without storing it', async () => {
    const h = setup(meFor('good-token-123'))
    await h.session.start()
    await expect(h.session.loginWithToken('not a token!')).rejects.toThrow(/doesn't look like/)
    await expect(h.session.loginWithToken('wrong-token-456')).rejects.toThrow(/didn't accept/)
    expect(h.jar.token).toBeUndefined()
  })
})
