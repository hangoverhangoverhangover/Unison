import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_PREFS } from '@shared/config'
import { DEFAULT_AUDIO, EQ_BANDS_HZ, type QueueItem } from '@shared/playback'
import { openDb, type Db } from '../db'
import {
  AUDIO_KEY,
  PREFS_KEY,
  SESSION_KEY,
  SESSION_MAX_QUEUE,
  loadSession,
  readAppPrefs,
  readAudio,
  saveSession,
  writeAppPrefs,
  writeAudio
} from './store'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
})
afterEach(() => db.close())

const NOW = Date.UTC(2026, 10, 12)
const setRaw = (key: string, value: string): void => {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}

const item = (n: number): QueueItem => ({
  uid: `u${n}`,
  track: {
    id: `soundcloud:${n}`,
    provider: 'soundcloud',
    nativeId: String(n),
    title: `T${n}`,
    artists: ['A'],
    durationMs: 1000
  }
})

const snapshot = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  current: item(0),
  queue: [item(1), item(2)],
  positionMs: 1500,
  volume: 0.5,
  muted: false,
  shuffle: true,
  repeat: 'all',
  savedAt: 'ignored',
  ...extra
})

describe('session', () => {
  it('loads null when nothing or corrupt data is stored', () => {
    expect(loadSession(db)).toBeNull()
    setRaw(SESSION_KEY, '{not json')
    expect(loadSession(db)).toBeNull()
    setRaw(SESSION_KEY, JSON.stringify({ ...snapshot(), volume: 7 }))
    expect(loadSession(db)).toBeNull()
  })

  it('round-trips and stamps savedAt', () => {
    saveSession(db, snapshot(), () => NOW)
    expect(loadSession(db)).toEqual({
      ...snapshot(),
      savedAt: new Date(NOW).toISOString()
    })
    saveSession(db, snapshot({ current: null, queue: [] }), () => NOW)
    expect(loadSession(db)?.current).toBeNull()
  })

  it('truncates long queues', () => {
    const queue = Array.from({ length: SESSION_MAX_QUEUE + 5 }, (_, i) => item(i + 1))
    saveSession(db, snapshot({ queue }))
    expect(loadSession(db)?.queue).toHaveLength(SESSION_MAX_QUEUE)
  })

  it('rejects bad shapes', () => {
    const bad = [
      null,
      snapshot({ current: { uid: 'x' } }),
      snapshot({ queue: 'nope' }),
      snapshot({ queue: [{ uid: 'u', track: { id: 'x' } }] }),
      snapshot({ positionMs: -1 }),
      snapshot({ volume: 1.1 }),
      snapshot({ volume: NaN }),
      snapshot({ muted: 'no' }),
      snapshot({ shuffle: 1 }),
      snapshot({ repeat: 'twice' })
    ]
    for (const s of bad) expect(() => saveSession(db, s)).toThrow()
    expect(loadSession(db)).toBeNull()
  })
})

describe('app prefs', () => {
  it('defaults, merges patches and validates', () => {
    expect(readAppPrefs(db)).toEqual(DEFAULT_APP_PREFS)
    expect(writeAppPrefs(db, { autoDownloadLikes: true, other: 1 })).toEqual({
      ...DEFAULT_APP_PREFS,
      autoDownloadLikes: true
    })
    expect(writeAppPrefs(db, { closeToTray: false })).toEqual({
      ...DEFAULT_APP_PREFS,
      closeToTray: false,
      autoDownloadLikes: true
    })
    expect(readAppPrefs(db)).toEqual({
      ...DEFAULT_APP_PREFS,
      closeToTray: false,
      autoDownloadLikes: true
    })
    expect(() => writeAppPrefs(db, { closeToTray: 'yes' })).toThrow()
    expect(() => writeAppPrefs(db, null)).toThrow()
  })

  it('reads corrupt data as defaults, field by field', () => {
    setRaw(PREFS_KEY, 'garbage')
    expect(readAppPrefs(db)).toEqual(DEFAULT_APP_PREFS)
    setRaw(PREFS_KEY, JSON.stringify({ closeToTray: false, autoDownloadLikes: 'x' }))
    expect(readAppPrefs(db)).toEqual({ ...DEFAULT_APP_PREFS, closeToTray: false })
    setRaw(PREFS_KEY, JSON.stringify({ jamRelayUrl: 'ftp://x', jamName: 5, jamUnplayable: 'skip' }))
    expect(readAppPrefs(db)).toEqual({ ...DEFAULT_APP_PREFS, jamUnplayable: 'skip' })
  })

  it('reads junk appearance prefs as defaults or clamped values', () => {
    setRaw(
      PREFS_KEY,
      JSON.stringify({
        theme: 'blue',
        zoom: 7,
        sidebarWidth: 150,
        rightPanelWidth: 'x',
        rightPanelTab: 'nope'
      })
    )
    expect(readAppPrefs(db)).toMatchObject({
      theme: 'artwork',
      zoom: 1.5,
      sidebarWidth: 72,
      rightPanelWidth: 320,
      rightPanelTab: 'queue'
    })
  })

  it('stores valid appearance prefs', () => {
    const prefs = writeAppPrefs(db, {
      theme: 'light',
      zoom: 1.2,
      sidebarWidth: 360,
      rightPanelWidth: 400,
      rightPanelTab: 'jam'
    })
    expect(prefs).toMatchObject({
      theme: 'light',
      zoom: 1.2,
      sidebarWidth: 360,
      rightPanelWidth: 400,
      rightPanelTab: 'jam'
    })
    expect(() => writeAppPrefs(db, { theme: 'blue' })).toThrow()
  })

  it('stores a custom theme, cleaning bad fields', () => {
    const prefs = writeAppPrefs(db, {
      theme: 'custom',
      customTheme: { accent: '#FF0088', blur: 999, font: 'nope' }
    })
    expect(prefs.theme).toBe('custom')
    expect(prefs.customTheme).toEqual({
      ...DEFAULT_APP_PREFS.customTheme,
      accent: '#ff0088',
      blur: 80
    })
    expect(readAppPrefs(db).customTheme.accent).toBe('#ff0088')
  })

  it('validates and cleans the Jam prefs', () => {
    expect(
      writeAppPrefs(db, {
        jamRelayUrl: ' https://jam.example.workers.dev/ ',
        jamName: '  Tri\u0007pp\n ',
        jamUnplayable: 'block'
      })
    ).toEqual({
      ...DEFAULT_APP_PREFS,
      jamRelayUrl: 'https://jam.example.workers.dev',
      jamName: 'Tripp',
      jamUnplayable: 'block'
    })
    expect(writeAppPrefs(db, { jamRelayUrl: 'http://localhost:8787//' }).jamRelayUrl).toBe(
      'http://localhost:8787'
    )
    expect(writeAppPrefs(db, { jamRelayUrl: 'http://127.0.0.1:8787/relay/' }).jamRelayUrl).toBe(
      'http://127.0.0.1:8787/relay'
    )
    expect(writeAppPrefs(db, { jamRelayUrl: '' }).jamRelayUrl).toBe('')
    expect(writeAppPrefs(db, { jamName: 'x'.repeat(60) }).jamName).toBe('x'.repeat(40))
    for (const bad of [
      'http://jam.example.com',
      'ws://localhost:1',
      'not a url',
      'https://user:pw@jam.example.com',
      'https://jam.example.com/?a=1',
      `https://jam.example.com/${'a'.repeat(300)}`,
      7
    ])
      expect(() => writeAppPrefs(db, { jamRelayUrl: bad })).toThrow()
    expect(() => writeAppPrefs(db, { jamName: null })).toThrow()
    expect(() => writeAppPrefs(db, { jamUnplayable: 'maybe' })).toThrow()
    // A failed write keeps what was stored.
    expect(readAppPrefs(db).jamUnplayable).toBe('block')
  })
})

describe('audio settings', () => {
  const good = {
    levelling: true,
    crossfadeMs: 4000,
    eq: { enabled: true, gains: EQ_BANDS_HZ.map((_, i) => i - 5) }
  }

  it('defaults and round-trips', () => {
    expect(readAudio(db)).toEqual(DEFAULT_AUDIO)
    expect(writeAudio(db, good)).toEqual(good)
    expect(readAudio(db)).toEqual(good)
  })

  it('rejects out-of-range values', () => {
    const bad = [
      null,
      { ...good, levelling: 1 },
      { ...good, crossfadeMs: 12_001 },
      { ...good, crossfadeMs: -1 },
      { ...good, crossfadeMs: 1.5 },
      { ...good, eq: { enabled: true, gains: [0, 0] } },
      { ...good, eq: { enabled: true, gains: EQ_BANDS_HZ.map(() => 13) } },
      { ...good, eq: { enabled: true, gains: EQ_BANDS_HZ.map(() => NaN) } },
      { ...good, eq: { enabled: 'on', gains: good.eq.gains } }
    ]
    for (const s of bad) expect(() => writeAudio(db, s)).toThrow()
  })

  it('reads corrupt data as defaults', () => {
    setRaw(AUDIO_KEY, '[')
    expect(readAudio(db)).toEqual(DEFAULT_AUDIO)
    setRaw(AUDIO_KEY, JSON.stringify({ ...good, crossfadeMs: 99_999 }))
    expect(readAudio(db)).toEqual(DEFAULT_AUDIO)
  })
})
