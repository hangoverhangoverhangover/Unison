import { Maximize2, MicVocal, PanelTop, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { DEFAULT_MINI_PARTS, type MiniLayout, type MiniParts } from '@shared/config'
import { useEffect, useRef, useState } from 'react'
import { bindAppearance } from '@renderer/state/appearance'
import type { MiniCommand, MiniState } from '@shared/match'
import { activeLine, type LyricLine } from '@shared/lyrics'
import { formatTime } from '@renderer/lib/format'
import { effect } from '@renderer/styles/tokens'
import SourceBadge from '@renderer/components/SourceBadge'

const send = (c: MiniCommand): void => void window.api.invoke('mini:command', c)

/** Live position: the published snapshot plus time elapsed while playing. */
function livePosition(s: MiniState, now: number): number {
  const p = s.status === 'playing' ? s.positionMs + (now - s.at) : s.positionMs
  return s.durationMs > 0 ? Math.min(Math.max(0, p), s.durationMs) : Math.max(0, p)
}

function Progress({ state, bare }: { state: MiniState; bare?: boolean }): React.JSX.Element {
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
      {/* The lyric bar has no room for the times; just the line. */}
      <span
        className={`pointer-events-none absolute right-3 bottom-2.5 text-[11px] text-text-subdued tabular-nums ${bare ? 'hidden' : ''}`}
      >
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

/** The synced lyric line playing now and the next one (null: no synced lyrics, or between lines). */
function useMiniLyric(state: MiniState | null): { now: string | null; next: string | null } {
  // Lyrics are kept with the id of the song they belong to, so a new song shows none
  // until its own arrive.
  const [loaded, setLoaded] = useState<{ id: string; lines: LyricLine[] | null } | null>(null)
  const [text, setText] = useState<{ now: string | null; next: string | null }>(NO_LINE)
  const track = state?.track ?? null
  const id = track?.id ?? null
  useEffect(() => {
    if (!track) return
    let live = true
    window.api
      .invoke('lyrics:get', track)
      .then((r) => live && setLoaded({ id: track.id, lines: r.synced }))
      .catch(() => {})
    return () => {
      live = false
    }
    // Only refetch when the song changes, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  const lines = loaded && loaded.id === id ? loaded.lines : null
  useEffect(() => {
    if (!state || !lines?.length) return
    let raf = 0
    const tick = (): void => {
      const i = activeLine(lines, livePosition(state, Date.now()))
      const now = i >= 0 ? lines[i]!.text || null : null
      const next = lines[i + 1]?.text || null
      setText((t) => (t.now === now && t.next === next ? t : { now, next }))
      if (state.status === 'playing') raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state, lines])
  return lines?.length ? text : NO_LINE
}

const NO_LINE = { now: null, next: null }

/** The mini player's layout and parts (Settings → General → Mini player). */
function useMiniPrefs(): { layout: MiniLayout; parts: MiniParts } {
  const [prefs, setPrefs] = useState<{ layout: MiniLayout; parts: MiniParts }>({
    layout: 'player',
    parts: DEFAULT_MINI_PARTS
  })
  useEffect(() => {
    const take = (p: { miniLayout: MiniLayout; miniParts: MiniParts }): void =>
      setPrefs({ layout: p.miniLayout, parts: p.miniParts })
    void window.api.invoke('prefs:get').then(take)
    return window.api.on('prefs:changed', take)
  }, [])
  return prefs
}

function Controls({
  state,
  playing,
  small
}: {
  state: MiniState | null
  playing: boolean
  small?: boolean
}): React.JSX.Element {
  const track = state?.track ?? null
  const side = small ? 'size-7' : 'size-8'
  const icon = small ? 15 : 18
  return (
    <div className="flex items-center gap-1">
      <button
        aria-label="Previous"
        disabled={!track}
        onClick={() => send({ type: 'previous' })}
        className={`no-drag flex ${side} items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:text-text disabled:opacity-40`}
      >
        <SkipBack size={icon} fill="currentColor" />
      </button>
      <button
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={!track}
        onClick={() => send({ type: 'toggle' })}
        className={`no-drag flex ${small ? 'size-8' : 'size-9'} items-center justify-center rounded-full bg-text text-base transition-transform duration-[140ms] hover:scale-105 active:scale-95 disabled:opacity-40`}
      >
        {playing ? (
          <Pause size={icon} fill="currentColor" />
        ) : (
          <Play size={icon} fill="currentColor" className="translate-x-px" />
        )}
      </button>
      <button
        aria-label="Next"
        disabled={!track || !state?.hasNext}
        onClick={() => send({ type: 'next' })}
        className={`no-drag flex ${side} items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:text-text disabled:opacity-40`}
      >
        <SkipForward size={icon} fill="currentColor" />
      </button>
    </div>
  )
}

function WindowButtons({ layout }: { layout: MiniLayout }): React.JSX.Element {
  return (
    <>
      <WindowButton
        label={layout === 'lyrics' ? 'Show the full mini player' : 'Lyrics only'}
        onClick={() =>
          void window.api.invoke('prefs:set', {
            miniLayout: layout === 'lyrics' ? 'player' : 'lyrics'
          })
        }
      >
        {layout === 'lyrics' ? <PanelTop size={13} /> : <MicVocal size={13} />}
      </WindowButton>
      <WindowButton
        label="Open main window"
        onClick={() => void window.api.invoke('mini:showMain')}
      >
        <Maximize2 size={13} />
      </WindowButton>
      <WindowButton label="Close mini player" onClick={() => void window.api.invoke('mini:toggle')}>
        <X size={14} />
      </WindowButton>
    </>
  )
}

/**
 * The mini player window. Two layouts (QoL 4): the player (artwork, title, controls,
 * progress) or a lyric bar (the current line large, the next one faint). What shows is
 * set in Settings → General → Mini player. Drag it anywhere.
 */
export default function MiniApp(): React.JSX.Element {
  useEffect(() => bindAppearance(), [])
  const [state, setState] = useState<MiniState | null>(null)

  useEffect(() => {
    void window.api.invoke('mini:getState').then((s) => s && setState(s))
    return window.api.on('mini:state', setState)
  }, [])

  const { layout, parts } = useMiniPrefs()
  const lyric = useMiniLyric(parts.lyric || layout === 'lyrics' ? state : null)
  const track = state?.track ?? null
  const playing = state?.status === 'playing' || state?.status === 'loading'
  const art = parts.art ? track?.artworkUrl : undefined

  const backdrop = (
    <>
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
    </>
  )

  if (layout === 'lyrics')
    return (
      <div className="drag group relative h-screen select-none overflow-hidden bg-base text-text">
        {backdrop}
        <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
          {lyric.now ? (
            <>
              <p className="w-full truncate text-lg font-extrabold" title={lyric.now}>
                {lyric.now}
              </p>
              {lyric.next && (
                <p className="w-full truncate text-xs text-text-muted">{lyric.next}</p>
              )}
            </>
          ) : (
            <>
              <p className="w-full truncate text-md font-bold">
                {track?.title ?? 'Nothing playing'}
              </p>
              <p className="w-full truncate text-xs text-text-subdued">
                {track
                  ? track.artists.join(', ') || 'Unknown artist'
                  : 'Play something in the main window'}
              </p>
            </>
          )}
        </div>
        {/* Controls and window buttons appear on hover, so the bar stays just words. */}
        <div className="absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity duration-[140ms] group-hover:opacity-100">
          {parts.controls && <Controls state={state} playing={playing} small />}
          <WindowButtons layout={layout} />
        </div>
        {parts.progress && state && track && <Progress state={state} bare />}
      </div>
    )

  return (
    <div className="drag relative h-screen select-none overflow-hidden bg-base text-text">
      {backdrop}
      <div className="relative flex h-full items-center gap-3 py-3 pr-3 pl-3">
        {parts.art && (
          <div className="size-[80px] flex-none overflow-hidden rounded-md bg-raised shadow-[0_6px_18px_rgba(0,0,0,0.4)]">
            {art && <img src={art} alt="" className="size-full object-cover" />}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-between self-stretch pb-2">
          <div className="min-w-0 pr-20">
            <p className="truncate text-md font-bold">{track?.title ?? 'Nothing playing'}</p>
            {parts.lyric && lyric.now ? (
              // The current lyric line takes the artist's place while it plays.
              <p
                className="flex items-center gap-1.5 text-sm font-semibold text-text"
                title={lyric.now}
              >
                <MicVocal size={12} className="flex-none text-accent" />
                <span className="truncate">{lyric.now}</span>
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-text-subdued">
                {track && <SourceBadge provider={track.provider} />}
                <span className="truncate">
                  {track
                    ? track.artists.join(', ') || 'Unknown artist'
                    : 'Play something in the main window'}
                </span>
              </p>
            )}
          </div>
          {parts.controls && <Controls state={state} playing={playing} />}
        </div>
        <div className="absolute top-2 right-2 flex gap-1">
          <WindowButtons layout={layout} />
        </div>
      </div>
      {parts.progress && state && track && <Progress state={state} />}
    </div>
  )
}
