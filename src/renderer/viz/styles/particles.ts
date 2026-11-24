// Particles: a soft glow in the middle with dots thrown outward. Loud parts throw more and
// faster, beats throw a burst. Particles live in flat typed arrays so a frame allocates nothing.
import type { DrawArgs, VizRenderer } from '../types'

// The settings slider tops out at 400; the arrays are sized once for that.
const CAP = 400
const TAU = Math.PI * 2

export function createParticles(): VizRenderer {
  const x = new Float32Array(CAP)
  const y = new Float32Array(CAP)
  const vx = new Float32Array(CAP)
  const vy = new Float32Array(CAP)
  const life = new Float32Array(CAP)
  const maxLife = new Float32Array(CAP)
  const size = new Float32Array(CAP)
  const tone = new Float32Array(CAP)
  let alive = 0
  // Fractional particles owed from earlier frames, so low rates still emit.
  let owed = 0

  const spawn = (cx: number, cy: number, r: number, speed: number, dpr: number): void => {
    const i = alive++
    const a = Math.random() * TAU
    const s = speed * (0.5 + Math.random())
    x[i] = cx + Math.cos(a) * r
    y[i] = cy + Math.sin(a) * r
    vx[i] = Math.cos(a) * s
    vy[i] = Math.sin(a) * s
    maxLife[i] = 1 + Math.random() * 1.5
    life[i] = maxLife[i]
    size[i] = (1 + Math.random() * 2) * dpr
    tone[i] = Math.random()
  }

  // Swap the last particle into the dead one's slot: order doesn't matter here.
  const kill = (i: number): void => {
    const j = --alive
    x[i] = x[j]!
    y[i] = y[j]!
    vx[i] = vx[j]!
    vy[i] = vy[j]!
    life[i] = life[j]!
    maxLife[i] = maxLife[j]!
    size[i] = size[j]!
    tone[i] = tone[j]!
  }

  return {
    draw({ ctx, w, h, dpr, frame, settings, colors }: DrawArgs): void {
      const limit = Math.max(0, Math.min(CAP, Math.floor(settings.particleCount)))
      const m = Math.min(w, h)
      const cx = w / 2
      const cy = h / 2
      const core = m * 0.06 * (1 + frame.pulse * 0.3 + frame.bass * 0.2)
      const dt = frame.dt
      const base = ctx.globalAlpha

      // The setting may have been lowered: drop the extras.
      while (alive > limit) kill(alive - 1)

      // Move and age; dead ones are swapped out, so re-check the same slot.
      for (let i = 0; i < alive;) {
        life[i] = life[i]! - dt
        if (life[i]! <= 0) {
          kill(i)
          continue
        }
        x[i] = x[i]! + vx[i]! * dt
        y[i] = y[i]! + vy[i]! * dt
        i++
      }

      if (frame.playing) {
        // Speed in px/s, relative to the canvas so it looks the same at any size.
        const speed = m * 0.25 * settings.particleSpeed * (0.4 + frame.energy * 1.2)
        owed += frame.energy * limit * 0.9 * dt
        if (frame.beat) owed += limit * 0.15
        while (owed >= 1 && alive < limit) {
          spawn(cx, cy, core, speed, dpr)
          owed -= 1
        }
        // Don't bank a huge backlog while full.
        if (alive >= limit) owed = 0
      } else {
        owed = 0
      }

      // No disc in the middle: the dots alone (a disc covered the page when full screen).
      for (let i = 0; i < alive; i++) {
        const fade = life[i]! / maxLife[i]!
        if (settings.gradient) {
          ctx.fillStyle = tone[i]! < 0.5 ? colors.main : colors.second
          ctx.globalAlpha = base * fade
        } else {
          ctx.fillStyle = colors.main
          ctx.globalAlpha = base * fade * (0.45 + tone[i]! * 0.55)
        }
        ctx.beginPath()
        ctx.arc(x[i]!, y[i]!, size[i]!, 0, TAU)
        ctx.fill()
      }
      ctx.globalAlpha = base
    },
    dispose(): void {
      alive = 0
      owed = 0
    }
  }
}
