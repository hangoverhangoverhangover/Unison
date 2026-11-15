import { Maximize2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { bindAppearance } from '@renderer/state/appearance'
import type { MiniCommand, MiniState } from '@shared/match'
import { formatTime } from '@renderer/lib/format'
import { effect } from '@renderer/styles/tokens'
import SourceBadge from '@renderer/components/SourceBadge'

const send = (c: MiniCommand): void => void window.api.invoke('mini:command', c)

/** Live position: the published snapshot plus time elapsed while playing. */
function livePosition(s: MiniState, now: number): number {
  const p = s.status === 'playing' ? s.positionMs + (now - s.at) : s.positionMs
  return s.durationMs > 0 ? Math.min(Math.max(0, p), s.durationMs) : Math.max(0, p)
}

function Progress({ state }: { state: MiniState }): React.JSX.Element {
  const fillRef = useRef<HTMLSpanElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  // rAF writes straight to the DOM: no React render per frame.
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const pos = livePosition(state, Date.now())
      const frac = state.durationMs > 0 ? pos / state.durationMs : 0
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${frac})`
      if (timeRef.current) timeRef.current.textContent = formatTime(pos)
      if (state.status === 'playing') raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [state])

  const seek = (e: React.MouseEvent<HTMLButtonElement>): void => {
    if (state.durationMs <= 0) return
    const box = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    send({ type: 'seek', positionMs: Math.round(frac * state.durationMs) })
  }

  return (
    <>
      <span className="pointer-events-none absolute right-3 bottom-2.5 text-[11px] text-text-subdued tabular-nums">
        <span ref={timeRef}>0:00</span> / {formatTime(state.durationMs)}
      </span>
      <button
        aria-label="Seek"
        onClick={seek}
        className="no-drag group absolute inset-x-0 bottom-0 h-2 cursor-pointer"
      >
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-progress-track transition-[height] duration-[140ms] group-hover:h-[5px]">
          <span
            ref={fillRef}
            className="absolute inset-0 origin-left bg-accent"
            style={{ transform: 'scaleX(0)' }}
          />
        </span>
      </button>
    </>
  )
}

function WindowButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="no-drag flex size-6 items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:bg-raised-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  )
}

/** The mini player window: artwork, title, controls and progress. Drag it anywhere. */
export default function MiniApp(): React.JSX.Element {
  useEffect(() => bindAppearance(), [])
  const [state, setState] = useState<MiniState | null>(null)

  useEffect(() => {
    void window.api.invoke('mini:getState').then((s) => s && setState(s))
    return window.api.on('mini:state', setState)
  }, [])

  const track = state?.track ?? null
  const playing = state?.status === 'playing' || state?.status === 'loading'
  const art = track?.artworkUrl

  return (
    <div className="drag relative h-screen select-none overflow-hidden bg-base text-text">
      {art && (
        <img
          src={art}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full scale-150 object-cover opacity-60"
          style={{ filter: `blur(${effect.heroBlur / 2}px) saturate(1.3)` }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-base/70 to-base/90" />

      <div className="relative flex h-full items-center gap-3 py-3 pr-3 pl-3">
        <div className="size-[80px] flex-none overflow-hidden rounded-md bg-raised shadow-[0_6px_18px_rgba(0,0,0,0.4)]">
          {art && <img src={art} alt="" className="size-full object-cover" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-between self-stretch pb-2">
          <div className="min-w-0 pr-14">
            <p className="truncate text-md font-bold">{track?.title ?? 'Nothing playing'}</p>
            <p className="flex items-center gap-1.5 text-sm text-text-subdued">
              {track && <SourceBadge provider={track.provider} />}
              <span className="truncate">
                {track
                  ? track.artists.join(', ') || 'Unknown artist'
                  : 'Play something in the main window'}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              aria-label="Previous"
              disabled={!track}
              onClick={() => send({ type: 'previous' })}
              className="no-drag flex size-8 items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:text-text disabled:opacity-40"
            >
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              aria-label={playing ? 'Pause' : 'Play'}
              disabled={!track}
              onClick={() => send({ type: 'toggle' })}
              className="no-drag flex size-9 items-center justify-center rounded-full bg-text text-base transition-transform duration-[140ms] hover:scale-105 active:scale-95 disabled:opacity-40"
            >
              {playing ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} fill="currentColor" className="translate-x-px" />
              )}
            </button>
            <button
              aria-label="Next"
              disabled={!track || !state?.hasNext}
              onClick={() => send({ type: 'next' })}
              className="no-drag flex size-8 items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:text-text disabled:opacity-40"
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
          </div>
        </div>
        <div className="absolute top-2 right-2 flex gap-1">
          <WindowButton
            label="Open main window"
            onClick={() => void window.api.invoke('mini:showMain')}
          >
            <Maximize2 size={13} />
          </WindowButton>
          <WindowButton
            label="Close mini player"
            onClick={() => void window.api.invoke('mini:toggle')}
          >
            <X size={14} />
          </WindowButton>
        </div>
      </div>
      {state && track && <Progress state={state} />}
    </div>
  )
}
