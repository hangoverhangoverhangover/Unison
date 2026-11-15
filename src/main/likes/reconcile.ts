// Reconciles the local likes table with Spotify and SoundCloud: on demand (the caller
// triggers the startup sync when a service connects) and every 30 minutes after start().
import type { ServiceProvider } from '@shared/ipc'
import type { LikesSyncStatus } from '@shared/library'
import type { MusicProvider } from '@shared/provider'
import type { LikedTrack, Track } from '@shared/types'
import { isLikeableTrack, type LikesStore } from './store'

export const SYNC_INTERVAL_MS = 30 * 60_000
/** Above this many stored likes, an empty answer from a service is logged. */
const SUSPICIOUS_EMPTY = 20

const SERVICES: readonly ServiceProvider[] = ['spotify', 'soundcloud']

type TimerHandle = ReturnType<typeof globalThis.setInterval>

export interface LikesSyncOptions {
  store: LikesStore
  getProvider(provider: ServiceProvider): MusicProvider | undefined
  isConnected(provider: ServiceProvider): boolean
  /** The likes table changed (sync or a recorded like/unlike). */
  onChanged(): void
  onStatus(status: LikesSyncStatus): void
  /**
   * SoundCloud tracks a reconcile found newly liked (on the service, not yet in the
   * table), newest like first. Never called on the first SoundCloud sync into an empty
   * table (that would be the whole library) and never for tracks already stored.
   * Likes made in this app are stored right away (recordLikeChange), so they don't
   * show up here.
   */
  onNewLikes?(tracks: Track[]): void
  now?: () => Date
  intervalMs?: number
  setInterval?: (fn: () => void, ms: number) => TimerHandle
  clearInterval?: (handle: TimerHandle) => void
  logger?: Pick<Console, 'warn' | 'error'>
}

export interface LikesSync {
  /** Reconcile every connected service. Returns the running sync if one is in flight. */
  syncNow(): Promise<void>
  /** Schedule syncNow() every intervalMs. Does not sync immediately. */
  start(): void
  dispose(): void
  status(): LikesSyncStatus
  /**
   * Call AFTER the service accepted a like/unlike. Updates the local table, fires
   * onChanged if it changed, and stops an in-flight sync from overwriting it with a
   * list fetched before the change.
   */
  recordLikeChange(track: Track, liked: boolean): boolean
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return typeof err === 'string' && err ? err : 'Unknown error'
}

export function createLikesSync(opts: LikesSyncOptions): LikesSync {
  const { store } = opts
  const now = opts.now ?? (() => new Date())
  const intervalMs = opts.intervalMs ?? SYNC_INTERVAL_MS
  const setTimer = opts.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms))
  const clearTimer = opts.clearInterval ?? ((h) => globalThis.clearInterval(h))
  const log = opts.logger ?? console

  let running: Promise<void> | null = null
  let timer: TimerHandle | null = null
  let disposed = false
  /** Bumped by recordLikeChange so a sync started earlier doesn't undo it. */
  const generation: Record<ServiceProvider, number> = { spotify: 0, soundcloud: 0 }
  const state: LikesSyncStatus = {
    syncing: false,
    lastSyncedAt: { spotify: null, soundcloud: null },
    errors: {}
  }

  function status(): LikesSyncStatus {
    return {
      syncing: state.syncing,
      lastSyncedAt: { ...state.lastSyncedAt },
      errors: { ...state.errors }
    }
  }

  function publish(): void {
    if (!disposed) opts.onStatus(status())
  }

  function notifyNewLikes(liked: readonly LikedTrack[], before: Map<string, string>): void {
    if (!opts.onNewLikes || disposed) return
    const seen = new Set<string>()
    const fresh: Track[] = []
    for (const l of liked) {
      const t = l?.track
      if (!isLikeableTrack(t) || t.provider !== 'soundcloud') continue
      if (before.has(t.id) || seen.has(t.id)) continue
      seen.add(t.id)
      fresh.push(t)
    }
    if (fresh.length === 0) return
    try {
      opts.onNewLikes(fresh)
    } catch (err) {
      log.error('[likes] onNewLikes failed:', err)
    }
  }

  async function syncOne(provider: ServiceProvider): Promise<boolean> {
    const startGen = generation[provider]
    try {
      const p = opts.getProvider(provider)
      if (!p) throw new Error('Service is not available.')
      const liked = await p.getLikes()
      if (disposed) return false
      if (generation[provider] !== startGen) {
        // A like/unlike landed while we were fetching; this list may predate it.
        // Leave the table alone; the next sync picks up the settled state.
        return false
      }
      if (!Array.isArray(liked)) throw new Error('Service returned an invalid likes list.')
      const before = store.snapshot(provider)
      if (liked.length === 0) {
        const stored = before.size
        if (stored > SUSPICIOUS_EMPTY)
          log.warn(`[likes] ${provider} returned 0 likes; clearing ${stored} stored likes.`)
      }
      const changed = store.replaceForProvider(provider, liked)
      delete state.errors[provider]
      state.lastSyncedAt[provider] = now().toISOString()
      if (changed && provider === 'soundcloud' && before.size > 0) notifyNewLikes(liked, before)
      return changed
    } catch (err) {
      // Keep the last stored likes: never wipe on error.
      state.errors[provider] = errorMessage(err)
      log.error(`[likes] ${provider} sync failed:`, err)
      return false
    }
  }

  async function run(): Promise<void> {
    state.syncing = true
    publish()
    let changed = false
    try {
      const connected = SERVICES.filter((s) => {
        try {
          return opts.isConnected(s)
        } catch {
          return false
        }
      })
      // replaceForProvider compares the provider's id+likedAt set before and after.
      changed = (await Promise.all(connected.map(syncOne))).some(Boolean)
    } finally {
      state.syncing = false
      if (!disposed) {
        publish()
        if (changed) opts.onChanged()
      }
    }
  }

  function syncNow(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (!running) {
      running = run().finally(() => {
        running = null
      })
    }
    return running
  }

  return {
    syncNow,
    status,
    start() {
      if (disposed || timer) return
      timer = setTimer(() => {
        void syncNow().catch((err) => log.error('[likes] scheduled sync failed:', err))
      }, intervalMs)
    },
    dispose() {
      disposed = true
      if (timer) clearTimer(timer)
      timer = null
    },
    recordLikeChange(track, liked) {
      if (!isLikeableTrack(track)) return false
      generation[track.provider]++
      const changed = liked ? store.add(track) : store.remove(track.id)
      if (changed && !disposed) opts.onChanged()
      return changed
    }
  }
}
