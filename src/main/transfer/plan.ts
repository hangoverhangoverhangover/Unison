// transfer:plan and transfer:create: copy a playlist to the other service. Every match
// is shown to the user to confirm; this only finds candidates and reports confidence.
import type { ServiceProvider } from '@shared/ipc'
import type { MusicProvider, PlaylistCreator } from '@shared/provider'
import type {
  MatchConfidence,
  TransferCandidate,
  TransferPlan,
  TransferRequest,
  TransferResult
} from '@shared/transfer'
import { isPlayable, type Track } from '@shared/types'
import {
  cleanTitle,
  compareShapes,
  confidenceRank,
  DURATION_SLACK_MS,
  normalizeIsrc,
  searchQuery,
  songShape,
  splitDashPrefix,
  stripArtistPrefix
} from '../music/match'
import { isServiceProvider, notConnectedMessage } from '../music/router'
import { SoundCloudApiError, SoundCloudDataDomeError } from '../soundcloud/api'

/** Matches kept per source track. */
export const MAX_CANDIDATES = 5
/** Spotify searches running at once across the whole plan. */
export const SEARCH_CONCURRENCY = 3
/**
 * SoundCloud flags bursts as bots, so its plan searches run one at a time with at least
 * this long between request starts (retries included).
 */
export const SOUNDCLOUD_SEARCH_GAP_MS = 1500
/** Waits before retrying a SoundCloud search that hit a rate limit; then the plan stops. */
export const RATE_LIMIT_BACKOFF_MS: readonly number[] = [5_000, 15_000, 45_000]
export const SOUNDCLOUD_LIMITED_MESSAGE =
  'SoundCloud is limiting requests right now. Try again in a few minutes.'
/** Minimum gap between transfer:progress events (about 4 per second). */
export const PROGRESS_INTERVAL_MS = 250
/** Longest name a new playlist may have. */
export const PLAYLIST_NAME_MAX = 100
/** Most tracks one transfer may create (Spotify caps playlists at 10,000 items). */
export const TRANSFER_MAX_TRACKS = 10_000

const SERVICE_NAMES: Record<ServiceProvider, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud'
}

export interface PlanDeps {
  getProvider: (service: ServiceProvider) => MusicProvider | undefined
  /** Tracks of any playlist id the app knows (`app:`, `spotify:`, `soundcloud:`). */
  getPlaylistTracks: (playlistId: string) => Promise<Track[]> | Track[]
  onProgress?: (progress: { done: number; total: number }) => void
  /** Clock for progress throttling (tests). Default Date.now. */
  now?: () => number
  /**
   * Per-service search gates. Pass the same ones to every plan (index.ts does) so two
   * overlapping plans still share SoundCloud's pacing. Default: fresh ones per plan.
   */
  gates?: SearchGates
  /** Aborting stops the plan: no more searches or progress; rejects with PlanCancelledError. */
  signal?: AbortSignal
}

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>

/** Concurrency plus spacing for one service's searches. */
export interface SearchGate {
  limit: Limiter
  /** Called right before each request: waits until the next request may start. */
  pace: () => Promise<void>
}

export type SearchGates = Record<ServiceProvider, SearchGate>

export class PlanCancelledError extends Error {
  constructor() {
    super('This copy was cancelled.')
    this.name = 'PlanCancelledError'
  }
}

/**
 * Spaces calls at least `minGapMs` apart by start time. Each call reserves its start
 * slot synchronously, so concurrent callers can't take the same one.
 */
export function createPacer(minGapMs: number): () => Promise<void> {
  let nextStart = -Infinity
  return async () => {
    if (minGapMs <= 0) return
    const now = Date.now()
    const start = Math.max(now, nextStart)
    nextStart = start + minGapMs
    if (start > now) await new Promise<void>((resolve) => setTimeout(resolve, start - now))
  }
}

/** Spotify: 3 at once, unpaced. SoundCloud: one at a time, SOUNDCLOUD_SEARCH_GAP_MS apart. */
export function createSearchGates(): SearchGates {
  return {
    spotify: { limit: createLimiter(SEARCH_CONCURRENCY), pace: createPacer(0) },
    soundcloud: { limit: createLimiter(1), pace: createPacer(SOUNDCLOUD_SEARCH_GAP_MS) }
  }
}

/**
 * SoundCloud pushing back: HTTP 429 (after the api client's own short retries), a
 * "please wait" / rate-limit reply, or a DataDome bot check.
 */
export function isSoundCloudRateLimit(err: unknown): boolean {
  if (err instanceof SoundCloudDataDomeError) return true
  if (!(err instanceof SoundCloudApiError)) return false
  return err.status === 429 || /please wait|rate limit/i.test(err.message)
}

/** A promise gate: at most `limit` `run` calls in flight. */
export function createLimiter(limit: number): Limiter {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    // A finishing call hands its slot straight to the next waiter, so `active` never
    // dips below the limit while someone waits (no newcomer can jump in between).
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    else active++
    try {
      return await fn()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

/**
 * What to search for on the target. The usual "<first artist> <cleaned title>", plus
 * "<prefix> <rest>" when the title reads "Someone - Title" and Someone isn't one of the
 * track's own artists (SoundCloud archive uploads). Local files without an artist tag
 * search by title alone.
 */
export function searchQueries(track: Pick<Track, 'title' | 'artists'>): string[] {
  const out: string[] = []
  const usual = searchQuery(track)
  if (usual) out.push(usual)
  else {
    const title = cleanTitle(stripArtistPrefix(track.title, track.artists)).trim()
    if (title) out.push(title)
  }
  const split = splitDashPrefix(track.title)
  if (split && stripArtistPrefix(track.title, track.artists) === track.title.trim()) {
    const alt = `${split.prefix} ${cleanTitle(split.rest)}`.trim()
    if (alt && !out.includes(alt)) out.push(alt)
  }
  return out
}

/**
 * Same-song candidates for `source` among `results` (service order), best first:
 * confidence, then playable, then duration within 3 s, then service order. Deduped.
 */
export function rankCandidates(
  source: Track,
  results: Track[]
): { track: Track; confidence: MatchConfidence }[] {
  const shape = songShape(source)
  const seen = new Set<string>([source.id])
  const scored: { track: Track; confidence: MatchConfidence; key: number[] }[] = []
  results.forEach((t, index) => {
    if (!t || typeof t.id !== 'string' || seen.has(t.id)) return
    const confidence = compareShapes(shape, songShape(t))
    if (!confidence) return
    seen.add(t.id)
    const closeDuration =
      source.durationMs > 0 &&
      t.durationMs > 0 &&
      Math.abs(source.durationMs - t.durationMs) <= DURATION_SLACK_MS
    scored.push({
      track: t,
      confidence,
      key: [confidenceRank(confidence), isPlayable(t) ? 0 : 1, closeDuration ? 0 : 1, index]
    })
  })
  return scored
    .sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i]! - b.key[i]!
      return 0
    })
    .slice(0, MAX_CANDIDATES)
    .map(({ track, confidence }) => ({ track, confidence }))
}

export async function planTransfer(
  deps: PlanDeps,
  playlistId: string,
  target: ServiceProvider
): Promise<TransferPlan> {
  if (typeof playlistId !== 'string' || !playlistId.includes(':'))
    throw new Error(`Invalid playlist id: ${String(playlistId)}`)
  if (!isServiceProvider(target)) throw new Error(`Unknown music service: ${String(target)}`)
  const provider = deps.getProvider(target)
  if (!provider) throw new Error(notConnectedMessage(target))
  const tracks = (await deps.getPlaylistTracks(playlistId)).filter(
    (t): t is Track => !!t && typeof t.id === 'string'
  )

  const now = deps.now ?? Date.now
  const total = tracks.length
  let done = 0
  let lastDone = -1
  let lastEmit = -Infinity

  // Stopping (cancelled, or SoundCloud keeps refusing) ends every search and all progress.
  let stopError: Error | undefined
  const wakers = new Set<() => void>()
  const stop = (err: Error): void => {
    if (stopError) return
    stopError = err
    for (const wake of [...wakers]) wake()
  }
  /** A timer that ends early when the plan stops. */
  const wait = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const wake = (): void => {
        clearTimeout(timer)
        wakers.delete(wake)
        resolve()
      }
      const timer = setTimeout(wake, ms)
      wakers.add(wake)
    })
  const onAbort = (): void => stop(new PlanCancelledError())
  if (deps.signal?.aborted) throw new PlanCancelledError()
  deps.signal?.addEventListener('abort', onAbort, { once: true })

  // `done` only grows: one step per source track, when its matching ends (all its
  // searches and retries finished or failed). Nothing is sent once the plan has stopped.
  const report = (force: boolean): void => {
    if (!deps.onProgress || stopError || done <= lastDone) return
    const t = now()
    if (!force && t - lastEmit < PROGRESS_INTERVAL_MS) return
    lastEmit = t
    lastDone = done
    deps.onProgress({ done, total })
  }

  try {
    report(true)
    const gate = (deps.gates ?? createSearchGates())[target]
    const search = (q: string): Promise<Track[]> =>
      gate.limit(async () => {
        for (let attempt = 0; ; attempt++) {
          if (stopError) throw stopError
          await gate.pace()
          if (stopError) throw stopError
          try {
            return await provider.search(q, 0)
          } catch (err) {
            if (target !== 'soundcloud' || !isSoundCloudRateLimit(err)) throw err
            const delay = RATE_LIMIT_BACKOFF_MS[attempt]
            if (delay === undefined) {
              // The bot check needs the user (log in again); plain limits need time.
              stop(
                err instanceof SoundCloudDataDomeError
                  ? err
                  : new Error(SOUNDCLOUD_LIMITED_MESSAGE, { cause: err })
              )
              throw stopError
            }
            console.warn(`[transfer] SoundCloud is limiting searches; retrying in ${delay / 1000}s`)
            // Waits inside the gate on purpose: every other SoundCloud search pauses too.
            await wait(delay)
          }
        }
      })
    let searched = 0
    const errors: unknown[] = []

    const candidates = await Promise.all(
      tracks.map(async (source): Promise<TransferCandidate> => {
        try {
          // Already on the target (say a SoundCloud track copied to SoundCloud): no search.
          if (source.provider === target)
            return { source, matches: [{ track: source, confidence: 'isrc' }] }
          searched++
          const isrc = normalizeIsrc(source.isrc)
          // Spotify takes `isrc:` as a search filter; SoundCloud has none, so there the
          // ISRC only marks title-search results that carry the same one.
          const queries = [
            ...(target === 'spotify' && isrc ? [`isrc:${isrc}`] : []),
            ...searchQueries(source)
          ]
          const results = await Promise.all(
            queries.map((q) =>
              search(q).catch((err: unknown) => {
                if (stopError) throw stopError
                errors.push(err)
                return [] as Track[]
              })
            )
          )
          return { source, matches: rankCandidates(source, results.flat()) }
        } finally {
          done++
          report(done === total)
        }
      })
    )
    if (stopError) throw stopError

    // Every search failing means the service is down or the login broke, not "no matches".
    if (searched > 0 && errors.length > 0 && candidates.every((c) => c.matches.length === 0)) {
      const first = errors[0]
      throw first instanceof Error ? first : new Error(String(first))
    }
    if (errors.length > 0)
      console.warn(`[transfer] ${errors.length} searches on ${target} failed; those show no match`)

    return { sourcePlaylistId: playlistId, target, candidates }
  } finally {
    deps.signal?.removeEventListener('abort', onAbort)
  }
}

function canCreate(p: MusicProvider): p is MusicProvider & PlaylistCreator {
  return typeof (p as Partial<PlaylistCreator>).createPlaylist === 'function'
}

export interface CreateDeps {
  getProvider: (service: ServiceProvider) => MusicProvider | undefined
  /** After the playlist exists: refresh the playlist list. */
  onCreated?: (playlistId: string) => void
}

export async function createTransfer(
  deps: CreateDeps,
  request: TransferRequest
): Promise<TransferResult> {
  if (!request || typeof request !== 'object') throw new Error('No transfer request given.')
  const { target, name, tracks } = request
  if (!isServiceProvider(target)) throw new Error(`Unknown music service: ${String(target)}`)
  const service = SERVICE_NAMES[target]
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) throw new Error('Give the new playlist a name.')
  if (trimmed.length > PLAYLIST_NAME_MAX)
    throw new Error(`Playlist names can be at most ${PLAYLIST_NAME_MAX} characters.`)
  if (!Array.isArray(tracks) || tracks.length === 0) throw new Error('No tracks to add.')
  if (tracks.length > TRANSFER_MAX_TRACKS)
    throw new Error(`A playlist can hold at most ${TRANSFER_MAX_TRACKS} tracks.`)
  for (const t of tracks) {
    if (
      !t ||
      typeof t !== 'object' ||
      t.provider !== target ||
      typeof t.nativeId !== 'string' ||
      t.id !== `${target}:${t.nativeId}`
    )
      throw new Error(`Every track must be a ${service} track (got ${String(t?.id)}).`)
  }
  const provider = deps.getProvider(target)
  if (!provider) throw new Error(notConnectedMessage(target))
  if (!canCreate(provider)) throw new Error(`${service} can't create playlists yet.`)
  const playlist = await provider.createPlaylist(trimmed, tracks)
  deps.onCreated?.(playlist.id)
  return { playlistId: playlist.id, added: tracks.length }
}
