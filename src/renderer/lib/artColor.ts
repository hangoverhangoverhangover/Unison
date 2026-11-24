// The main colour of a cover, for things that should match the artwork theme (the
// Player page's level bars). Vivid pixels win over greys; the result is lifted so it
// reads on a dark background.

/** `#rrggbb` from RGBA pixel data, or null when the picture is all grey or empty. */
export function pickColor(data: Uint8ClampedArray | number[]): string | null {
  return pickColors(data)[0]
}

/**
 * The cover's two main colours (for gradients): the heaviest hue, and the heaviest one
 * at least two buckets (60 degrees) away from it. Either can be null.
 */
export function pickColors(data: Uint8ClampedArray | number[]): [string | null, string | null] {
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
  const order = buckets.map((_, i) => i).sort((a, b) => buckets[b]!.w - buckets[a]!.w)
  const first = order[0]!
  const far = (i: number): boolean => {
    const d = Math.abs(i - first) % 12
    return Math.min(d, 12 - d) >= 2
  }
  const second = order.find((i) => far(i) && buckets[i]!.w > 0)
  const color = (i: number | undefined): string | null => {
    const bk = i === undefined ? undefined : buckets[i]
    if (!bk || bk.w <= 0) return null
    let [r, g, b] = [bk.r / bk.w, bk.g / bk.w, bk.b / bk.w]
    // Lift dark colours so bars stay visible on the dark Player page.
    const max = Math.max(r, g, b)
    if (max < 200) {
      const k = 200 / Math.max(1, max)
      ;[r, g, b] = [r * k, g * k, b * k]
    }
    return toHex(r, g, b)
  }
  return [color(first), color(second)]
}

function toHex(r: number, g: number, b: number): string {
  const hex = (n: number): string =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** `#rrggbb` turned around the colour wheel by `deg` degrees (for a second colour). */
export function shiftHue(color: string, deg: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return color
  const v = parseInt(m[1]!, 16)
  const [r, g, b] = [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return toHex(r * 255, g * 255, b * 255)
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + deg + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const o = l - c / 2
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return toHex((r1 + o) * 255, (g1 + o) * 255, (b1 + o) * 255)
}

type Pair = [string | null, string | null]
const cache = new Map<string, Promise<Pair>>()

/**
 * The cover's main colour, or null when it can't be read (no CORS on the image, or a
 * grey cover). Cached per URL.
 */
export function artColor(url: string | undefined): Promise<string | null> {
  return artColors(url).then((p) => p[0])
}

/** The cover's two main colours (see pickColors); nulls when unreadable. Cached per URL. */
export function artColors(url: string | undefined): Promise<Pair> {
  if (!url) return Promise.resolve([null, null])
  const hit = cache.get(url)
  if (hit) return hit
  const p = new Promise<Pair>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 32
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve([null, null])
        ctx.drawImage(img, 0, 0, 32, 32)
        resolve(pickColors(ctx.getImageData(0, 0, 32, 32).data))
      } catch {
        // A picture without CORS taints the canvas: no colour.
        resolve([null, null])
      }
    }
    img.onerror = () => resolve([null, null])
    img.src = url
  })
  cache.set(url, p)
  if (cache.size > 100) cache.delete(cache.keys().next().value!)
  return p
}
