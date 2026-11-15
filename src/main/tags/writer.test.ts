import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { describe, expect, it } from 'vitest'
import type { ChildLike, SpawnFn } from '../downloads/process'
import { normalizeEdit } from './args'
import { ffmpegError, replaceFile, writeTags, type ReplaceFs } from './writer'

/** In-memory files: path -> contents. `failRename(from, to)` returns an errno code to throw. */
function fakeFs(
  files: Record<string, string>,
  failRename: (from: string, to: string) => string | undefined = () => undefined
): ReplaceFs & { files: Record<string, string>; calls: string[] } {
  const calls: string[] = []
  return {
    files,
    calls,
    async rename(from, to) {
      calls.push(`rename ${from} -> ${to}`)
      const code = failRename(from, to)
      if (code) throw Object.assign(new Error(code), { code })
      if (!(from in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      files[to] = files[from]!
      delete files[from]
    },
    async rm(path) {
      calls.push(`rm ${path}`)
      delete files[path]
    }
  }
}

const noSleep = async (): Promise<void> => undefined
const opts = (fs: ReplaceFs): Parameters<typeof replaceFile>[2] => ({
  fs,
  sleep: noSleep
})

describe('replaceFile', () => {
  it('renames the temp file over the original in one step', async () => {
    const fs = fakeFs({ a: 'old', t: 'new' })
    await replaceFile('t', 'a', opts(fs))
    expect(fs.files).toEqual({ a: 'new' })
    expect(fs.calls).toEqual(['rename t -> a'])
  })

  it('retries while the file is busy', async () => {
    let n = 0
    const fs = fakeFs({ a: 'old', t: 'new' }, () => (n++ < 2 ? 'EBUSY' : undefined))
    await replaceFile('t', 'a', opts(fs))
    expect(fs.files).toEqual({ a: 'new' })
  })

  it('gives up after the retries: drops the temp file, never moves the original', async () => {
    const fs = fakeFs({ a: 'old', t: 'new' }, () => 'EPERM')
    await expect(replaceFile('t', 'a', opts(fs))).rejects.toThrow(
      'The file is in use by another program. Close it and try again.'
    )
    expect(fs.files).toEqual({ a: 'old' })
    expect(fs.calls).toEqual([...Array(4).fill('rename t -> a'), 'rm t'])
  })

  it('does not retry other errors, and still keeps the original', async () => {
    const fs = fakeFs({ a: 'old', t: 'new' }, () => 'EXDEV')
    await expect(replaceFile('t', 'a', opts(fs))).rejects.toThrow(/Couldn't replace the file/)
    expect(fs.files).toEqual({ a: 'old' })
    expect(fs.calls).toEqual(['rename t -> a', 'rm t'])
  })
})

function fakeSpawn(code: number, stderr = ''): SpawnFn & { calls: string[][] } {
  const calls: string[][] = []
  const fn = ((command: string, args: readonly string[]) => {
    calls.push([command, ...args])
    const child = new EventEmitter() as EventEmitter & ChildLike
    const stdout = new PassThrough()
    const err = new PassThrough()
    Object.assign(child, { stdout, stderr: err, kill: () => true })
    setImmediate(() => {
      err.end(stderr)
      stdout.end()
      child.emit('close', code)
    })
    return child
  }) as unknown as SpawnFn & { calls: string[][] }
  fn.calls = calls
  return fn
}

describe('writeTags', () => {
  const edit = normalizeEdit({ title: 'x' })

  it('runs ffmpeg into a temp file and replaces the original', async () => {
    const fs = fakeFs({ 'C:/m/a.mp3': 'old', 'C:/m/a.mp3.r.tagtmp': 'new' })
    const spawn = fakeSpawn(0)
    await writeTags('C:/m/a.mp3', edit, {
      ffmpegPath: 'ff.exe',
      spawn,
      fs,
      sleep: noSleep,
      random: () => 'r'
    })
    expect(spawn.calls[0]![0]).toBe('ff.exe')
    expect(spawn.calls[0]!.at(-1)).toBe('C:/m/a.mp3.r.tagtmp')
    expect(fs.files).toEqual({ 'C:/m/a.mp3': 'new' })
  })

  it('removes the temp file and keeps the original when ffmpeg fails', async () => {
    const fs = fakeFs({ 'a.opus': 'old', 'a.opus.r.tagtmp': 'partial' })
    const spawn = fakeSpawn(1, '[opus @ 0x1] Unsupported codec id in stream 1\n')
    await expect(
      writeTags('a.opus', edit, { ffmpegPath: 'ff', spawn, fs, sleep: noSleep, random: () => 'r' })
    ).rejects.toThrow(/cover art/)
    expect(fs.files).toEqual({ 'a.opus': 'old' })
  })
})

describe('ffmpegError', () => {
  it('uses the last stderr line', () => {
    expect(ffmpegError('a\nError opening output\n', 1)).toBe('ffmpeg failed: Error opening output')
    expect(ffmpegError('', 3)).toBe('ffmpeg failed (exit 3)')
  })
})
