import { useEffect, useRef } from 'react'
import { playback } from '@renderer/playback/controller'
import { usePlayback } from '@renderer/state/player'
import { formatTime } from '@renderer/lib/format'

/**
 * Seek bar driven by requestAnimationFrame, never by React state ticks.
 * The fill is a scaleX transform; time labels are written straight to the DOM.
 */
export default function SeekBar({ showTimes = true }: { showTimes?: boolean }): React.JSX.Element {
  const durationMs = usePlayback((s) => s.durationMs)
  const hasTrack = usePlayback((s) => s.current !== null)
  const trackRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const dragRef = useRef<number | null>(null) // ms while dragging

  useEffect(() => {
    let raf = 0
    let lastText = ''
    const frame = (): void => {
      const pos = dragRef.current ?? playback.getPositionMs()
      const ratio = durationMs > 0 ? Math.min(1, Math.max(0, pos / durationMs)) : 0
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${ratio})`
      if (thumbRef.current && trackRef.current) {
        thumbRef.current.style.transform = `translateX(${ratio * trackRef.current.clientWidth}px)`
      }
      const text = formatTime(pos)
      if (text !== lastText && elapsedRef.current) {
        elapsedRef.current.textContent = text
        lastText = text
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [durationMs])

  const msAt = (clientX: number): number => {
    const rect = trackRef.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * durationMs
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!hasTrack || durationMs <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = msAt(e.clientX)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (dragRef.current !== null) dragRef.current = msAt(e.clientX)
  }
  const onPointerUp = (): void => {
    if (dragRef.current === null) return
    playback.seek(dragRef.current)
    dragRef.current = null
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!hasTrack) return
    const step = e.key === 'ArrowRight' ? 5000 : e.key === 'ArrowLeft' ? -5000 : 0
    if (step) {
      e.preventDefault()
      playback.seek(Math.max(0, Math.min(durationMs, playback.getPositionMs() + step)))
    }
  }

  return (
    <div className="flex w-full items-center gap-2 text-xs text-text-subdued tabular-nums">
      {showTimes && (
        <span ref={elapsedRef} className="w-10 text-right">
          0:00
        </span>
      )}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={hasTrack ? 0 : -1}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-disabled={!hasTrack}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="group relative flex h-4 flex-1 items-center"
      >
        <div className="relative h-1 w-full overflow-hidden rounded-full bg-progress-track">
          <div
            ref={fillRef}
            className="absolute inset-0 origin-left rounded-full bg-text group-hover:bg-accent"
            style={{ transform: 'scaleX(0)' }}
          />
        </div>
        <div
          ref={thumbRef}
          className="pointer-events-none absolute top-1/2 left-0 -mt-1.5 -ml-1.5 size-3 rounded-full bg-text opacity-0 shadow transition-opacity duration-[140ms] group-hover:opacity-100"
        />
      </div>
      {showTimes && <span className="w-10">{formatTime(durationMs)}</span>}
    </div>
  )
}
