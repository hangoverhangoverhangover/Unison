// The classic styles: bars, mirrored bars and a filled wave, with optional peak caps.
import type { VizStyle } from '@renderer/state/playerPage'
import type { DrawArgs, VizRenderer } from '../types'

export function createBars(style: Extract<VizStyle, 'bars' | 'mirror' | 'wave'>): VizRenderer {
  return {
    draw({ ctx, w, h, dpr, frame, settings: s, paint }: DrawArgs): void {
      const n = frame.levels.length
      if (!n) return
      const min = 2 * dpr
      const alpha = ctx.globalAlpha
      if (style === 'wave') {
        const xAt = (i: number): number => (i / (n - 1)) * w
        const yAt = (i: number): number => h - Math.max(min, frame.levels[i]! * (h - min))
        ctx.beginPath()
        ctx.moveTo(0, h)
        ctx.lineTo(0, yAt(0))
        for (let i = 1; i < n; i++) {
          const ax = xAt(i - 1)
          const ay = yAt(i - 1)
          ctx.quadraticCurveTo(ax, ay, (ax + xAt(i)) / 2, (ay + yAt(i)) / 2)
        }
        ctx.lineTo(w, yAt(n - 1))
        ctx.lineTo(w, h)
        ctx.closePath()
        const fill = paint(0, h, 0, 0)
        ctx.fillStyle = fill
        ctx.strokeStyle = fill
        ctx.globalAlpha = alpha * 0.25
        ctx.fill()
        ctx.globalAlpha = alpha
        ctx.lineWidth = 2 * dpr
        ctx.stroke()
        if (s.peaks) {
          ctx.fillStyle = fill
          for (let i = 0; i < n; i++) {
            const y = h - Math.max(min, frame.peaks[i]! * (h - min))
            ctx.fillRect(xAt(i) - dpr, y - 3 * dpr, 2 * dpr, 2 * dpr)
          }
        }
        return
      }

      const bw = w / n
      const capH = Math.max(2, 2 * dpr)
      const gap = Math.max(capH, 3 * dpr)
      for (let i = 0; i < n; i++) {
        const lv = frame.levels[i]!
        const bh = Math.max(min, lv * (h - (s.peaks ? gap + capH : 0)))
        const y = style === 'mirror' ? (h - bh) / 2 : h - bh
        const x = i * bw + bw * 0.15
        ctx.globalAlpha = alpha * (0.55 + lv * 0.45)
        ctx.fillStyle = style === 'mirror' ? paint(0, h / 2, 0, 0) : paint(0, h, 0, 0)
        ctx.fillRect(x, y, bw * 0.7, bh)
        if (s.peaks) {
          const pk = Math.max(frame.peaks[i]!, lv)
          const ph = Math.max(min, pk * (h - gap - capH))
          ctx.globalAlpha = alpha
          ctx.fillStyle = paint(0, h, 0, 0)
          if (style === 'mirror') {
            ctx.fillRect(x, (h - ph) / 2 - gap - capH / 2, bw * 0.7, capH)
            ctx.fillRect(x, (h + ph) / 2 + gap - capH / 2, bw * 0.7, capH)
          } else ctx.fillRect(x, h - ph - gap - capH, bw * 0.7, capH)
        }
      }
      ctx.globalAlpha = alpha
    }
  }
}
