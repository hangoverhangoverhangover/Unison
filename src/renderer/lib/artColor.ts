// The main colour of a cover, for things that should match the artwork theme (the
// Player page's level bars). Vivid pixels win over greys; the result is lifted so it
// reads on a dark background.

/** `#rrggbb` from RGBA pixel data, or null when the picture is all grey or empty. */
export function pickColor(data: Uint8ClampedArray | number[]): string | null {
  // 12 hue buckets, weighted by saturation and brightness; the heaviest one wins.
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i]!
    const g = data[i + 1]!
    const b = data[i + 2]!
    const a = data[i + 3]!
    if (a < 128) continue
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const v = max / 255
    const s = max === 0 ? 0 : (max - min) / max
    if (s < 0.25 || v < 0.2) continue
    let h: number
    if (max === min) h = 0
    else if (max === r) h = ((g - b) / (max - min) + 6) % 6
    else if (max === g) h = (b - r) / (max - min) + 2
    else h = (r - g) / (max - min) + 4
    const bucket = buckets[Math.floor((h / 6) * 12) % 12]!
    const w = s * s * v
    bucket.w += w
    bucket.r += r * w
    bucket.g += g * w
    bucket.b += b * w
  }
  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a))
  if (best.w <= 0) return null
  let [r, g, b] = [best.r / best.w, best.g / best.w, best.b / best.w]
  // Lift dark colours so bars stay visible on the dark Player page.
  const max = Math.max(r, g, b)
  if (max < 200) {
    const k = 200 / Math.max(1, max)
    ;[r, g, b] = [r * k, g * k, b * k]
  }
  const hex = (n: number): string =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

const cache = new Map<string, Promise<string | null>>()

/**
 * The cover's main colour, or null when it can't be read (no CORS on the image, or a
 * grey cover). Cached per URL.
 */
export function artColor(url: string | undefined): Promise<string | null> {
  if (!url) return Promise.resolve(null)
  const hit = cache.get(url)
  if (hit) return hit
  const p = new Promise<string | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 32
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, 32, 32)
        resolve(pickColor(ctx.getImageData(0, 0, 32, 32).data))
      } catch {
        // A picture without CORS taints the canvas: no colour.
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
  cache.set(url, p)
  if (cache.size > 100) cache.delete(cache.keys().next().value!)
  return p
}
