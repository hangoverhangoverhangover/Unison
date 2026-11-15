import { describe, expect, it } from 'vitest'
import { openDb } from '../db'
import {
  describeClientId,
  effectiveClientId,
  readClientIdOverride,
  writeClientId
} from './clientId'
import { TOKENS_KEY } from './tokens'

const A = 'a'.repeat(32)
const B = '0123456789abcdef0123456789ABCDEF'

function tokensStored(db: ReturnType<typeof openDb>): boolean {
  return !!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(TOKENS_KEY)
}

describe('Spotify Client ID setting', () => {
  it('falls back to the build ID and reports where it comes from', () => {
    const db = openDb(':memory:')
    expect(effectiveClientId(db, ` ${A} `)).toBe(A)
    expect(describeClientId(db, A, A)).toEqual({
      clientId: '',
      source: 'build',
      needsRestart: false
    })
    expect(describeClientId(db, '', '')).toEqual({
      clientId: '',
      source: 'none',
      needsRestart: false
    })
  })

  it('saves a valid ID, signs out, and asks for a restart', () => {
    const db = openDb(':memory:')
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(TOKENS_KEY, '"x"')
    const r = writeClientId(db, ` ${B} `, A, A)
    expect(r).toEqual({ clientId: B.toLowerCase(), source: 'settings', needsRestart: true })
    expect(readClientIdOverride(db)).toBe(B.toLowerCase())
    expect(tokensStored(db)).toBe(false)
  })

  it('keeps the login when the effective ID does not change, and clears back to the build ID', () => {
    const db = openDb(':memory:')
    writeClientId(db, A, '', '')
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(TOKENS_KEY, '"x"')
    writeClientId(db, A.toUpperCase(), '', A)
    expect(tokensStored(db)).toBe(true)
    const cleared = writeClientId(db, '', A, A)
    expect(cleared).toEqual({ clientId: '', source: 'build', needsRestart: false })
    expect(tokensStored(db)).toBe(true)
  })

  it('rejects anything that is not 32 hex characters', () => {
    const db = openDb(':memory:')
    expect(() => writeClientId(db, 'abc', A, A)).toThrow(/Client ID/)
    expect(() => writeClientId(db, 'g'.repeat(32), A, A)).toThrow(/Client ID/)
    expect(() => writeClientId(db, 42, A, A)).toThrow(/text/)
    expect(readClientIdOverride(db)).toBe('')
  })
})
