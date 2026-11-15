import { describe, expect, it, vi } from 'vitest'
import {
  DATADOME_MESSAGE,
  SoundCloudApi,
  SoundCloudApiError,
  SoundCloudDataDomeError,
  SoundCloudLoginExpiredError,
  type ScAuthSource
} from './api'
import { ClientIdStore, findClientId, findScriptUrls, scrapeClientId } from './clientId'
import {
  CID,
  CID2,
  json,
  memorySettings,
  rejection,
  routedFetch,
  settingsWithClientId,
  silentLog,
  type Call
} from './testing'

const HOME = `<html><script crossorigin src="https://a-v2.sndcdn.com/assets/0-aaa.js"></script>
<script>window.__sc_version="1"</script>
<script crossorigin src="https://a-v2.sndcdn.com/assets/49-bbb.js"></script>
<script crossorigin src="https://a-v2.sndcdn.com/assets/55-ccc.js"></script></html>`

function bundle(id?: string): string {
  return id
    ? `x={client_application_id:46941,client_id:"${id}",client_is_expiring:!1,env:"production"}`
    : 'var nothing=1'
}

describe('client_id scraping', () => {
  it('finds bundle URLs and the id', () => {
    expect(findScriptUrls(HOME)).toEqual([
      'https://a-v2.sndcdn.com/assets/0-aaa.js',
      'https://a-v2.sndcdn.com/assets/49-bbb.js',
      'https://a-v2.sndcdn.com/assets/55-ccc.js'
    ])
    expect(findClientId(bundle(CID))).toBe(CID)
    expect(findClientId('client_id : "short"')).toBeUndefined()
  })

  it('scans bundles last to first and stops at the first match', async () => {
    const fetch = routedFetch((_c, u) => {
      if (u.href === 'https://soundcloud.com/') return new Response(HOME)
      if (u.pathname.endsWith('55-ccc.js')) return new Response(bundle())
      if (u.pathname.endsWith('49-bbb.js')) return new Response(bundle(CID2))
      return new Response(bundle(CID))
    })
    await expect(scrapeClientId(fetch)).resolves.toBe(CID2)
    expect(fetch.calls.map((c) => c.url)).toEqual([
      'https://soundcloud.com/',
      'https://a-v2.sndcdn.com/assets/55-ccc.js',
      'https://a-v2.sndcdn.com/assets/49-bbb.js'
    ])
  })

  it('caches the id in settings and reuses it', async () => {
    const settings = memorySettings()
    const fetch = routedFetch((_c, u) =>
      u.hostname === 'soundcloud.com' ? new Response(HOME) : new Response(bundle(CID))
    )
    const store = new ClientIdStore({ fetch, settings })
    await expect(store.get()).resolves.toBe(CID)
    expect(settings.data.get('soundcloud.clientId')).toBe(JSON.stringify(CID))
    const again = new ClientIdStore({ fetch, settings })
    const before = fetch.calls.length
    await expect(again.get()).resolves.toBe(CID)
    expect(fetch.calls.length).toBe(before)
  })
})

interface Harness {
  api: SoundCloudApi
  fetch: ReturnType<typeof routedFetch>
  auth: ScAuthSource & { token: string | null }
  sleep: ReturnType<typeof vi.fn>
  apiCalls: () => Call[]
}

function setup(
  handler: (call: Call, url: URL) => Response | Promise<Response>,
  opts: { token?: string | null; refreshTo?: string | null; scrapeTo?: string } = {}
): Harness {
  const fetch = routedFetch((call, url) => {
    if (url.href === 'https://soundcloud.com/') return new Response(HOME)
    if (url.hostname === 'a-v2.sndcdn.com') return new Response(bundle(opts.scrapeTo ?? CID))
    return handler(call, url)
  })
  const auth: Harness['auth'] = {
    token: opts.token === undefined ? null : opts.token,
    getToken: vi.fn(async () => auth.token),
    refresh: vi.fn(async () => {
      if (opts.refreshTo) auth.token = opts.refreshTo
      return opts.refreshTo ?? null
    }),
    onExpired: vi.fn(() => {
      auth.token = null
    })
  }
  const sleep = vi.fn(async () => {})
  const clientIds = new ClientIdStore({ fetch, settings: settingsWithClientId(), log: silentLog })
  const api = new SoundCloudApi({ fetch, clientIds, auth, sleep, log: silentLog })
  const apiCalls = (): Call[] =>
    fetch.calls.filter((c) => c.url.startsWith('https://api-v2.soundcloud.com/'))
  return { api, fetch, auth, sleep, apiCalls }
}

describe('SoundCloudApi.request', () => {
  it('sends client_id, the web headers and the OAuth header', async () => {
    const { api, apiCalls } = setup(() => json({ ok: 1 }), { token: 'tok' })
    await expect(api.get('me', { a: 'x' }, 'required')).resolves.toEqual({ ok: 1 })
    const call = apiCalls()[0]!
    const url = new URL(call.url)
    expect(url.pathname).toBe('/me')
    expect(url.searchParams.get('client_id')).toBe(CID)
    expect(url.searchParams.get('a')).toBe('x')
    expect(call.headers.Authorization).toBe('OAuth tok')
    expect(call.headers.Origin).toBe('https://soundcloud.com')
    expect(call.headers.Referer).toBe('https://soundcloud.com/')
    expect(call.headers.Accept).toContain('application/json')
  })

  it('sends no Authorization anonymously and refuses other hosts', async () => {
    const { api, apiCalls } = setup(() => json([]))
    await api.get('search/tracks', { q: 'x' }, 'optional')
    expect(apiCalls()[0]!.headers.Authorization).toBeUndefined()
    await expect(api.get('https://evil.example/next', undefined, 'optional')).rejects.toThrow(
      /Refusing/
    )
  })

  it('requires a token for required calls', async () => {
    const { api, fetch } = setup(() => json({}))
    await expect(api.get('me', undefined, 'required')).rejects.toThrow(/isn't connected/)
    expect(fetch.calls).toHaveLength(0)
  })

  it('re-scrapes the client_id once on an anonymous 401 and retries', async () => {
    const { api, apiCalls } = setup(
      (_c, u) => (u.searchParams.get('client_id') === CID2 ? json({ ok: 2 }) : json('', 401)),
      { scrapeTo: CID2 }
    )
    await expect(api.get('search/tracks', { q: 'x' })).resolves.toEqual({ ok: 2 })
    expect(apiCalls().map((c) => new URL(c.url).searchParams.get('client_id'))).toEqual([CID, CID2])
  })

  it('gives up after one re-scrape that finds the same id', async () => {
    const { api, apiCalls } = setup(() => new Response('', { status: 401 }))
    const err = await rejection<SoundCloudApiError>(api.get('search/tracks', { q: 'x' }))
    expect(err.status).toBe(401)
    expect(apiCalls()).toHaveLength(1)
  })

  it('refreshes the token on 401 and retries with the new one', async () => {
    const { api, apiCalls, auth } = setup(
      (c) => (c.headers.Authorization === 'OAuth new' ? json({ id: 1 }) : json('', 401)),
      { token: 'old', refreshTo: 'new' }
    )
    await expect(api.get('me', undefined, 'required')).resolves.toEqual({ id: 1 })
    expect(auth.refresh).toHaveBeenCalledWith('old')
    expect(apiCalls().map((c) => c.headers.Authorization)).toEqual(['OAuth old', 'OAuth new'])
    expect(auth.onExpired).not.toHaveBeenCalled()
  })

  it('marks the login expired when refresh fails', async () => {
    const { api, auth, apiCalls } = setup(() => new Response('', { status: 401 }), {
      token: 'old',
      refreshTo: null
    })
    const err = await rejection(api.get('me', undefined, 'required'))
    expect(err).toBeInstanceOf(SoundCloudLoginExpiredError)
    expect(auth.refresh).toHaveBeenCalledOnce()
    expect(auth.onExpired).toHaveBeenCalledOnce()
    expect(apiCalls()).toHaveLength(1)
  })

  it('falls back to anonymous for optional calls after the login dies', async () => {
    const { api, apiCalls } = setup(
      (c) => (c.headers.Authorization ? new Response('', { status: 401 }) : json({ ok: 1 })),
      { token: 'old' }
    )
    await expect(api.get('search/tracks', { q: 'x' }, 'optional')).resolves.toEqual({ ok: 1 })
    expect(apiCalls().at(-1)!.headers.Authorization).toBeUndefined()
  })

  it('throws the DataDome message on a marked 403 and never retries', async () => {
    const { api, apiCalls, auth } = setup(
      () => new Response('{"url":"https://geo.captcha-delivery.com/captcha/"}', { status: 403 }),
      { token: 't' }
    )
    const err = await rejection(api.get('me', undefined, 'required'))
    expect(err).toBeInstanceOf(SoundCloudDataDomeError)
    expect((err as Error).message).toBe(DATADOME_MESSAGE)
    expect(apiCalls()).toHaveLength(1)
    expect(auth.refresh).not.toHaveBeenCalled()

    const h = setup(() => new Response('', { status: 403, headers: { 'x-datadome': 'protected' } }))
    await expect(h.api.get('tracks', { ids: '1' })).rejects.toBeInstanceOf(SoundCloudDataDomeError)
    expect(h.apiCalls()).toHaveLength(1)
  })

  it('re-scrapes once on a plain 403', async () => {
    const { api, apiCalls } = setup(
      (_c, u) => (u.searchParams.get('client_id') === CID2 ? json({ ok: 1 }) : json('', 403)),
      { scrapeTo: CID2 }
    )
    await expect(api.get('tracks/1')).resolves.toEqual({ ok: 1 })
    expect(apiCalls()).toHaveLength(2)
  })

  it('honours Retry-After on 429, capped at 30 s, at most twice', async () => {
    let n = 0
    const { api, sleep } = setup(() =>
      n++ < 1 ? json('', 429, { 'Retry-After': '120' }) : json({ ok: 1 })
    )
    await expect(api.get('search/tracks')).resolves.toEqual({ ok: 1 })
    expect(sleep).toHaveBeenCalledWith(30_000)

    const h = setup(() => json('', 429, { 'Retry-After': '2' }))
    const err = await rejection<SoundCloudApiError>(h.api.get('search/tracks'))
    expect(err.status).toBe(429)
    expect(h.sleep).toHaveBeenCalledTimes(2)
    expect(h.apiCalls()).toHaveLength(3)
  })

  it('sends the datadome cookie as x-datadome-clientid when known', async () => {
    const h = setup(() => json({}))
    h.auth.getDataDomeClientId = async () => 'dd-cookie'
    await h.api.get('search/tracks')
    expect(h.apiCalls()[0]!.headers['x-datadome-clientid']).toBe('dd-cookie')
  })
})

describe('SoundCloudApi.getAll', () => {
  it('follows next_href verbatim, keeping client_id and auth on each page', async () => {
    const { api, apiCalls } = setup(
      (_c, u) => {
        if (!u.searchParams.has('offset'))
          return json({
            collection: [1, 2],
            next_href:
              'https://api-v2.soundcloud.com/users/9/track_likes?offset=2025-08-19T02%3A01%3A58Z%2Cuser-track-likes%2C1&limit=200'
          })
        return json({ collection: [3], next_href: null })
      },
      { token: 'tok' }
    )
    await expect(api.getAll('users/9/track_likes', { limit: 200 }, 'required')).resolves.toEqual([
      1, 2, 3
    ])
    const calls = apiCalls()
    expect(calls).toHaveLength(2)
    const second = new URL(calls[1]!.url)
    expect(second.searchParams.get('offset')).toBe('2025-08-19T02:01:58Z,user-track-likes,1')
    expect(second.searchParams.get('client_id')).toBe(CID)
    expect(calls[1]!.headers.Authorization).toBe('OAuth tok')
    expect(new URL(calls[0]!.url).searchParams.get('linked_partitioning')).toBe('1')
  })
})
