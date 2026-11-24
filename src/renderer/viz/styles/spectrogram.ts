// Spectrogram: a heatmap scrolling right to left, low notes at the bottom. History lives in
// our own offscreen canvas so the host's clears and trail fades never erase it.
import type { DrawArgs, VizColors, VizRenderer } from '../types'

type BufferCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface SpectroBuffer {
  canvas: HTMLCanvasElement | OffscreenCanvas
  ctx: BufferCtx
}

/** Makes the offscreen canvas. Injectable so tests can run without a DOM. */
export type SpectroBufferFactory = (w: number, h: number) => SpectroBuffer | null

const MAX_ROWS = 200

const defaultFactory: SpectroBufferFactory = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    return ctx ? { canvas, ctx } : null
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    return ctx ? { canvas, ctx } : null
  }
  return null
}

/** '#rgb', '#rrggbb' or 'rgb(a)(...)' to [r, g, b]; white when unreadable. */
export function parseColor(c: string): [number, number, number] {
  const s = c.trim()
  if (s[0] === '#') {
    const hex = s.length === 4 ? s.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : s
    const n = parseInt(hex.slice(1, 7), 16)
    if (hex.length >= 7 && !Number.isNaN(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return [255, 255, 255]
}

/** 256 RGBA entries: clear at 0, through the dark tone, to main, to near white at 1. */
function buildLut(lut: Uint8ClampedArray, colors: VizColors, gradient: boolean): void {
  const main = parseColor(colors.main)
  const dark: [number, number, number] = gradient
    ? parseColor(colors.second)
    : [main[0] * 0.4, main[1] * 0.4, main[2] * 0.4]
  const white: [number, number, number] = [255, 255, 255]
  for (let i = 0; i < 256; i++) {
    const v = i / 255
    let r: number, g: number, b: number
    if (v < 0.4) {
      ;[r, g, b] = dark
    } else if (v < 0.8) {
      const t = (v - 0.4) / 0.4
      r = dark[0] + (main[0] - dark[0]) * t
      g = dark[1] + (main[1] - dark[1]) * t
      b = dark[2] + (main[2] - dark[2]) * t
    } else {
      const t = ((v - 0.8) / 0.2) * 0.85
      r = main[0] + (white[0] - main[0]) * t
      g = main[1] + (white[1] - main[1]) * t
      b = main[2] + (white[2] - main[2]) * t
    }
    const o = i * 4
    lut[o] = r
    lut[o + 1] = g
    lut[o + 2] = b
    // Quiet cells fade to nothing so the background shows through.
    lut[o + 3] = Math.min(1, v * 2.5) * 255
  }
}

export function createSpectrogram(makeBuffer: SpectroBufferFactory = defaultFactory): VizRenderer {
  let buf: SpectroBuffer | null = null
  let bw = 0
  let bh = 0
  let column: ImageData | null = null
  const lut = new Uint8ClampedArray(256 * 4)
  let lutKey = ''
  // Row (0 = bottom) to its bin range, rebuilt when the row or bin count changes.
  let rowLo = new Int32Array(0)
  let rowHi = new Int32Array(0)
  let mapRows = 0
  let mapBins = 0
  const rowLevel = new Float32Array(MAX_ROWS)

  const resize = (w: number, h: number): void => {
    const next = makeBuffer(w, h)
    // Keep the history, stretched to the new size, instead of starting blank.
    if (next && buf && bw > 0 && bh > 0) {
      next.ctx.drawImage(buf.canvas, 0, 0, bw, bh, 0, 0, w, h)
    }
    buf = next
    bw = w
    bh = h
    column = null
  }

  const buildMap = (rows: number, n: number): void => {
    rowLo = new Int32Array(rows)
    rowHi = new Int32Array(rows)
    // Mostly logarithmic so bass gets room, with a little linear so the lowest rows
    // don't all repeat bin 0.
    const at = (f: number): number => (((Math.pow(n, f) - 1) / (n - 1)) * 0.85 + f * 0.15) * n
    for (let r = 0; r < rows; r++) {
      const lo = Math.min(n - 1, Math.floor(at(r / rows)))
      rowLo[r] = lo
      rowHi[r] = Math.max(lo + 1, Math.min(n, Math.floor(at((r + 1) / rows))))
    }
    mapRows = rows
    mapBins = n
  }

  return {
    draw({ ctx, w, h, dpr, frame, settings, colors }: DrawArgs): void {
      w = Math.floor(w)
      h = Math.floor(h)
      if (w <= 0 || h <= 0) return
      if (!buf || w !== bw || h !== bh) resize(w, h)
      if (!buf) return
      const b = buf.ctx

      const key = `${colors.main}|${colors.second}|${settings.gradient}`
      if (key !== lutKey) {
        buildLut(lut, colors, settings.gradient)
        lutKey = key
      }

      const shift = Math.max(1, Math.min(w, Math.round(settings.spectrogramSpeed * dpr)))
      if (frame.playing) {
        // 'copy' moves the image left and clears the strip it leaves behind.
        b.globalCompositeOperation = 'copy'
        b.drawImage(buf.canvas, shift, 0, w - shift, h, 0, 0, w - shift, h)
        b.globalCompositeOperation = 'source-over'

        const bins = frame.bins
        const n = bins.length
        const rows = Math.max(1, Math.min(MAX_ROWS, Math.floor(h / (2 * dpr))))
        if (n > 0 && (rows !== mapRows || n !== mapBins)) buildMap(rows, n)
        for (let r = 0; r < rows; r++) {
          let v = 0
          if (n > 0) for (let k = rowLo[r]!; k < rowHi[r]!; k++) if (bins[k]! > v) v = bins[k]!
          rowLevel[r] = v
        }

        if (!column || column.width !== shift || column.height !== h) {
          column = b.createImageData(shift, h)
        }
        const data = column.data
        for (let py = 0; py < h; py++) {
          const r = rows - 1 - Math.floor((py * rows) / h)
          const o = Math.round(Math.max(0, Math.min(1, rowLevel[r]!)) * 255) * 4
          let p = py * shift * 4
          for (let px = 0; px < shift; px++, p += 4) {
            data[p] = lut[o]!
            data[p + 1] = lut[o + 1]!
            data[p + 2] = lut[o + 2]!
            data[p + 3] = lut[o + 3]!
          }
        }
        b.putImageData(column, w - shift, 0)
      }

      // No glow on the copy: blurring the whole history every frame is costly and muddy.
      ctx.save()
      ctx.shadowBlur = 0
      ctx.drawImage(buf.canvas, 0, 0)
      ctx.restore()
    },
    dispose(): void {
      buf = null
      column = null
      bw = 0
      bh = 0
    }
  }
}
