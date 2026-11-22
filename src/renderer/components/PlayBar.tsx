import { useEffect, useRef, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { AnimatePresence, motion } from 'motion/react'
import {
  MicVocal,
  MonitorPlay,
  PanelRight,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import { playback } from '@renderer/playback/controller'
import { usePlayback } from '@renderer/state/player'
import { useUi } from '@renderer/state/ui'
import { useJam } from '@renderer/state/jam'
import { motion as m } from '@renderer/styles/tokens'
import { playBarLayout, type PlayBarLayout } from '@renderer/lib/playBarLayout'
import { useElementWidth } from '@renderer/lib/useElementWidth'
import Artwork from './Artwork'
import SeekBar from './SeekBar'
import LikeButton from './LikeButton'
import SourceBadge from './SourceBadge'
import EntityLinks from './EntityLinks'

function IconButton({
  label,
  active,
  onClick,
  disabled,
  children
}: {
  label: string
  active?: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={`relative flex size-8 items-center justify-center rounded-full transition-colors duration-[140ms] disabled:opacity-40 ${
        active ? 'text-accent hover:text-accent-hover' : 'text-text-subdued hover:text-text'
      }`}
    >
      {children}
      {active && <span className="absolute -bottom-0.5 size-1 rounded-full bg-accent" />}
    </button>
  )
}

function NowPlaying({ showArtist }: { showArtist: boolean }): React.JSX.Element {
  const track = usePlayback((s) => s.current?.track)
  const error = usePlayback((s) => s.error)
  useEffect(() => {
    if (error) console.warn('[playback]', error)
  }, [error])
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="relative size-11 flex-none">
        <AnimatePresence initial={false}>
          <motion.div
            key={track?.id ?? 'none'}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: m.duration.crossfade / 1000, ease: [0.2, 0, 0, 1] }}
          >
            <Artwork src={track?.artworkUrl} size={44} className="rounded-md shadow-md" />
          </motion.div>
        </AnimatePresence>
      </div>
      {track && (
        <div className="min-w-0">
          <p className="truncate text-md font-medium">
            {track.albumRef ? (
              <EntityLinks names={[track.title]} refs={[track.albumRef]} kind="album" />
            ) : track.provider === 'soundcloud' ? (
              // SoundCloud tracks have no album: the title opens the track's own page.
              <EntityLinks
                names={[track.title]}
                refs={[{ id: track.id, name: track.title }]}
                kind="track"
              />
            ) : (
              track.title
            )}
          </p>
          {error && (
            <p role="alert" className="truncate text-xs text-danger" title={error}>
              {error}
            </p>
          )}
          {showArtist && (
            <p className="flex items-center gap-1.5 text-sm text-text-subdued">
              <SourceBadge provider={track.provider} />
              <EntityLinks names={track.artists} refs={track.artistRefs} className="truncate" />
            </p>
          )}
        </div>
      )}
      {track && <LikeButton track={track} />}
    </div>
  )
}

function Transport(): React.JSX.Element {
  const status = usePlayback((s) => s.status)
  const hasTrack = usePlayback((s) => s.current !== null)
  const shuffle = usePlayback((s) => s.shuffle)
  const repeat = usePlayback((s) => s.repeat)
  const playing = status === 'playing' || status === 'loading'
  return (
    <div className="flex items-center gap-3">
      <IconButton label="Shuffle" active={shuffle} onClick={() => playback.setShuffle(!shuffle)}>
        <Shuffle size={18} />
      </IconButton>
      <IconButton label="Previous" disabled={!hasTrack} onClick={() => void playback.previous()}>
        <SkipBack size={20} fill="currentColor" />
      </IconButton>
      <motion.button
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={!hasTrack}
        onClick={() => void playback.toggle()}
        whileTap={{ scale: 0.9 }}
        transition={m.spring}
        className="flex size-8 items-center justify-center rounded-full bg-text text-base transition-transform duration-[140ms] hover:scale-105 disabled:opacity-40"
      >
        {playing ? (
          <Pause size={16} fill="currentColor" />
        ) : (
          <Play size={16} fill="currentColor" className="ml-0.5" />
        )}
      </motion.button>
      <IconButton label="Next" disabled={!hasTrack} onClick={() => void playback.next()}>
        <SkipForward size={20} fill="currentColor" />
      </IconButton>
      <IconButton
        label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}
        active={repeat !== 'off'}
        onClick={() => playback.cycleRepeat()}
      >
        {repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
      </IconButton>
    </div>
  )
}

function VolumeSlider({ className }: { className: string }): React.JSX.Element {
  const volume = usePlayback((s) => s.volume)
  const muted = usePlayback((s) => s.muted)
  const level = muted ? 0 : volume
  return (
    <Slider.Root
      aria-label="Volume"
      className={`group relative flex h-4 touch-none items-center ${className}`}
      min={0}
      max={1}
      step={0.01}
      value={[level]}
      onValueChange={([v]) => {
        if (v === undefined) return
        if (muted && v > 0) playback.setMuted(false)
        playback.setVolume(v)
      }}
    >
      <Slider.Track className="relative h-1 grow overflow-hidden rounded-full bg-progress-track">
        <Slider.Range className="absolute h-full rounded-full bg-text group-hover:bg-accent" />
      </Slider.Track>
      <Slider.Thumb className="block size-3 rounded-full bg-text opacity-0 shadow transition-opacity duration-[140ms] group-hover:opacity-100 focus-visible:opacity-100" />
    </Slider.Root>
  )
}

/** Inline slider when the bar is roomy; an icon with a small glass popover when it's not. */
function Volume({ mode }: { mode: PlayBarLayout['volume'] }): React.JSX.Element {
  const volume = usePlayback((s) => s.volume)
  const muted = usePlayback((s) => s.muted)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const level = muted ? 0 : volume
  const Icon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (mode === 'slider') {
    return (
      <div className="flex items-center gap-1">
        <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={() => playback.setMuted(!muted)}>
          <Icon size={18} />
        </IconButton>
        <VolumeSlider className="w-24" />
      </div>
    )
  }
  return (
    <div ref={boxRef} className="relative">
      <IconButton label="Volume" active={open} onClick={() => setOpen(!open)}>
        <Icon size={18} />
      </IconButton>
      {open && (
        <div className="glass-strong absolute right-0 bottom-11 flex items-center gap-1 rounded-xl px-2 py-1.5">
          <IconButton label={muted ? 'Unmute' : 'Mute'} onClick={() => playback.setMuted(!muted)}>
            <Icon size={18} />
          </IconButton>
          <VolumeSlider className="w-28" />
        </div>
      )}
    </div>
  )
}

/**
 * Floating frosted play bar across the whole window. It sits over the bottom of the
 * sidebar, main page and right panel, whose lists scroll underneath it (they fade
 * out just above it, see the page-fade utility).
 */
export default function PlayBar(): React.JSX.Element {
  const panelOpen = useUi((s) => s.panelOpen)
  const togglePanel = useUi((s) => s.togglePanel)
  const onLyrics = useUi((s) => s.view === 'lyrics')
  const onPlayer = useUi((s) => s.view === 'player')
  const setView = useUi((s) => s.setView)
  const back = useUi((s) => s.back)
  const jamOn = useJam((s) => s.status.state !== 'off')
  const jamCount = useJam((s) => s.status.room?.participants.length ?? 0)
  const barRef = useRef<HTMLElement>(null)
  // Content width + its own 10 px side padding + the 14 px insets on each side.
  const width = useElementWidth(barRef)
  const layout = playBarLayout(width === 0 ? 1000 : width + 48)
  return (
    <footer
      ref={barRef}
      className="glass-bar absolute inset-x-[14px] bottom-[14px] z-40 grid h-16 grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] items-center gap-3 rounded-play-bar px-2.5"
    >
      <NowPlaying showArtist={layout.showArtist} />
      <div className="flex flex-col items-center gap-0.5">
        <Transport />
        <div className="w-full max-w-[560px]">
          <SeekBar showTimes={layout.showTimes} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        <IconButton
          label={onPlayer ? 'Leave the Player' : 'Player'}
          active={onPlayer}
          onClick={() => {
            if (!onPlayer) return setView('player')
            if (document.fullscreenElement) void document.exitFullscreen()
            if (useUi.getState().history.length) back()
            else setView('local')
          }}
        >
          <MonitorPlay size={18} />
        </IconButton>
        <IconButton
          label={onLyrics ? 'Hide lyrics' : 'Lyrics'}
          active={onLyrics}
          onClick={() =>
            onLyrics
              ? useUi.getState().history.length
                ? back()
                : setView('local')
              : setView('lyrics')
          }
        >
          <MicVocal size={18} />
        </IconButton>
        <IconButton
          label={panelOpen ? 'Hide panel' : 'Queue, details and Jam'}
          active={panelOpen || jamOn}
          onClick={() => togglePanel()}
        >
          <PanelRight size={18} />
          {jamCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 rounded-full bg-accent px-1 text-[9px] leading-3.5 font-bold text-on-accent">
              {jamCount}
            </span>
          )}
        </IconButton>
        <Volume mode={layout.volume} />
      </div>
    </footer>
  )
}
