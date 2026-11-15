// SoundCloud social features over api-v2 (QoL round 2): the feed, a profile's reposts,
// followings, follow/unfollow and repost/unrepost. Endpoints and HTTP methods come from
// the soundcloud.com web client's endpoint map (read 2026-11-12; `get/post/put/delete`
// variables resolved in the bundle):
//   stream                       GET     feed (login required)
//   stream/users/:id/reposts     GET     a profile's reposts (works logged out, checked live)
//   users/:id/followings         GET     who someone follows (works logged out, checked live)
//   users/:userId/followings/ids GET     myFollowingsIds (401 logged out)
//   me/followings/:id            POST    myFollowingsCreate, with ?signature= (followSignature.ts)
//   me/followings/:id            DELETE  myFollowingsDelete
//   me/track_reposts/ids         GET     soundRepostsIds (web client reads with limit=200)
//   me/track_reposts/:id         PUT     soundRepostsCreate
//   me/track_reposts/:id         DELETE  soundRepostsDelete
// Follow and repost are public actions: only the IPC handlers call them, after the
// renderer confirmed with the user. Nothing here calls them on its own.
import type { FeedItem, FeedPage } from '@shared/soundcloud'
import type { Artist } from '@shared/types'
import {
  API_BASE,
  SoundCloudApiError,
  SoundCloudDataDomeError,
  SoundCloudLoginExpiredError,
  SoundCloudNotConnectedError,
  type ScPage,
  type SoundCloudApi
} from './api'
import type { ClientIdStore } from './clientId'
import { signFollow, type FollowSecretStore } from './followSignature'
import { mapFeedItem, mapUser, type ScStreamItem, type ScUser } from './mapping'
import { assertScId, type ScUserRef } from './provider'

export const FEED_PAGE_LIMIT = 50
export const FOLLOWINGS_PAGE_LIMIT = 200
/** Safety stop for getFollowings. */
export const FOLLOWINGS_MAX = 2000
export const IDS_PAGE_LIMIT = 200
const IDS_MAX_PAGES = 100
export const SOCIAL_IDS_TTL_MS = 60_000

export interface SocialDeps {
  api: SoundCloudApi
  clientIds: ClientIdStore
  secrets: FollowSecretStore
  requireUser: () => Promise<ScUserRef>
  /** The User-Agent the session's requests go out with (the follow signature uses it). */
  getUserAgent?: () => string
  now?: () => number
}

interface IdCache {
  userId: string
  at: number
  ids: Set<string>
}

/** `soundcloud:123` or `123` -> `123`, validated. */
export function scNativeId(id: string, what: string): string {
  const native = typeof id === 'string' && id.startsWith('soundcloud:') ? id.slice(11) : id
  assertScId(native, what)
  return native
}

/** The plain not-connected error, reworded for this action. Expired logins keep theirs. */
function loggedOutError(err: unknown, action: string): unknown {
  if (err instanceof SoundCloudNotConnectedError && !(err instanceof SoundCloudLoginExpiredError))
    return new SoundCloudNotConnectedError(`Log in to SoundCloud in Settings to ${action}.`)
  return err
}

/** Ids out of an ids page: `{collection: [ids], next_href}` or a bare array (shape unverified). */
function parseIdsPage(res: unknown): { ids: string[]; next: string | null } {
  const list: unknown[] = Array.isArray(res)
    ? res
    : Array.isArray((res as { collection?: unknown })?.collection)
      ? (res as { collection: unknown[] }).collection
      : []
  const ids: string[] = []
  for (const v of list) {
    const raw =
      typeof v === 'number' || typeof v === 'string' ? v : (v as { id?: unknown } | null)?.id
    const id = typeof raw === 'number' || typeof raw === 'string' ? String(raw) : ''
    if (/^\d+$/.test(id)) ids.push(id)
  }
  const href = Array.isArray(res) ? null : (res as { next_href?: unknown })?.next_href
  return { ids, next: typeof href === 'string' && href ? href : null }
}

export class SoundCloudSocial {
  private following: IdCache | null = null
  private reposted: IdCache | null = null
  private readonly now: () => number

  constructor(private readonly deps: SocialDeps) {
    this.now = deps.now ?? Date.now
  }

  private get api(): SoundCloudApi {
    return this.deps.api
  }

  /** Forget cached id lists (logout / account switch). */
  reset(): void {
    this.following = null
    this.reposted = null
  }

  /** The feed: uploads and reposts from people you follow, newest first. Login required. */
  async getFeed(cursor?: string): Promise<FeedPage> {
    return this.loggedIn('see your feed', async () => {
      await this.deps.requireUser()
      return this.feedPage('stream', cursor, 'required')
    })
  }

  /** A profile's reposts, newest first. Works logged out. */
  async getReposts(userId: string, cursor?: string): Promise<FeedPage> {
    const id = scNativeId(userId, 'user')
    const page = await this.feedPage(`stream/users/${id}/reposts`, cursor, 'optional')
    // Everything on this endpoint is a repost by that profile.
    return { ...page, items: page.items.map((i) => ({ ...i, type: 'repost' as const })) }
  }

  /** `users/{me}/followings`, every page up to FOLLOWINGS_MAX, API order (newest first). */
  async getFollowings(): Promise<Artist[]> {
    return this.loggedIn('see who you follow', async () => {
      const me = await this.deps.requireUser()
      const out: Artist[] = []
      const seen = new Set<string>()
      let next: string | null = this.api
        .url(`users/${me.id}/followings`, {
          limit: FOLLOWINGS_PAGE_LIMIT,
          linked_partitioning: 1
        })
        .toString()
      while (next) {
        const page: ScPage<ScUser> | undefined = await this.api.get(next, undefined, 'required')
        const list = Array.isArray(page?.collection) ? page.collection : []
        for (const raw of list) {
          const a = mapUser(raw)
          if (!a || seen.has(a.id)) continue
          seen.add(a.id)
          out.push(a)
          if (out.length >= FOLLOWINGS_MAX) {
            console.warn(`[soundcloud] followings: stopped at ${FOLLOWINGS_MAX}`)
            return out
          }
        }
        next = list.length > 0 ? (page?.next_href ?? null) : null
      }
      // Any follow/unfollow made elsewhere shows up here; keep the ids cache in step.
      this.following = {
        userId: me.id,
        at: this.now(),
        ids: new Set(out.map((a) => a.nativeId))
      }
      return out
    })
  }

  /** From `users/{me}/followings/ids`, cached a minute. False when logged out. */
  async isFollowing(userId: string): Promise<boolean> {
    const id = scNativeId(userId, 'user')
    const me = await this.currentUser()
    if (!me) return false
    const ids = await this.cachedIds('following', me, `users/${me.id}/followings/ids`)
    return ids.has(id)
  }

  /**
   * Follow (`POST me/followings/:id?signature=`) or unfollow (`DELETE me/followings/:id`).
   * Public action: call only from a confirmed user action.
   */
  async setFollowing(userId: string, follow: boolean): Promise<void> {
    const id = scNativeId(userId, 'user')
    await this.loggedIn(follow ? 'follow people' : 'unfollow people', async () => {
      const me = await this.deps.requireUser()
      if (id === me.id) throw new Error("You can't follow yourself.")
      try {
        if (follow) await this.postFollow(me.id, id)
        else await this.api.request('DELETE', `me/followings/${id}`, { auth: 'required' })
      } finally {
        this.following = null
      }
    })
  }

  /** From `me/track_reposts/ids`, cached a minute. False when logged out. */
  async isReposted(trackId: string): Promise<boolean> {
    const id = scNativeId(trackId, 'track')
    const me = await this.currentUser()
    if (!me) return false
    const ids = await this.cachedIds('reposted', me, 'me/track_reposts/ids')
    return ids.has(id)
  }

  /** `PUT` / `DELETE me/track_reposts/:id`. Public action: call only from a confirmed user action. */
  async setReposted(trackId: string, repost: boolean): Promise<void> {
    const id = scNativeId(trackId, 'track')
    await this.loggedIn(repost ? 'repost tracks' : 'remove reposts', async () => {
      await this.deps.requireUser()
      try {
        await this.api.request(repost ? 'PUT' : 'DELETE', `me/track_reposts/${id}`, {
          auth: 'required'
        })
      } finally {
        this.reposted = null
      }
    })
  }

  /**
   * One signed follow. The signature covers the client_id, so it's computed with the id
   * the request will carry; if SoundCloud rejects it (400/403/422), the secret is
   * re-scraped once and the follow retried with a fresh signature (also when the
   * client_id changed meanwhile).
   */
  private async postFollow(meId: string, targetId: string): Promise<void> {
    const ua = this.deps.getUserAgent?.()
    if (!ua) throw new Error("Can't follow from here: the app's user agent is unknown.")
    let retried = false
    for (;;) {
      const [clientId, secret] = await Promise.all([
        this.deps.clientIds.get(),
        this.deps.secrets.get()
      ])
      const signature = signFollow(meId, targetId, clientId, secret, ua)
      try {
        await this.api.request('POST', `me/followings/${targetId}`, {
          query: { signature },
          auth: 'required'
        })
        return
      } catch (err) {
        const rejected =
          err instanceof SoundCloudApiError &&
          !(err instanceof SoundCloudDataDomeError) &&
          [400, 403, 422].includes(err.status)
        if (!rejected || retried) throw err
        retried = true
        // Retry when the secret changed, or the client_id rotated under this request
        // (the api client re-scrapes it on a 403 and retries with the stale signature).
        const newSecret = await this.deps.secrets.refresh(secret)
        if (!newSecret && (await this.deps.clientIds.get()) === clientId) throw err
      }
    }
  }

  private async currentUser(): Promise<ScUserRef | null> {
    try {
      return await this.deps.requireUser()
    } catch (err) {
      if (err instanceof SoundCloudNotConnectedError) return null
      throw err
    }
  }

  private async cachedIds(
    which: 'following' | 'reposted',
    me: ScUserRef,
    path: string
  ): Promise<Set<string>> {
    const hit = this[which]
    if (hit && hit.userId === me.id && this.now() - hit.at < SOCIAL_IDS_TTL_MS) return hit.ids
    const ids = new Set<string>()
    let next: string | null = this.api.url(path, { limit: IDS_PAGE_LIMIT }).toString()
    for (let i = 0; next && i < IDS_MAX_PAGES; i++) {
      const page = parseIdsPage(await this.api.get(next, undefined, 'required'))
      for (const id of page.ids) ids.add(id)
      next = page.ids.length > 0 ? page.next : null
    }
    this[which] = { userId: me.id, at: this.now(), ids }
    return ids
  }

  /** One page of a stream-shaped endpoint; `cursor` is a `next` this method returned. */
  private async feedPage(
    path: string,
    cursor: string | undefined,
    auth: 'optional' | 'required'
  ): Promise<FeedPage> {
    const url =
      cursor === undefined || cursor === null || cursor === ''
        ? this.api.url(path, { limit: FEED_PAGE_LIMIT, linked_partitioning: 1 }).toString()
        : validateCursor(cursor, path)
    const page = await this.api.get<ScPage<ScStreamItem>>(url, undefined, auth)
    const list = Array.isArray(page?.collection) ? page.collection : []
    const items: FeedItem[] = []
    const seen = new Set<string>()
    for (const raw of list) {
      const item = mapFeedItem(raw)
      if (!item || seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
    const out: FeedPage = { items }
    const next = list.length > 0 ? nextCursor(page?.next_href, path) : undefined
    if (next) out.next = next
    return out
  }

  private async loggedIn<T>(action: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      throw loggedOutError(err, action)
    }
  }
}

/** The api-v2 URL a cursor stands for; throws unless it's for `path` on api-v2. */
export function validateCursor(cursor: string, path: string): string {
  let url: URL
  try {
    if (typeof cursor !== 'string') throw new Error('not a string')
    url = new URL(cursor)
  } catch {
    throw new Error('Invalid SoundCloud page cursor.')
  }
  if (url.origin !== API_BASE || url.pathname !== `/${path}` || url.username || url.password)
    throw new Error('Invalid SoundCloud page cursor.')
  // The api client adds the current client_id itself.
  url.searchParams.delete('client_id')
  url.searchParams.delete('oauth_token')
  return url.toString()
}

/** `next_href` as an opaque cursor (client_id stripped), or undefined when it isn't usable. */
function nextCursor(href: string | null | undefined, path: string): string | undefined {
  if (typeof href !== 'string' || !href) return undefined
  try {
    return validateCursor(href, path)
  } catch {
    console.warn(`[soundcloud] ${path}: ignoring an unexpected next_href`)
    return undefined
  }
}
