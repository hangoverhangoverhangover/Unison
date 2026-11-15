import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { SoundCloudApi, SoundCloudLoginExpiredError, SoundCloudNotConnectedError } from './api'
import { ClientIdStore } from './clientId'
import { FollowSecretStore, signFollow } from './followSignature'
import type { ScStreamItem, ScTrack } from './mapping'
import { mapFeedItem } from './mapping'
import { PLAYLIST_MAX_TRACKS, SoundCloudWebProvider } from './provider'
import { FOLLOWINGS_MAX, SOCIAL_IDS_TTL_MS, SoundCloudSocial, validateCursor } from './social'
import {
  CID,
  json,
  rejection,
  routedFetch,
  settingsWithClientId,
  silentLog,
  type Call
} from './testing'

const ME = { id: '9', username: 'me' }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Electron/45.0.0'
const SECRET = 'scrapedSecret123'

function track(id: number): ScTrack {
  return {
    id,
    kind: 'track',
    title: `T${id}`,
    duration: 1000,
    user: { id: 1, username: 'artist' },
    media: { transcodings: [] }
  }
}

const poster = { id: 50, username: 'poster', avatar_url: 'https://i1.sndcdn.com/a-large.jpg' }

function item(type: string, over: Partial<ScStreamItem> = {}): ScStreamItem {
  const base: ScStreamItem = { type, created_at: '2026-11-01T10:00:00Z', user: poster }
  if (type.startsWith('track')) base.track = track(7)
  else
    base.playlist = {
      id: 70,
      kind: 'playlist',
      title: 'Set',
      track_count: 3,
      user: { id: 1, username: 'artist' }
    }
  return { ...base, ...over }
}

interface Harness {
  social: SoundCloudSocial
  provider: SoundCloudWebProvider
  fetch: ReturnType<typeof routedFetch>
  apiCalls: () => Call[]
  advance: (ms: number) => number
}

interface Options {
  loggedIn?: boolean
  expired?: boolean
  userAgent?: string
  /** Bundle bodies served for the follow secret s: Harness crape (null = no home page). */
  bundle?: string | null | (() => string)
}

function setup(
  handler: (call: Call, url: URL) => Response | Promise<Response>,
  opts: Options = {}
): Harness {
  const loggedIn = opts.loggedIn ?? true
  let now = 1_000_000
  const fetch = routedFetch((call, url) => {
    if (url.origin === 'https://soundcloud.com') {
      if (opts.bundle === null) return new Response('', { status: 503 })
      return new Response('<script src="https://a-v2.sndcdn.com/assets/1-abc.js"></script>')
    }
    if (url.origin === 'https://a-v2.sndcdn.com')
      return new Response(
        typeof opts.bundle === 'function'
          ? opts.bundle()
          : (opts.bundle ?? `x.__FOLLOWS_SIGNATURE_SECRET__="${SECRET}"`)
      )
    return handler(call, url)
  })
  const clientIds = new ClientIdStore({ fetch, settings: settingsWithClientId(), log: silentLog })
  const api = new SoundCloudApi({
    fetch,
    clientIds,
    auth: {
      getToken: async () => (loggedIn ? 'tok' : null),
      refresh: async () => null,
      onExpired: () => undefined
    },
    sleep: async () => {},
    log: silentLog
  })
  const requireUser = async (): Promise<typeof ME> => {
    if (opts.expired) throw new SoundCloudLoginExpiredError()
    if (!loggedIn) throw new SoundCloudNotConnectedError()
    return ME
  }
  const social = new SoundCloudSocial({
    api,
    clientIds,
    secrets: new FollowSecretStore({ fetch, log: silentLog }),
    requireUser,
    getUserAgent: () => opts.userAgent ?? UA,
    now: () => now
  })
  const provider = new SoundCloudWebProvider({ api, fetch, requireUser, now: () => now })
  const apiCalls = (): Call[] => fetch.calls.filter((c) => c.url.startsWith('https://api-v2.'))
  return { social, provider, fetch, apiCalls, advance: (ms: number) => (now += ms) }
}

const path = (c: Call): string => new URL(c.url).pathname

describe('mapFeedItem', () => {
  it('maps each stream entry type', () => {
    const t = mapFeedItem(item('track'))!
    expect(t).toMatchObject({
      kind: 'track',
      type: 'post',
      createdAt: '2026-11-01T10:00:00.000Z',
      by: {
        id: 'soundcloud:50',
        name: 'poster',
        avatarUrl: 'https://i1.sndcdn.com/a-t500x500.jpg'
      },
      track: { id: 'soundcloud:7', title: 'T7' }
    })
    expect(t.set).toBeUndefined()
    expect(mapFeedItem(item('track-repost'))).toMatchObject({ kind: 'track', type: 'repost' })
    const p = mapFeedItem(item('playlist'))!
    expect(p).toMatchObject({ kind: 'playlist', type: 'post', set: { id: 'soundcloud:70' } })
    expect(p.track).toBeUndefined()
    expect(mapFeedItem(item('playlist-repost'))).toMatchObject({ kind: 'playlist', type: 'repost' })
  })

  it('gives a post and a repost of the same track different ids', () => {
    const a = mapFeedItem(item('track'))!
    const b = mapFeedItem(item('track-repost'))!
    const c = mapFeedItem(item('track-repost', { created_at: '2026-11-02T00:00:00Z' }))!
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
  })

  it('drops unknown types, undated entries and entries without their object', () => {
    expect(mapFeedItem(item('promoted-track'))).toBeNull()
    expect(mapFeedItem(item('track', { created_at: null }))).toBeNull()
    expect(mapFeedItem(item('track', { track: null }))).toBeNull()
    expect(mapFeedItem(item('playlist', { playlist: null }))).toBeNull()
    expect(mapFeedItem(null)).toBeNull()
  })

  it('falls back to the object owner when the entry has no user', () => {
    expect(mapFeedItem(item('track', { user: null }))!.by).toEqual({
      id: 'soundcloud:1',
      name: 'artist'
    })
  })
})

describe('feed', () => {
  const NEXT = 'https://api-v2.soundcloud.com/stream?offset=abc%2C1&limit=50'

  it('maps a page and returns next_href as the cursor', async () => {
    const h = setup(() =>
      json({
        collection: [item('track'), item('playlist-repost'), { type: 'ad' }],
        next_href: NEXT
      })
    )
    const page = await h.social.getFeed()
    expect(page.items.map((i) => `${i.kind}/${i.type}`)).toEqual(['track/post', 'playlist/repost'])
    expect(page.next).toBe(NEXT)
    const call = h.apiCalls()[0]!
    expect(path(call)).toBe('/stream')
    expect(new URL(call.url).searchParams.get('limit')).toBe('50')
    expect(call.headers.Authorization).toBe('OAuth tok')
  })

  it('follows a cursor it returned', async () => {
    const h = setup(() => json({ collection: [item('track')], next_href: null }))
    const page = await h.social.getFeed(NEXT)
    expect(page.next).toBeUndefined()
    const url = new URL(h.apiCalls()[0]!.url)
    expect(url.searchParams.get('offset')).toBe('abc,1')
    expect(url.searchParams.get('client_id')).toBe(CID)
  })

  it('rejects cursors for another host or path', async () => {
    const h = setup(() => json({ collection: [] }))
    for (const bad of [
      'https://evil.example/stream?offset=1',
      'https://api-v2.soundcloud.com/me/track_likes?offset=1',
      'https://api-v2.soundcloud.com/stream/users/1/reposts',
      'not a url'
    ])
      await expect(h.social.getFeed(bad)).rejects.toThrow(/Invalid SoundCloud page cursor/)
    expect(h.apiCalls()).toHaveLength(0)
  })

  it('strips client_id from cursors both ways', () => {
    const c = validateCursor(
      'https://api-v2.soundcloud.com/stream?offset=1&client_id=x&oauth_token=y',
      'stream'
    )
    expect(c).toBe('https://api-v2.soundcloud.com/stream?offset=1')
  })

  it('ignores a next_href on an empty page', async () => {
    const h = setup(() => json({ collection: [], next_href: NEXT }))
    expect(await h.social.getFeed()).toEqual({ items: [] })
  })

  it('logged out: a readable error and no request', async () => {
    const h = setup(() => json({}), { loggedIn: false })
    const err = await rejection(h.social.getFeed())
    expect(err).toBeInstanceOf(SoundCloudNotConnectedError)
    expect(err.message).toBe('Log in to SoundCloud in Settings to see your feed.')
    expect(h.apiCalls()).toHaveLength(0)
  })

  it('an expired login keeps its own message', async () => {
    const h = setup(() => json({}), { expired: true })
    expect((await rejection(h.social.getFeed())).message).toMatch(/expired/)
  })
})

describe('profile reposts', () => {
  it('maps every entry as a repost by that profile, logged out', async () => {
    const reposter = { id: 183, username: 'eric' }
    const next = 'https://api-v2.soundcloud.com/stream/users/183/reposts?offset=x&limit=50'
    const h = setup(
      () =>
        json({
          collection: [
            item('track-repost', { user: reposter }),
            item('playlist-repost', { user: reposter })
          ],
          next_href: next
        }),
      { loggedIn: false }
    )
    const page = await h.social.getReposts('soundcloud:183')
    expect(page.items.map((i) => [i.kind, i.type, i.by.id])).toEqual([
      ['track', 'repost', 'soundcloud:183'],
      ['playlist', 'repost', 'soundcloud:183']
    ])
    expect(page.next).toBe(next)
    const call = h.apiCalls()[0]!
    expect(path(call)).toBe('/stream/users/183/reposts')
    expect(call.headers.Authorization).toBeUndefined()

    await h.social.getReposts('183', page.next)
    expect(new URL(h.apiCalls()[1]!.url).searchParams.get('offset')).toBe('x')
    // A cursor for another profile is refused.
    await expect(h.social.getReposts('184', page.next)).rejects.toThrow(/cursor/)
  })

  it('rejects malformed user ids', async () => {
    const h = setup(() => json({}))
    await expect(h.social.getReposts('../me')).rejects.toThrow(/Invalid SoundCloud user id/)
  })
})

describe('followings', () => {
  it('pages users/{me}/followings and maps users', async () => {
    const h = setup((_c, url) => {
      if (url.searchParams.get('offset') === '2')
        return json({ collection: [{ id: 3, username: 'c' }], next_href: null })
      return json({
        collection: [{ id: 1, username: 'a' }, null, { id: 2, username: 'b' }],
        next_href: 'https://api-v2.soundcloud.com/users/9/followings?offset=2&limit=200'
      })
    })
    const list = await h.social.getFollowings()
    expect(list.map((a) => a.id)).toEqual(['soundcloud:1', 'soundcloud:2', 'soundcloud:3'])
    expect(h.apiCalls().map(path)).toEqual(['/users/9/followings', '/users/9/followings'])
    expect(new URL(h.apiCalls()[0]!.url).searchParams.get('limit')).toBe('200')
    // The list fills the isFollowing cache.
    expect(await h.social.isFollowing('2')).toBe(true)
    expect(h.apiCalls()).toHaveLength(2)
  })

  it(`stops at ${FOLLOWINGS_MAX}`, async () => {
    let n = 0
    const h = setup(() =>
      json({
        collection: Array.from({ length: 200 }, () => ({ id: ++n, username: `u${n}` })),
        next_href: `https://api-v2.soundcloud.com/users/9/followings?offset=${n}`
      })
    )
    const list = await h.social.getFollowings()
    expect(list).toHaveLength(FOLLOWINGS_MAX)
    expect(h.apiCalls()).toHaveLength(FOLLOWINGS_MAX / 200)
  })

  it('logged out: a readable error', async () => {
    const h = setup(() => json({}), { loggedIn: false })
    expect((await rejection(h.social.getFollowings())).message).toBe(
      'Log in to SoundCloud in Settings to see who you follow.'
    )
  })
})

describe('isFollowing / setFollowing', () => {
  function idsServer(ids: number[]) {
    return (c: Call, url: URL): Response => {
      if (c.method !== 'GET') return json({})
      if (url.pathname === '/users/9/followings/ids')
        return json({ collection: ids, next_href: null })
      return json({}, 404)
    }
  }

  it('caches the ids for a minute', async () => {
    const h = setup(idsServer([5, 6]))
    expect(await h.social.isFollowing('5')).toBe(true)
    expect(await h.social.isFollowing('soundcloud:7')).toBe(false)
    expect(h.apiCalls()).toHaveLength(1)
    expect(new URL(h.apiCalls()[0]!.url).searchParams.get('limit')).toBe('200')
    h.advance(SOCIAL_IDS_TTL_MS)
    await h.social.isFollowing('5')
    expect(h.apiCalls()).toHaveLength(2)
  })

  it('pages the ids', async () => {
    const h = setup((_c, url) =>
      url.searchParams.get('cursor')
        ? json({ collection: [8], next_href: null })
        : json({
            collection: [5],
            next_href: 'https://api-v2.soundcloud.com/users/9/followings/ids?cursor=2'
          })
    )
    expect(await h.social.isFollowing('8')).toBe(true)
  })

  it('is false logged out without a request', async () => {
    const h = setup(idsServer([5]), { loggedIn: false })
    expect(await h.social.isFollowing('5')).toBe(false)
    expect(h.apiCalls()).toHaveLength(0)
  })

  it('follows with POST me/followings/:id and the signature, then invalidates', async () => {
    const h = setup(idsServer([5]))
    await h.social.isFollowing('5')
    await h.social.setFollowing('soundcloud:12345', true)
    const post = h.apiCalls().find((c) => c.method === 'POST')!
    expect(path(post)).toBe('/me/followings/12345')
    expect(post.body).toBeUndefined()
    const q = new URL(post.url).searchParams
    expect(q.get('signature')).toBe(signFollow('9', '12345', CID, SECRET, UA))
    expect(q.get('client_id')).toBe(CID)
    await h.social.isFollowing('5')
    expect(h.apiCalls().filter((c) => c.method === 'GET')).toHaveLength(2)
  })

  it('unfollows with DELETE and no signature', async () => {
    const h = setup(idsServer([]))
    await h.social.setFollowing('12345', false)
    const del = h.apiCalls()[0]!
    expect([del.method, path(del)]).toEqual(['DELETE', '/me/followings/12345'])
    expect(new URL(del.url).searchParams.has('signature')).toBe(false)
    // No secret scrape for an unfollow.
    expect(h.fetch.calls.some((c) => c.url.startsWith('https://soundcloud.com'))).toBe(false)
  })

  it('uses the built-in secret when the scrape fails', async () => {
    const h = setup(idsServer([]), { bundle: null })
    await h.social.setFollowing('12345', true)
    const post = h.apiCalls()[0]!
    expect(new URL(post.url).searchParams.get('signature')).toBe(
      signFollow('9', '12345', CID, '5Dpr3ubBw8LFtbvQcd4Hx6hU', UA)
    )
  })

  it('re-scrapes the secret once when the signed follow is refused', async () => {
    let posts = 0
    const secrets = ['oldSecret0000', 'newSecret1111']
    const fetchHandler = (c: Call): Response => {
      if (c.method !== 'POST') return json({})
      posts++
      return posts === 1 ? json({ error: 'bad signature' }, 422) : json({})
    }
    const h = setup(fetchHandler, {
      bundle: () => `__FOLLOWS_SIGNATURE_SECRET__="${secrets.shift() ?? 'unused'}"`
    })
    // First POST uses the first scrape, the retry the second.
    await h.social.setFollowing('12345', true)
    const sigs = h
      .apiCalls()
      .filter((c) => c.method === 'POST')
      .map((c) => new URL(c.url).searchParams.get('signature'))
    expect(sigs).toEqual([
      signFollow('9', '12345', CID, 'oldSecret0000', UA),
      signFollow('9', '12345', CID, 'newSecret1111', UA)
    ])
  })

  it('refuses to follow yourself, logged out or without a user agent', async () => {
    expect((await rejection(setup(idsServer([])).social.setFollowing('9', true))).message).toMatch(
      /yourself/
    )
    const out = setup(idsServer([]), { loggedIn: false })
    expect((await rejection(out.social.setFollowing('5', true))).message).toBe(
      'Log in to SoundCloud in Settings to follow people.'
    )
    const noUa = setup(idsServer([]), { userAgent: '' })
    expect((await rejection(noUa.social.setFollowing('5', true))).message).toMatch(/user agent/)
    expect(out.apiCalls().concat(noUa.apiCalls())).toHaveLength(0)
  })
})

describe('isReposted / setReposted', () => {
  it('reads me/track_reposts/ids, caches it and invalidates on change', async () => {
    const h = setup((c) => (c.method === 'GET' ? json({ collection: [7] }) : json({})))
    expect(await h.social.isReposted('soundcloud:7')).toBe(true)
    expect(await h.social.isReposted('8')).toBe(false)
    expect(h.apiCalls().map(path)).toEqual(['/me/track_reposts/ids'])

    await h.social.setReposted('8', true)
    await h.social.setReposted('soundcloud:7', false)
    const writes = h.apiCalls().filter((c) => c.method !== 'GET')
    expect(writes.map((c) => [c.method, path(c)])).toEqual([
      ['PUT', '/me/track_reposts/8'],
      ['DELETE', '/me/track_reposts/7']
    ])
    expect(writes[0]!.headers.Authorization).toBe('OAuth tok')
    await h.social.isReposted('7')
    expect(h.apiCalls().filter((c) => c.method === 'GET')).toHaveLength(2)
  })

  it('invalidates even when the write fails', async () => {
    const h = setup((c) => (c.method === 'GET' ? json({ collection: [] }) : json({}, 500)))
    await h.social.isReposted('7')
    await expect(h.social.setReposted('7', true)).rejects.toThrow(/500/)
    await h.social.isReposted('7')
    expect(h.apiCalls().filter((c) => c.method === 'GET')).toHaveLength(2)
  })

  it('logged out: false to read, a readable error to write', async () => {
    const h = setup(() => json({}), { loggedIn: false })
    expect(await h.social.isReposted('7')).toBe(false)
    expect((await rejection(h.social.setReposted('7', true))).message).toBe(
      'Log in to SoundCloud in Settings to repost tracks.'
    )
    expect(h.apiCalls()).toHaveLength(0)
  })
})

describe('createPlaylist', () => {
  const sc = (id: string): Track => ({
    id: `soundcloud:${id}`,
    provider: 'soundcloud',
    nativeId: id,
    title: 't',
    artists: [],
    durationMs: 1
  })

  it('POSTs a private playlist with the track ids in order', async () => {
    const h = setup(() =>
      json({ id: 555, kind: 'playlist', title: 'Copy', user_id: 9, track_count: 3 })
    )
    const p = await h.provider.createPlaylist(' Copy ', [sc('3'), sc('1'), sc('2')])
    const call = h.apiCalls()[0]!
    expect([call.method, path(call)]).toEqual(['POST', '/playlists'])
    expect(JSON.parse(call.body!)).toEqual({
      playlist: { title: 'Copy', sharing: 'private', tracks: [3, 1, 2] }
    })
    expect(call.headers['Content-Type']).toBe('application/json')
    expect(p).toMatchObject({
      id: 'soundcloud:555',
      source: 'soundcloud',
      name: 'Copy',
      canEdit: true,
      trackCount: 3
    })
  })

  it('rejects non-SoundCloud tracks, empty names and oversized lists before any request', async () => {
    const h = setup(() => json({}))
    const sp: Track = { ...sc('1'), id: 'spotify:x', provider: 'spotify', nativeId: 'x' }
    await expect(h.provider.createPlaylist('Copy', [sc('1'), sp])).rejects.toThrow(
      /Not a SoundCloud track/
    )
    await expect(h.provider.createPlaylist('  ', [sc('1')])).rejects.toThrow(/name/)
    const many = Array.from({ length: PLAYLIST_MAX_TRACKS + 1 }, (_, i) => sc(String(i + 1)))
    await expect(h.provider.createPlaylist('Big', many)).rejects.toThrow(/at most 500/)
    expect(h.apiCalls()).toHaveLength(0)
  })

  it('logged out: a readable error', async () => {
    const h = setup(() => json({}), { loggedIn: false })
    expect((await rejection(h.provider.createPlaylist('Copy', [sc('1')]))).message).toBe(
      'Log in to SoundCloud in Settings to create playlists.'
    )
  })
})
