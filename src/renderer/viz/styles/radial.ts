// Radial ring: bars pointing outward from a circle in the middle of the canvas. Placed
// "around the cover", the circle sits just outside the cover; the ring swells on beats.
import type { DrawArgs, VizRenderer } from '../types'

export function createRadial(): VizRenderer {
  return {
    draw({ ctx, w, h, dpr, frame, settings: s, paint }: DrawArgs): void {
      const n = frame.levels.length
      if (!n) return
      const cx = w / 2
      const cy = h / 2
      const size = Math.min(w, h)
      const r0 = size * 0.34 * (1 + frame.pulse * 0.06)
      const len = size * 0.15
      // Each bar is drawn twice (left and right halves mirror), so bass sits at the top.
      const spokes = n * 2
      const width = Math.max(1.5 * dpr, ((Math.PI * 2 * r0) / spokes) * 0.55)
      ctx.lineCap = 'round'
      ctx.lineWidth = width
      ctx.strokeStyle = paint(cx, cy - r0, cx, cy - r0 - len)
      const alpha = ctx.globalAlpha
      ctx.beginPath()
      for (let k = 0; k < spokes; k++) {
        const i = k < n ? k : spokes - 1 - k
        const a = -Math.PI / 2 + (k / spokes) * Math.PI * 2
        const l = Math.max(2 * dpr, frame.levels[i]! * len)
        const cos = Math.cos(a)
        const sin = Math.sin(a)
        ctx.moveTo(cx + cos * r0, cy + sin * r0)
        ctx.lineTo(cx + cos * (r0 + l), cy + sin * (r0 + l))
      }
      ctx.stroke()
      if (s.peaks) {
        ctx.fillStyle = paint(cx, cy - r0, cx, cy - r0 - len)
        ctx.globalAlpha = alpha * 0.9
        for (let k = 0; k < spokes; k++) {
          const i = k < n ? k : spokes - 1 - k
          const a = -Math.PI / 2 + (k / spokes) * Math.PI * 2
          const r = r0 + Math.max(2 * dpr, frame.peaks[i]! * len) + 4 * dpr
          ctx.beginPath()
          ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, width * 0.5, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = alpha
      }
    }
  }
}
