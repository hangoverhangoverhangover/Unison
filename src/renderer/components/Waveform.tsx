import * as Tooltip from '@radix-ui/react-tooltip'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TrackComment } from '@shared/provider'
import { playback } from '@renderer/playback/controller'
import { formatTime } from '@renderer/lib/format'
import { color } from '@renderer/styles/tokens'
import { bars, clusterMarkers } from '@renderer/lib/waveform'
import { useAppearance, useLightTheme } from '@renderer/state/appearance'

const BAR = 2
const GAP = 1
/** Comment markers closer than this (px) merge into one. */
const MARKER_GAP = 20

/**
 * SoundCloud-style waveform on a canvas, with timed comments as small markers on a
 * rail just above the bars (avatar and text on hover). When `live`, the played part follows playback in a rAF loop (no React
 * ticks) and clicks seek.
 */
export default function Waveform({
  samples,
  durationMs,
  comments,
  live,
  height = 64
}: {
  samples: number[]
  durationMs: number
  comments: TrackComment[]
  /** The waveform's track is the one playing. */
  live: boolean
  height?: number
}): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const peaks = useMemo(() => bars(samples, Math.floor(width / (BAR + GAP))), [samples, width])
  const light = useLightTheme()
  // CSS zoom scales the canvas on screen; draw at the zoomed size so bars stay sharp.
  const zoom = useAppearance((s) => s.zoom)

  // Draw, then redraw only when the number of played bars changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0) return
    const dpr = (window.devicePixelRatio || 1) * zoom
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    // Unplayed bars follow the theme (dark bars on Light glass).
    const rest = light ? 'rgba(20, 21, 26, 0.26)' : 'rgba(255, 255, 255, 0.3)'
    let lastPlayed = -1
    let raf = 0
    const draw = (played: number): void => {
      ctx.clearRect(0, 0, width, height)
      peaks.forEach((p, i) => {
        const h = Math.max(2, p * height)
        ctx.fillStyle = i < played ? color.accent : rest
        ctx.fillRect(i * (BAR + GAP), height - h, BAR, h)
      })
    }
    const frame = (): void => {
      const ratio = live && durationMs > 0 ? Math.min(1, playback.getPositionMs() / durationMs) : 0
      const played = Math.round(ratio * peaks.length)
      if (played !== lastPlayed) {
        lastPlayed = played
        draw(played)
      }
      if (live) raf = requestAnimationFrame(frame)
    }
    frame()
    return () => cancelAnimationFrame(raf)
  }, [peaks, width, height, live, durationMs, light, zoom])

  // Comments that would overlap merge into one marker.
  const markers = useMemo(
    () => clusterMarkers(comments, durationMs, width, MARKER_GAP),
    [comments, width, durationMs]
  )

  const seekTo = (clientX: number): void => {
    if (!live || durationMs <= 0) return
    const rect = canvasRef.current!.getBoundingClientRect()
    playback.seek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * durationMs)
  }

  return (
    <div ref={wrapRef} className="w-full">
      <Tooltip.Provider delayDuration={120} skipDelayDuration={0}>
        <div className="relative h-6" aria-label={`${comments.length} timed comments`}>
          {markers.map(({ x, items: list }) => (
            <Tooltip.Root key={`${x}:${list[0]!.id}`}>
              <Tooltip.Trigger asChild>
                <button
                  onClick={() => live && playback.seek(list[0]!.timestampMs)}
                  aria-label={`${list.length} ${list.length === 1 ? 'comment' : 'comments'} at ${formatTime(list[0]!.timestampMs)}`}
                  className="group absolute bottom-0 flex -translate-x-1/2 flex-col items-center focus-visible:z-10"
                  style={{ left: Math.min(width - 9, Math.max(9, x)) }}
                >
                  {/* The first commenter's picture; hover shows everyone at this moment. A
                      stacked edge hints that more than one person commented here. */}
                  <span
                    className={`relative block size-[18px] overflow-hidden rounded-full bg-raised ring-2 transition-transform duration-[140ms] group-hover:z-10 group-hover:scale-125 ${
                      list.length > 1 ? 'ring-text-subdued' : 'ring-black/30'
                    }`}
                  >
                    {list[0]!.author.avatarUrl ? (
                      <img
                        src={list[0]!.author.avatarUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center text-[9px] font-bold text-text-subdued">
                        {list[0]!.author.username.slice(0, 1).toUpperCase() || '?'}
                      </span>
                    )}
                  </span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="top"
                  sideOffset={6}
                  className="glass-strong z-50 max-w-72 rounded-xl px-3 py-2 text-sm"
                >
                  {list.slice(0, 3).map((c) => (
                    <p key={c.id} className="flex gap-2 py-1">
                      <span className="size-6 flex-none overflow-hidden rounded-full bg-raised">
                        {c.author.avatarUrl ? (
                          <img
                            src={c.author.avatarUrl}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="flex size-full items-center justify-center text-[10px] font-bold text-text-subdued">
                            {c.author.username.slice(0, 1).toUpperCase() || '?'}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="font-semibold">{c.author.username || 'Someone'}</span>{' '}
                        <span className="text-accent tabular-nums">
                          {formatTime(c.timestampMs)}
                        </span>
                        <span className="block text-text-subdued">{c.body}</span>
                      </span>
                    </p>
                  ))}
                  {list.length > 3 && (
                    <p className="pt-1 text-xs text-text-muted">and {list.length - 3} more</p>
                  )}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ))}
        </div>
      </Tooltip.Provider>
      <canvas
        ref={canvasRef}
        role={live ? 'slider' : 'img'}
        aria-label="Waveform"
        aria-valuemin={live ? 0 : undefined}
        aria-valuemax={live ? Math.round(durationMs / 1000) : undefined}
        onPointerDown={(e) => seekTo(e.clientX)}
        className={`mt-1 block w-full ${live ? 'cursor-pointer' : ''}`}
        style={{ height }}
      />
    </div>
  )
}
