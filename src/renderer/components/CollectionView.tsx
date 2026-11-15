import { AnimatePresence, motion } from 'motion/react'
import { Shuffle } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Track } from '@shared/types'
import { playback } from '@renderer/playback/controller'
import { formatCollection } from '@renderer/lib/format'
import { effect, motion as m } from '@renderer/styles/tokens'
import TrackList, { ColumnHeader } from './TrackList'
import ListFilter from './ListFilter'
import { filterTracks } from '@renderer/lib/filter'
import type { RowContext } from './TrackRow'
import { HeroPlayButton, StickyTitle } from './PageHeader'
import { useScrolledPast } from '@renderer/lib/useScrolledPast'
import { playFrom } from '@renderer/state/playContext'
import { usePlayingFrom, useQueuedFrom } from '@renderer/state/playContext'
import { useUi } from '@renderer/state/ui'

/**
 * Shared layout for any list of tracks: a hero (cover, kind, big title, byline) on a
 * soft glow of its artwork, one action row (play, shuffle, the page's own controls,
 * search in list), then the virtualized track list (or an empty/error state). Once
 * the hero scrolls away a slim frosted strip with the title and play stays on top.
 */
export default function CollectionView({
  kicker,
  title,
  cover,
  tracks,
  subtitle,
  loading,
  error,
  empty,
  toolbar,
  rowContext,
  byline,
  heroArtwork,
  footer,
  filterLabel = 'Search in this list'
}: {
  kicker: string
  title: string
  cover: React.ReactNode
  tracks: Track[]
  /** Defaults to "N songs, X min". */
  subtitle?: string
  loading?: boolean
  error?: string
  empty: React.ReactNode
  /** Extra controls after play/shuffle (filters, rename, sync). */
  toolbar?: React.ReactNode
  /** Passed to every row (e.g. the editable playlist they belong to). */
  rowContext?: RowContext
  /** Replaces the subtitle line with richer content (artist links, year, count). */
  byline?: React.ReactNode
  /** Artwork behind the hero; defaults to the first track's. */
  heroArtwork?: string
  /** Under the track list (release date, copyrights). */
  footer?: React.ReactNode
  /** Placeholder for the in-list search, e.g. "Search in Liked Songs". */
  filterLabel?: string
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterTracks(tracks, query), [tracks, query])
  const shown = filtered?.tracks ?? tracks
  const scrollRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [heroHeight, setHeroHeight] = useState(0)
  const scrolledPast = useScrolledPast(scrollRef, sentinelRef)
  const isEmpty = !loading && !error && tracks.length === 0
  const hasAlbums = useMemo(() => shown.some((t) => !!t.album), [shown])
  const view = useUi((s) => s.view)
  const playingHere = usePlayingFrom(view)
  const queuedHere = useQueuedFrom(view)
  // Like the play bar: when this page's list is the one playing, the button pauses it
  // (and resumes it), instead of starting over.
  const playAll = (): void => {
    if (queuedHere) void playback.toggle()
    else void playFrom(shown, 0)
  }

  useLayoutEffect(() => {
    const el = heroRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeroHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const firstArt = useMemo(() => tracks.find((t) => t.artworkUrl)?.artworkUrl, [tracks])
  const heroArt = heroArtwork ?? firstArt
  const totalMs = useMemo(() => tracks.reduce((sum, t) => sum + t.durationMs, 0), [tracks])

  const shufflePlay = (): void => {
    if (shown.length === 0) return
    playback.setShuffle(true)
    void playFrom(shown, Math.floor(Math.random() * shown.length))
  }

  return (
    <div className="relative h-full">
      <StickyTitle
        show={scrolledPast && !isEmpty}
        title={title}
        play={
          <HeroPlayButton
            small
            playing={playingHere}
            disabled={shown.length === 0}
            onClick={playAll}
          />
        }
        below={shown.length > 0 ? <ColumnHeader showAlbum={hasAlbums} /> : undefined}
      />
      <div ref={scrollRef} className="relative h-full overflow-y-auto page-fade pb-page">
        <div ref={heroRef} className="relative overflow-hidden">
          <AnimatePresence initial={false}>
            {heroArt && (
              <motion.img
                key={heroArt}
                src={heroArt}
                alt=""
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: m.duration.crossfade / 1000, ease: [0.2, 0, 0, 1] }}
                className="absolute inset-0 size-full scale-125 object-cover opacity-55"
                style={{
                  filter: `blur(${effect.heroBlur}px) saturate(1.3)`,
                  maskImage: 'linear-gradient(180deg, #000 0%, transparent 100%)'
                }}
              />
            )}
          </AnimatePresence>
          <div className="relative flex items-end gap-7 px-7 pt-12 pb-6">
            <div className="size-[192px] flex-none overflow-hidden rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
              {cover}
            </div>
            <div className="min-w-0 pb-1">
              <p className="text-xs font-semibold tracking-[0.08em] text-text-subdued uppercase">
                {kicker}
              </p>
              <h1
                className={`mt-1 font-black tracking-[-0.03em] ${title.length > 18 ? 'line-clamp-2 text-[48px] leading-[52px]' : 'text-hero'}`}
              >
                {title}
              </h1>
              {byline ?? (
                <p className="mt-2 text-sm text-text-subdued">
                  {subtitle ?? (loading ? 'Loading…' : formatCollection(tracks.length, totalMs))}
                </p>
              )}
            </div>
          </div>
          <div className="relative flex min-h-12 items-center gap-3 px-7 pb-4">
            {!isEmpty && (
              <>
                <HeroPlayButton
                  playing={playingHere}
                  disabled={shown.length === 0}
                  onClick={playAll}
                />
                <button
                  aria-label="Shuffle play"
                  title="Shuffle play"
                  disabled={shown.length === 0}
                  onClick={shufflePlay}
                  className="flex size-10 items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text disabled:opacity-40"
                >
                  <Shuffle size={20} />
                </button>
              </>
            )}
            {toolbar}
            {tracks.length > 0 && (
              <div className="ml-auto">
                <ListFilter value={query} onChange={setQuery} label={filterLabel} />
              </div>
            )}
          </div>
          <div ref={sentinelRef} aria-hidden className="absolute bottom-0 h-px w-full" />
        </div>

        <div className="px-2 pb-4">
          {error ? (
            <Message title="Couldn't load this" body={error} />
          ) : !loading && tracks.length === 0 ? (
            empty
          ) : filtered && shown.length === 0 ? (
            <Message
              title={`Nothing matches “${query.trim()}”`}
              body="Try fewer or different words."
            />
          ) : (
            <TrackList
              tracks={shown}
              positions={filtered?.positions}
              scrollRef={scrollRef}
              offsetTop={heroHeight}
              context={rowContext}
            />
          )}
          {footer}
        </div>
      </div>
    </div>
  )
}

/** Centered empty/error message with optional actions. */
export function Message({
  title,
  body,
  children
}: {
  title: string
  body: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
      <p className="text-xl font-bold">{title}</p>
      <p className="max-w-md text-text-subdued">{body}</p>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  )
}

export function PrimaryButton({
  onClick,
  children
}: {
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="rounded-md bg-accent px-4 py-2 font-bold text-on-accent transition-colors duration-[140ms] hover:bg-accent-hover"
    >
      {children}
    </button>
  )
}

export function GhostButton({
  onClick,
  children
}: {
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-4 py-2 font-bold text-text-subdued transition-colors duration-[140ms] hover:text-text"
    >
      {children}
    </button>
  )
}
