// Circular waveform: the time-domain wave bent around a circle, one or more rings, each a
// little bigger, fainter and shifted, slowly turning.
import type { DrawArgs, VizRenderer } from '../types'

const POINTS = 180
const TAU = Math.PI * 2
// The last part of the loop eases back to the start so there's no step where it closes.
const SEAM = 0.08

export function createCircle(): VizRenderer {
  const xs = new Float32Array(POINTS)
  const ys = new Float32Array(POINTS)
  const vals = new Float32Array(POINTS)

  return {
    draw({ ctx, w, h, dpr, frame, settings, paint }: DrawArgs): void {
      const wave = frame.wave
      const len = wave.length
      const m = Math.min(w, h)
      const cx = w / 2
      const cy = h / 2
      const rings = Math.max(1, Math.min(4, Math.round(settings.circleRings)))
      const amp = m * 0.09
      const base = ctx.globalAlpha
      ctx.lineWidth = 2 * dpr
      ctx.lineJoin = 'round'

      for (let ring = 0; ring < rings; ring++) {
        const r = m * 0.28 * (1 + ring * 0.08) + frame.pulse * m * 0.03
        const rot = frame.time * 0.15 + ring * 0.45
        // Each ring reads the wave from a different place, so they don't overlap exactly.
        const offset = ring * 0.17

        for (let j = 0; j < POINTS; j++) {
          if (len === 0) {
            vals[j] = 0
            continue
          }
          const t = (j / POINTS + offset) % 1
          const k = Math.floor(t * len)
          // A 3-tap average takes the fizz out of the raw samples.
          vals[j] = (wave[(k + len - 1) % len]! + wave[k]! + wave[(k + 1) % len]!) / 3
        }
        const startAt = Math.floor(POINTS * (1 - SEAM))
        for (let j = startAt; j < POINTS; j++) {
          const s = (j - startAt) / (POINTS - startAt)
          vals[j] = vals[j]! * (1 - s) + vals[0]! * s
        }
        for (let j = 0; j < POINTS; j++) {
          const a = rot + (j / POINTS) * TAU
          const rr = r + vals[j]! * amp
          xs[j] = cx + Math.cos(a) * rr
          ys[j] = cy + Math.sin(a) * rr
        }

        // Curve through the midpoints between points: smooth and closes on itself.
        ctx.beginPath()
        ctx.moveTo((xs[POINTS - 1]! + xs[0]!) / 2, (ys[POINTS - 1]! + ys[0]!) / 2)
        for (let j = 0; j < POINTS; j++) {
          const n = (j + 1) % POINTS
          ctx.quadraticCurveTo(xs[j]!, ys[j]!, (xs[j]! + xs[n]!) / 2, (ys[j]! + ys[n]!) / 2)
        }
        ctx.closePath()
        const reach = r + amp
        ctx.strokeStyle = paint(cx - reach, cy - reach, cx + reach, cy + reach)
        ctx.globalAlpha = base * (1 - ring * 0.22)
        ctx.stroke()
      }
      ctx.globalAlpha = base
    }
  }
}
