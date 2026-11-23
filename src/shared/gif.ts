// How long one play of an animated GIF lasts, from its frame delays. Browsers show
// delays under 20 ms as 100 ms; so does this.

/** Milliseconds for one loop, or null when it isn't a GIF or has no frames. */
export function gifDurationMs(bytes: Uint8Array): number | null {
  const b = bytes
  if (b.length < 13 || String.fromCharCode(b[0]!, b[1]!, b[2]!) !== 'GIF') return null
  let i = 13
  const flags = b[10]!
  if (flags & 0x80) i += 3 * (1 << ((flags & 0x07) + 1))
  let total = 0
  let frames = 0
  let delay = 0
  const skipBlocks = (): boolean => {
    while (i < b.length) {
      const size = b[i++]!
      if (size === 0) return true
      i += size
    }
    return false
  }
  while (i < b.length) {
    const tag = b[i++]
    if (tag === 0x3b) break // trailer
    if (tag === 0x21) {
      const label = b[i++]
      if (label === 0xf9 && b[i] === 4) {
        delay = (b[i + 2]! | (b[i + 3]! << 8)) * 10
        i += 6 // size, 4 bytes, terminator
      } else if (!skipBlocks()) break
    } else if (tag === 0x2c) {
      if (i + 9 > b.length) break
      const f = b[i + 8]!
      i += 9
      if (f & 0x80) i += 3 * (1 << ((f & 0x07) + 1))
      i++ // LZW minimum code size
      if (!skipBlocks()) break
      total += delay < 20 ? 100 : delay
      frames++
      delay = 0
    } else break
  }
  return frames > 0 ? total : null
}
