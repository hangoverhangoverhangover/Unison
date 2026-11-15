import { describe, expect, it } from 'vitest'
import { findFollowSecret, FOLLOW_SECRET_FALLBACK, signFollow } from './followSignature'

// Expected values from an independent re-implementation of the web client's `sign`.
const ELECTRON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) combined-player/0.1.0 Chrome/140.0.7339.41 Electron/45.0.0 Safari/537.36'

describe('signFollow', () => {
  it('matches the web client for known inputs', () => {
    const cid = 'a'.repeat(32)
    expect(signFollow('9', '12345', cid, FOLLOW_SECRET_FALLBACK, ELECTRON_UA)).toBe('1:8a604c')
    expect(signFollow('9', '12345', cid, FOLLOW_SECRET_FALLBACK, 'ab/ü c')).toBe('1:7de3db')
    // Non-ASCII UA token: hashed as UTF-8 bytes.
    expect(signFollow('9', '12345', cid, FOLLOW_SECRET_FALLBACK, 'x/ü')).toBe('1:bef2d9')
  })

  it('depends on every input', () => {
    const base = signFollow('9', '1', 'c'.repeat(32), 's', ELECTRON_UA)
    expect(signFollow('8', '1', 'c'.repeat(32), 's', ELECTRON_UA)).not.toBe(base)
    expect(signFollow('9', '2', 'c'.repeat(32), 's', ELECTRON_UA)).not.toBe(base)
    expect(signFollow('9', '1', 'd'.repeat(32), 's', ELECTRON_UA)).not.toBe(base)
    expect(signFollow('9', '1', 'c'.repeat(32), 't', ELECTRON_UA)).not.toBe(base)
  })
})

describe('findFollowSecret', () => {
  it('reads the secret from a bundle', () => {
    const js =
      'Object.defineProperty(t,"__esModule",{value:!0}),t.__FOLLOWS_SIGNATURE_SECRET__=void 0,t.__FOLLOWS_SIGNATURE_SECRET__="5Dpr3ubBw8LFtbvQcd4Hx6hU"},'
    expect(findFollowSecret(js)).toBe('5Dpr3ubBw8LFtbvQcd4Hx6hU')
    expect(findFollowSecret('nothing here')).toBeUndefined()
  })
})
