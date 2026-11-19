// Saved session, app prefs and audio settings (QoL round 2), JSON values in the settings table.
import {
  DEFAULT_APP_PREFS,
  PANEL_TABS,
  THEMES,
  type AppPrefs,
  type PanelTab,
  type Theme
} from '@shared/config'
import { clampRightPanelWidth, clampSidebarWidth, clampZoom } from '@shared/layout'
import { JAM_LIMITS, type JamUnplayable } from '@shared/jam'
import {
  DEFAULT_AUDIO,
  EQ_BANDS_HZ,
  type AudioSettings,
  type QueueItem,
  type RepeatMode,
  type SessionSnapshot
} from '@shared/playback'
import { validateCustomTheme } from '@shared/theme'
import type { Track } from '@shared/types'
import type { Db } from '../db'

export const SESSION_KEY = 'playback.session'
export const PREFS_KEY = 'app.prefs'
export const AUDIO_KEY = 'audio.settings'

/** Queue entries kept in a saved session; the rest are dropped. */
export const SESSION_MAX_QUEUE = 2000
export const CROSSFADE_MAX_MS = 12_000
export const EQ_GAIN_MAX_DB = 12

const PROVIDERS = new Set<unknown>(['spotify', 'soundcloud', 'local'])
const REPEAT = new Set<unknown>(['off', 'all', 'one'])

function readJson(db: Db, key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key) as
    string | undefined
  if (row === undefined) return undefined
  try {
    return JSON.parse(row) as unknown
  } catch {
    return undefined
  }
}

function writeJson(db: Db, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify(value))
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

function isTrack(t: unknown): t is Track {
  if (!isObject(t)) return false
  return (
    typeof t.id === 'string' &&
    PROVIDERS.has(t.provider) &&
    typeof t.nativeId === 'string' &&
    t.nativeId !== '' &&
    t.id === `${String(t.provider)}:${t.nativeId}` &&
    typeof t.title === 'string' &&
    Array.isArray(t.artists) &&
    t.artists.every((a) => typeof a === 'string') &&
    typeof t.durationMs === 'number' &&
    Number.isFinite(t.durationMs)
  )
}

function isQueueItem(v: unknown): v is QueueItem {
  return isObject(v) && typeof v.uid === 'string' && v.uid !== '' && isTrack(v.track)
}

// ---------------------------------------------------------------------------------------
// Session

/**
 * Checks a snapshot; throws on a bad shape. Keeps the first SESSION_MAX_QUEUE queue items.
 * `savedAt` is set to `now` (the renderer's value is ignored).
 */
export function validateSession(snapshot: unknown, now: () => number = Date.now): SessionSnapshot {
  if (!isObject(snapshot)) throw new Error('Not a valid session.')
  const s = snapshot
  if (s.current !== null && !isQueueItem(s.current))
    throw new Error('Session current track is not valid.')
  if (!Array.isArray(s.queue)) throw new Error('Session queue must be a list.')
  const queue = s.queue.slice(0, SESSION_MAX_QUEUE)
  if (!queue.every(isQueueItem)) throw new Error('Session queue has an invalid entry.')
  if (typeof s.positionMs !== 'number' || !Number.isFinite(s.positionMs) || s.positionMs < 0)
    throw new Error('Session position must be 0 or more.')
  if (typeof s.volume !== 'number' || !Number.isFinite(s.volume) || s.volume < 0 || s.volume > 1)
    throw new Error('Session volume must be between 0 and 1.')
  if (typeof s.muted !== 'boolean') throw new Error('Session muted must be true or false.')
  if (typeof s.shuffle !== 'boolean') throw new Error('Session shuffle must be true or false.')
  if (!REPEAT.has(s.repeat)) throw new Error("Session repeat must be 'off', 'all' or 'one'.")
  return {
    current: s.current,
    queue,
    positionMs: s.positionMs,
    volume: s.volume,
    muted: s.muted,
    shuffle: s.shuffle,
    repeat: s.repeat as RepeatMode,
    savedAt: new Date(now()).toISOString()
  }
}

export function saveSession(db: Db, snapshot: unknown, now: () => number = Date.now): void {
  writeJson(db, SESSION_KEY, validateSession(snapshot, now))
}

/** The stored session, or null when there is none or it is corrupt. */
export function loadSession(db: Db): SessionSnapshot | null {
  const raw = readJson(db, SESSION_KEY)
  if (!isObject(raw)) return null
  try {
    const savedAt = typeof raw.savedAt === 'string' ? raw.savedAt : ''
    const valid = validateSession(raw)
    return { ...valid, savedAt: savedAt || valid.savedAt }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------
// App prefs

const PREF_KEYS = Object.keys(DEFAULT_APP_PREFS) as (keyof AppPrefs)[]

export const JAM_RELAY_URL_MAX = 300
const UNPLAYABLE = new Set<unknown>(['match', 'skip', 'block'])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

/**
 * '' (Jam off), an https:// URL, or http://localhost / http://127.0.0.1 (any port) for
 * local testing. No credentials, query or fragment. Trailing slashes are stripped.
 */
export function normalizeRelayUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Jam relay URL must be text.')
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (trimmed.length > JAM_RELAY_URL_MAX)
    throw new Error(`Jam relay URL must be at most ${JAM_RELAY_URL_MAX} characters.`)
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Jam relay URL is not a valid URL.')
  }
  const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !local)
    throw new Error('Jam relay URL must start with https:// (http:// only for localhost).')
  if (url.username || url.password) throw new Error('Jam relay URL must not contain a login.')
  if (url.search || url.hash) throw new Error('Jam relay URL must not have a ? or # part.')
  return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '')
}

/** Control characters stripped, trimmed, at most JAM_LIMITS.nameLength characters. */
export function normalizeJamName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Jam name must be text.')
  const chars = [...value.replace(CONTROL_CHARS, '').trim()]
  return chars.slice(0, JAM_LIMITS.nameLength).join('').trim()
}

function checkNumber(key: string, clean: (n: number) => number): (v: unknown) => number {
  return (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v))
      throw new Error(`Setting ${key} must be a number.`)
    return clean(v)
  }
}

function checkOneOf<T>(key: string, allowed: readonly T[]): (v: unknown) => T {
  return (v) => {
    if (!allowed.includes(v as T))
      throw new Error(`Setting ${key} must be one of ${allowed.join(', ')}.`)
    return v as T
  }
}

function checkBoolean(key: string): (v: unknown) => boolean {
  return (v) => {
    if (typeof v !== 'boolean') throw new Error(`Setting ${key} must be true or false.`)
    return v
  }
}

/** Per-key validators: return the clean value or throw a readable error. */
const VALIDATORS: { [K in keyof AppPrefs]: (v: unknown) => AppPrefs[K] } = {
  closeToTray: checkBoolean('closeToTray'),
  autoDownloadLikes: checkBoolean('autoDownloadLikes'),
  jamRelayUrl: normalizeRelayUrl,
  jamName: normalizeJamName,
  jamUnplayable: (v) => {
    if (!UNPLAYABLE.has(v))
      throw new Error("Setting jamUnplayable must be 'match', 'skip' or 'block'.")
    return v as JamUnplayable
  },
  theme: checkOneOf<Theme>('theme', THEMES),
  customTheme: validateCustomTheme,
  zoom: checkNumber('zoom', clampZoom),
  sidebarWidth: checkNumber('sidebarWidth', clampSidebarWidth),
  rightPanelWidth: checkNumber('rightPanelWidth', clampRightPanelWidth),
  rightPanelTab: checkOneOf<PanelTab>('rightPanelTab', PANEL_TABS)
}

function setPref<K extends keyof AppPrefs>(prefs: AppPrefs, key: K, raw: unknown): void {
  prefs[key] = VALIDATORS[key](raw)
}

/** Stored prefs over the defaults; invalid stored fields fall back to the default. */
export function readAppPrefs(db: Db): AppPrefs {
  const raw = readJson(db, PREFS_KEY)
  const prefs: AppPrefs = { ...DEFAULT_APP_PREFS }
  if (isObject(raw)) {
    for (const key of PREF_KEYS) {
      if (!(key in raw)) continue
      try {
        setPref(prefs, key, raw[key])
      } catch {
        // keep the default
      }
    }
  }
  return prefs
}

/** Applies a partial update (known keys are validated; unknown keys are ignored). */
export function writeAppPrefs(db: Db, patch: unknown): AppPrefs {
  if (!isObject(patch)) throw new Error('Settings update must be an object.')
  const next = readAppPrefs(db)
  for (const key of PREF_KEYS) {
    if (!(key in patch) || patch[key] === undefined) continue
    setPref(next, key, patch[key])
  }
  writeJson(db, PREFS_KEY, next)
  return next
}

// ---------------------------------------------------------------------------------------
// Audio

export const defaultAudio = (): AudioSettings => ({
  levelling: DEFAULT_AUDIO.levelling,
  crossfadeMs: DEFAULT_AUDIO.crossfadeMs,
  eq: { enabled: DEFAULT_AUDIO.eq.enabled, gains: [...DEFAULT_AUDIO.eq.gains] }
})

/** Checks audio settings; throws on anything out of range. Returns a clean copy. */
export function validateAudio(settings: unknown): AudioSettings {
  if (!isObject(settings)) throw new Error('Not valid audio settings.')
  const s = settings
  if (typeof s.levelling !== 'boolean') throw new Error('Levelling must be true or false.')
  if (
    typeof s.crossfadeMs !== 'number' ||
    !Number.isInteger(s.crossfadeMs) ||
    s.crossfadeMs < 0 ||
    s.crossfadeMs > CROSSFADE_MAX_MS
  )
    throw new Error(`Crossfade must be a whole number of ms from 0 to ${CROSSFADE_MAX_MS}.`)
  if (!isObject(s.eq)) throw new Error('EQ settings are missing.')
  if (typeof s.eq.enabled !== 'boolean') throw new Error('EQ enabled must be true or false.')
  const gains = s.eq.gains
  if (!Array.isArray(gains) || gains.length !== EQ_BANDS_HZ.length)
    throw new Error(`EQ needs ${EQ_BANDS_HZ.length} band gains.`)
  for (const g of gains as unknown[]) {
    if (typeof g !== 'number' || !Number.isFinite(g) || Math.abs(g) > EQ_GAIN_MAX_DB)
      throw new Error(`EQ gains must be between -${EQ_GAIN_MAX_DB} and ${EQ_GAIN_MAX_DB} dB.`)
  }
  return {
    levelling: s.levelling,
    crossfadeMs: s.crossfadeMs,
    eq: { enabled: s.eq.enabled, gains: [...(gains as number[])] }
  }
}

/** Stored audio settings, or the defaults when missing or corrupt. */
export function readAudio(db: Db): AudioSettings {
  try {
    return validateAudio(readJson(db, AUDIO_KEY))
  } catch {
    return defaultAudio()
  }
}

export function writeAudio(db: Db, settings: unknown): AudioSettings {
  const clean = validateAudio(settings)
  writeJson(db, AUDIO_KEY, clean)
  return clean
}
