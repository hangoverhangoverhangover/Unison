// One visualizer canvas on the Player page. Draws the chosen style from the shared loop's
// frames: 2D styles on a 2D canvas (with trails and glow done here), shader mode on its
// own WebGL canvas (a canvas can't switch context types, so it remounts).
import { useEffect, useRef, useState } from 'react'
import { usePlayback } from '@renderer/state/player'
import { usePlayerPage, type VizSettings, type VizStyle } from '@renderer/state/playerPage'
import { useAppearance } from '@renderer/state/appearance'
import { artColors, shiftHue } from '@renderer/lib/artColor'
import { onVizFrame } from './loop'
import { createShaderRenderer } from './shader'
import { createBars } from './styles/bars'
import { createCircle } from './styles/circle'
import { createParticles } from './styles/particles'
import { createRadial } from './styles/radial'
import { createSpectrogram } from './styles/spectrogram'
import type { VizColors, VizRenderer } from './types'

function rendererFor(style: Exclude<VizStyle, 'shader'>): VizRenderer {
  switch (style) {
    case 'radial':
      return createRadial()
    case 'particles':
      return createParticles()
    case 'circle':
      return createCircle()
    case 'spectrogram':
      return createSpectrogram()
    default:
      return createBars(style)
  }
}

function accent(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--color-accent')
  return v.trim() || '#7289da'
}

/**
 * The colours: the theme's (the cover's two main colours in the artwork theme, else the
 * accent and a neighbour of it), white, or your own two.
 */
function useVizColors(viz: VizSettings): VizColors {
  const artTheme = useAppearance((s) => s.theme === 'artwork')
  const themeKey = useAppearance((s) => s.theme)
  const cover = usePlayback((s) => s.current?.track.artworkUrl)
  const [art, setArt] = useState<[string | null, string | null]>([null, null])
  useEffect(() => {
    if (!artTheme) return
    let live = true
    void artColors(cover).then((c) => {
      if (live) setArt(c)
    })
    return () => {
      live = false
      setArt([null, null])
    }
  }, [artTheme, cover])
  if (viz.color === 'white') return { main: '#ffffff', second: '#9aa4ff' }
  if (viz.color === 'custom') return { main: viz.customColor, second: viz.customColor2 }
  void themeKey
  const main = (artTheme && art[0]) || accent()
  const second = (artTheme && art[1]) || shiftHue(main, 50)
  return { main, second }
}

function Canvas2D({ viz, colors }: { viz: VizSettings; colors: VizColors }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ viz, colors })
  useEffect(() => {
    live.current = { viz, colors }
  }, [viz, colors])
  const style = viz.style as Exclude<VizStyle, 'shader'>
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const renderer = rendererFor(style)
    const off = onVizFrame((frame) => {
      const { viz: s, colors: c } = live.current
      const dpr = devicePixelRatio
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (!w || !h) return
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      ctx.save()
      if (s.trails > 0) {
        // Fade what's there instead of clearing: moving shapes leave trails.
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = `rgba(0,0,0,${(1 - s.trails).toFixed(3)})`
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'source-over'
      } else ctx.clearRect(0, 0, w, h)
      ctx.globalAlpha = s.opacity
      if (s.glow > 0) {
        ctx.shadowBlur = s.glow * 24 * dpr
        ctx.shadowColor = c.main
      }
      renderer.draw({
        ctx,
        w,
        h,
        dpr,
        frame,
        settings: s,
        colors: c,
        paint: (x0, y0, x1, y1) => {
          if (!s.gradient) return c.main
          const g = ctx.createLinearGradient(x0, y0, x1, y1)
          g.addColorStop(0, c.main)
          g.addColorStop(1, c.second)
          return g
        }
      })
      ctx.restore()
    })
    return () => {
      off()
      renderer.dispose?.()
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [style])
  return <canvas ref={ref} aria-hidden className="size-full" />
}

function CanvasShader({ viz, colors }: { viz: VizSettings; colors: VizColors }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ viz, colors })
  useEffect(() => {
    live.current = { viz, colors }
  }, [viz, colors])
  const cover = usePlayback((s) => s.current?.track.artworkUrl ?? null)
  const shader = useRef<ReturnType<typeof createShaderRenderer>>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const r = createShaderRenderer(canvas)
    shader.current = r
    if (!r) return
    const off = onVizFrame((frame) => {
      const dpr = Math.min(devicePixelRatio, 1.5)
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (!w || !h) return
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      r.draw(frame, live.current.viz, live.current.colors, w, h)
    })
    return () => {
      off()
      r.dispose()
      shader.current = null
    }
  }, [])
  useEffect(() => {
    shader.current?.setCover(cover)
  }, [cover])
  return <canvas ref={ref} aria-hidden className="size-full" />
}

/** The visualizer, filling its box. */
export default function VizCanvas({
  className,
  style
}: {
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  const viz = usePlayerPage((s) => s.viz)
  const colors = useVizColors(viz)
  return (
    <div aria-hidden className={`pointer-events-none ${className ?? ''}`} style={style}>
      {viz.style === 'shader' ? (
        <CanvasShader viz={viz} colors={colors} />
      ) : (
        <Canvas2D viz={viz} colors={colors} />
      )}
    </div>
  )
}
