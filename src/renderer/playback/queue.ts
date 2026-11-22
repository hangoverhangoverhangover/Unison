// Pure queue logic for the playback controller. No DOM, no side effects: every
// operation takes a QueueState and returns a new one. The controller owns the
// current state and decides what to do with the backend.

import type { QueueItem, RepeatMode } from '@shared/playback'
import type { Track } from '@shared/types'

export interface QueueState {
  current: QueueItem | null
  /** Upcoming items in play order (shuffle already applied). */
  upcoming: QueueItem[]
  /** Items already played, oldest first. `previous()` pops from the end. */
  history: QueueItem[]
  shuffle: boolean
  /**
   * Unshuffled order of every entry in the context (uids), captured when shuffle
   * is turned on and extended by `addToQueue` while shuffled. Used to restore the
   * original relative order when shuffle is turned off. Empty while unshuffled.
   */
  order: string[]
  /** uids queued with `playNext` while shuffled; they stay at the front on shuffle off. */
  pinned: string[]
}

export interface QueueDeps {
  /** Returns a float in [0, 1). Defaults to Math.random. */
  rng?: () => number
  /** Returns a unique id per call. Defaults to crypto.randomUUID. */
  uid?: () => string
}

export const emptyQueue: QueueState = {
  current: null,
  upcoming: [],
  history: [],
  shuffle: false,
  order: [],
  pinned: []
}

function makeUid(deps?: QueueDeps): () => string {
  return deps?.uid ?? (() => crypto.randomUUID())
}

function toItems(tracks: Track[], deps?: QueueDeps): QueueItem[] {
  const uid = makeUid(deps)
  return tracks.map((track) => ({ uid: uid(), track }))
}

/** Fisher-Yates. Returns a new array. */
export function shuffleItems<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i] as T
    out[i] = out[j] as T
    out[j] = tmp
  }
  return out
}

/** Every entry in the context: history, current, upcoming. */
export function contextSize(state: QueueState): number {
  return state.history.length + (state.current ? 1 : 0) + state.upcoming.length
}

/**
 * Replace the context with a whole list, starting at tracks[startIndex]. The songs
 * above the start stay part of it (as earlier songs), like Spotify:
 * - shuffle off: history = the songs above, upcoming = the songs below. Previous
 *   reaches the songs above, and repeat 'all' wraps to the top of the list.
 * - shuffle on: the start song plays first, then every other song in the list,
 *   above and below, shuffled.
 */
export function playTracks(
  state: QueueState,
  tracks: Track[],
  startIndex: number,
  deps?: QueueDeps
): QueueState {
  if (tracks.length === 0) return { ...emptyQueue, shuffle: state.shuffle }
  const start = Math.min(Math.max(0, Math.floor(startIndex) || 0), tracks.length - 1)
  const items = toItems(tracks, deps)
  const current = items[start] as QueueItem
  const before = items.slice(0, start)
  const after = items.slice(start + 1)
  if (!state.shuffle) {
    return { ...emptyQueue, history: before, current, upcoming: after }
  }
  return {
    ...emptyQueue,
    shuffle: true,
    current,
    upcoming: shuffleItems([...before, ...after], deps?.rng),
    order: items.map((i) => i.uid)
  }
}

/** Insert at the front of upcoming, in the given order. */
export function playNext(state: QueueState, tracks: Track[], deps?: QueueDeps): QueueState {
  if (tracks.length === 0) return state
  const items = toItems(tracks, deps)
  const upcoming = [...items, ...state.upcoming]
  if (!state.shuffle) return { ...state, upcoming }
  const uids = items.map((i) => i.uid)
  return {
    ...state,
    upcoming,
    order: [...state.order, ...uids],
    pinned: [...uids, ...state.pinned]
  }
}

/** Append to the end of upcoming. */
export function addToQueue(state: QueueState, tracks: Track[], deps?: QueueDeps): QueueState {
  if (tracks.length === 0) return state
  const items = toItems(tracks, deps)
  const upcoming = [...state.upcoming, ...items]
  if (!state.shuffle) return { ...state, upcoming }
  return { ...state, upcoming, order: [...state.order, ...items.map((i) => i.uid)] }
}

/** Move an upcoming item from index `from` to index `to`. Out-of-range indexes are a no-op. */
export function move(state: QueueState, from: number, to: number): QueueState {
  const n = state.upcoming.length
  if (!Number.isInteger(from) || !Number.isInteger(to)) return state
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return state
  const upcoming = state.upcoming.slice()
  const [item] = upcoming.splice(from, 1) as [QueueItem]
  upcoming.splice(to, 0, item)
  return { ...state, upcoming }
}

/** Remove an upcoming item by uid. The current item can't be removed this way. */
export function remove(state: QueueState, uid: string): QueueState {
  if (!state.upcoming.some((i) => i.uid === uid)) return state
  return {
    ...state,
    upcoming: state.upcoming.filter((i) => i.uid !== uid),
    order: state.order.filter((u) => u !== uid),
    pinned: state.pinned.filter((u) => u !== uid)
  }
}

/** Change a track's details (say, a fixed title) everywhere it sits in the queue. */
export function updateTrack(state: QueueState, trackId: string, patch: Partial<Track>): QueueState {
  const fix = (i: QueueItem): QueueItem =>
    i.track.id === trackId ? { ...i, track: { ...i.track, ...patch } } : i
  return {
    ...state,
    current: state.current && fix(state.current),
    upcoming: state.upcoming.map(fix),
    history: state.history.map(fix)
  }
}

/** Empty upcoming only. Current and history stay. */
export function clear(state: QueueState): QueueState {
  const keep = new Set(state.history.map((i) => i.uid))
  if (state.current) keep.add(state.current.uid)
  return { ...state, upcoming: [], order: state.order.filter((u) => keep.has(u)), pinned: [] }
}

/**
 * Advance. Returns null when there is nothing to advance to (upcoming empty and
 * repeat is not 'all'); the caller then stops on the current item.
 *
 * Repeat 'one' is NOT handled here: the controller replays on natural end only,
 * and a user pressing next always advances (so 'one' behaves like 'off' here).
 *
 * With repeat 'all' and an empty upcoming, wraps to the start of the full play
 * order (history + current, in the order actually played). If shuffle is on, the
 * wrapped context is reshuffled.
 */
export function next(state: QueueState, repeat: RepeatMode, deps?: QueueDeps): QueueState | null {
  if (!state.current) {
    // Nothing playing yet: start the first upcoming item, if any.
    const [first, ...rest] = state.upcoming
    if (!first) return null
    return { ...state, current: first, upcoming: rest, pinned: dropPin(state.pinned, first.uid) }
  }
  const [first, ...rest] = state.upcoming
  if (first) {
    return {
      ...state,
      history: [...state.history, state.current],
      current: first,
      upcoming: rest,
      pinned: dropPin(state.pinned, first.uid)
    }
  }
  if (repeat !== 'all') return null
  let full = [...state.history, state.current]
  if (state.shuffle) full = shuffleItems(full, deps?.rng)
  const [head, ...tail] = full as [QueueItem, ...QueueItem[]]
  return { ...state, history: [], current: head, upcoming: tail, pinned: [] }
}

/**
 * Step back: pops history, pushing the current item back to the front of upcoming.
 * Returns null when history is empty (the caller restarts the current track).
 * The restart-vs-previous decision (position > 3s) belongs to the controller.
 */
export function previous(state: QueueState): QueueState | null {
  const prev = state.history[state.history.length - 1]
  if (!prev) return null
  return {
    ...state,
    history: state.history.slice(0, -1),
    current: prev,
    upcoming: state.current ? [state.current, ...state.upcoming] : state.upcoming
  }
}

/**
 * Shuffle on: Fisher-Yates every song except the current one (earlier songs too),
 * remembering the list order. Shuffle off: list order around the current song (see
 * below). Items queued with playNext while shuffled stay at the front; items added
 * with addToQueue while shuffled keep their appended position.
 */
export function setShuffle(state: QueueState, on: boolean, deps?: QueueDeps): QueueState {
  if (on === state.shuffle) return state
  if (on) {
    const order = [
      ...state.history.map((i) => i.uid),
      ...(state.current ? [state.current.uid] : []),
      ...state.upcoming.map((i) => i.uid)
    ]
    // The whole list except the current song: earlier songs are mixed in too.
    return {
      ...state,
      shuffle: true,
      history: [],
      upcoming: shuffleItems([...state.history, ...state.upcoming], deps?.rng),
      order,
      pinned: []
    }
  }
  // Shuffle off: back to list order around the current song. Songs after it play
  // next; songs before it become earlier songs (Previous, and the wrap with repeat
  // 'all'). Play next items stay at the front; items with no known place go last.
  const pinnedSet = new Set(state.pinned)
  const rank = new Map(state.order.map((uid, i) => [uid, i]))
  const front = state.upcoming.filter((i) => pinnedSet.has(i.uid))
  const pool = [...state.history, ...state.upcoming].filter((i) => !pinnedSet.has(i.uid))
  const known = pool
    .filter((i) => rank.has(i.uid))
    .sort((a, b) => rank.get(a.uid)! - rank.get(b.uid)!)
  const unknown = pool.filter((i) => !rank.has(i.uid))
  const at = state.current ? rank.get(state.current.uid) : undefined
  if (at === undefined) {
    return {
      ...state,
      shuffle: false,
      upcoming: [...front, ...known, ...unknown],
      history: [],
      order: [],
      pinned: []
    }
  }
  return {
    ...state,
    shuffle: false,
    history: known.filter((i) => rank.get(i.uid)! < at),
    upcoming: [...front, ...known.filter((i) => rank.get(i.uid)! > at), ...unknown],
    order: [],
    pinned: []
  }
}

function dropPin(pinned: string[], uid: string): string[] {
  return pinned.includes(uid) ? pinned.filter((u) => u !== uid) : pinned
}
