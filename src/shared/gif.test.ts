import { describe, expect, it } from 'vitest'
import { gifDurationMs } from './gif'

/** A GIF with these frame delays (1/100 s), 1x1, no colour tables. */
function gif(delays: number[]): Uint8Array {
  const out = [...'GIF89a'].map((c) => c.charCodeAt(0))
  out.push(1, 0, 1, 0, 0, 0, 0) // screen 1x1, no global table
  for (const d of delays) {
    out.push(0x21, 0xf9, 4, 0, d & 0xff, d >> 8, 0, 0) // graphic control
    out.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0) // image descriptor
    out.push(2, 2, 0x4c, 0x01, 0) // LZW size, one data block, end
  }
  out.push(0x3b)
  return new Uint8Array(out)
}

describe('gifDurationMs', () => {
  it('adds up the frame delays', () => {
    expect(gifDurationMs(gif([5, 5, 10]))).toBe(200)
  })
  it('treats tiny delays as 100 ms, like browsers', () => {
    expect(gifDurationMs(gif([0, 1]))).toBe(200)
  })
  it('is null for other files', () => {
    expect(gifDurationMs(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull()
    expect(gifDurationMs(new Uint8Array(0))).toBeNull()
  })
})
