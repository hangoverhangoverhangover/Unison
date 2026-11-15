import { createHash } from 'crypto'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { addFolderTo, isUnder, nativeIdForPath, normalizePath, removeFolderFrom } from './paths'

const win = process.platform === 'win32'
const root = resolve('/music')
const sub = resolve('/music/rock')
const other = resolve('/musical')

describe('normalizePath / nativeIdForPath', () => {
  it('resolves and lowercases only on win32', () => {
    expect(normalizePath(resolve('/A/B.mp3'), 'win32')).toBe(resolve('/A/B.mp3').toLowerCase())
    expect(normalizePath(resolve('/A/x/../B.mp3'), 'linux')).toBe(resolve('/A/B.mp3'))
  })

  it('is sha1 hex of the normalized path, case-insensitive on win32', () => {
    const p = resolve('/Music/Song.MP3')
    const expected = createHash('sha1').update(p.toLowerCase()).digest('hex')
    expect(nativeIdForPath(p, 'win32')).toBe(expected)
    expect(nativeIdForPath(p.toLowerCase(), 'win32')).toBe(expected)
    expect(nativeIdForPath(p, 'win32')).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('folder list', () => {
  it('treats sibling prefixes as unrelated', () => {
    expect(isUnder(sub, root)).toBe(true)
    expect(isUnder(root, root)).toBe(true)
    expect(isUnder(other, root)).toBe(false)
  })

  it('ignores duplicates and nested folders', () => {
    expect(addFolderTo([root], root)).toEqual([root])
    expect(addFolderTo([root], sub)).toEqual([root])
    expect(addFolderTo([root], other)).toEqual([root, other])
  })

  it('replaces nested folders with a new parent', () => {
    expect(addFolderTo([sub, other], root)).toEqual([other, root])
  })

  it.runIf(win)('compares case-insensitively on Windows', () => {
    expect(addFolderTo([root], root.toUpperCase())).toEqual([root])
    expect(removeFolderFrom([root, other], root.toUpperCase())).toEqual([other])
  })

  it('removes a folder', () => {
    expect(removeFolderFrom([root, other], root)).toEqual([other])
  })
})
