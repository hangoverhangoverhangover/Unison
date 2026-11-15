import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../db'
import { nativeIdForPath } from './paths'
import { scanLibrary } from './scanner'
import { getLocalTracks } from './store'

/** Minimal PCM WAV: 8 kHz, mono, 8-bit, `seconds` long. */
function wav(seconds: number): Buffer {
  const rate = 8000
  const dataLen = rate * seconds
  const b = Buffer.alloc(44 + dataLen, 0x80)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + dataLen, 4)
  b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20) // PCM
  b.writeUInt16LE(1, 22) // channels
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate, 28) // byte rate
  b.writeUInt16LE(1, 32) // block align
  b.writeUInt16LE(8, 34) // bits per sample
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(dataLen, 40)
  return b
}

let dir: string
let music: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scan-'))
  music = join(dir, 'music')
  mkdirSync(join(music, 'sub'), { recursive: true })
  db = openDb(':memory:')
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const scan = (folders = [music]): Promise<boolean> =>
  scanLibrary({ db, folders, artworkDir: join(dir, 'artwork') })

describe('scanLibrary', () => {
  it('adds, skips unchanged, and removes deleted files', async () => {
    const file = join(music, 'sub', 'My Song.wav')
    writeFileSync(file, wav(2))
    writeFileSync(join(music, 'notes.txt'), 'ignored')

    expect(await scan()).toBe(true)
    const tracks = getLocalTracks(db)
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({
      id: `local:${nativeIdForPath(file)}`,
      provider: 'local',
      title: 'My Song',
      artists: [],
      durationMs: 2000,
      localPath: file
    })
    expect(tracks[0]!.artworkUrl).toBeUndefined()

    // Unchanged files are skipped on rescan.
    expect(await scan()).toBe(false)

    rmSync(file)
    expect(await scan()).toBe(true)
    expect(getLocalTracks(db)).toHaveLength(0)
  })

  it('drops rows for a folder that is no longer watched', async () => {
    writeFileSync(join(music, 'a.wav'), wav(1))
    await scan()
    expect(getLocalTracks(db)).toHaveLength(1)
    await scan([])
    expect(getLocalTracks(db)).toHaveLength(0)
  })

  it('logs and skips files that fail to parse', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(join(music, 'broken.mp3'), Buffer.from('not audio at all'))
    writeFileSync(join(music, 'ok.wav'), wav(1))
    await scan()
    expect(getLocalTracks(db).map((t) => t.title)).toContain('ok')
    warn.mockRestore()
  })
})
