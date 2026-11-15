import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, BadgeCheck, ListMusic, Search, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Album, Artist, Track } from '@shared/types'
import { formatTime } from '@renderer/lib/format'
import { pickTopResult } from '@renderer/lib/searchMerge'
import { addRecentSearch } from '@renderer/lib/recentSearches'
import { SEARCH_SOURCES, useSearch } from '@renderer/state/search'
import { useUi } from '@renderer/state/ui'
import { motion as m } from '@renderer/styles/tokens'
import Artwork from './Artwork'
import { SourceDot } from './SearchCards'
import { playFrom } from '@renderer/state/playContext'

const ALL_SOURCES = new Set(SEARCH_SOURCES)

type Item =
  | { kind: 'track'; track: Track; songs: Track[]; index: number }
  | { kind: 'artist'; artist: Artist }
  | { kind: 'set'; set: Album }
  | { kind: 'all' }

interface Group {
  title: string
  items: Item[]
}

function itemKey(it: Item): string {
  return it.kind === 'track'
    ? `t:${it.track.id}`
    : it.kind === 'artist'
      ? `a:${it.artist.id}`
      : it.kind === 'set'
        ? `s:${it.set.id}`
        : 'all'
}

/**
 * Quick search from anywhere (title bar pill or Ctrl+K): a frosted panel over the
 * current page with the best few results from every source. Enter shows all results on
 * the full Search page; ↑/↓ pick a result and Enter then plays or opens it. Esc closes.
 */
export default function QuickSearch(): React.JSX.Element {
  const open = useUi((s) => s.quickSearchOpen)
  return <AnimatePresence>{open && <Panel key="qs" />}</AnimatePresence>
}

function Panel(): React.JSX.Element {
  const close = useUi((s) => s.closeQuickSearch)
  const showSearch = useUi((s) => s.showSearch)
  const setView = useUi((s) => s.setView)
  const [query, setQuery] = useState('')
  /** Result picked with ↑/↓ (-1: none, so Enter shows all results). Hover only highlights. */
  const [active, setActive] = useState(-1)
  const [hovered, setHovered] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const r = useSearch(query, ALL_SOURCES)
  const q = query.trim()

  // Give focus back to whatever had it when the panel closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => before?.focus?.()
  }, [])

  const groups = useMemo<Group[]>(() => {
    if (!q) return []
    const top = pickTopResult(q, r.artists, r.tracks)
    const songs = r.tracks.slice(0, 5)
    const out: Group[] = []
    if (top) {
      out.push({
        title: 'Top result',
        items: [
          top.kind === 'artist'
            ? { kind: 'artist', artist: top.artist }
            : { kind: 'track', track: top.track, songs: [top.track], index: 0 }
        ]
      })
    }
    const topId = top?.kind === 'track' ? top.track.id : top?.artist.id
    const songItems = songs
      .map((track, index): Item => ({ kind: 'track', track, songs, index }))
      .filter((it) => it.kind === 'track' && it.track.id !== topId)
    if (songItems.length) out.push({ title: 'Songs', items: songItems })
    const artists = r.artists.filter((a) => a.id !== topId).slice(0, 3)
    if (artists.length) {
      out.push({ title: 'Artists', items: artists.map((artist) => ({ kind: 'artist', artist })) })
    }
    if (r.sets.length) {
      out.push({
        title: 'Albums & playlists',
        items: r.sets.slice(0, 3).map((set) => ({ kind: 'set', set }))
      })
    }
    out.push({ title: '', items: [{ kind: 'all' }] })
    return out
  }, [q, r.artists, r.tracks, r.sets])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const current = Math.min(active, flat.length - 1)

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const run = (it: Item): void => {
    if (it.kind === 'all') {
      if (q) addRecentSearch(q)
      showSearch(q)
      return
    }
    if (q) addRecentSearch(q)
    close()
    if (it.kind === 'track') void playFrom(it.songs, it.index, null)
    else if (it.kind === 'artist') setView(`artist:${it.artist.id}`)
    else setView(`album:${it.set.id}`)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(Math.min(flat.length - 1, current + 1))
      setHovered(-1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(-1, current - 1))
      setHovered(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (current >= 0 && flat[current] && !(e.ctrlKey || e.metaKey)) run(flat[current]!)
      else run({ kind: 'all' })
    }
  }

  let index = -1
  return (
    // no-drag: the title bar's drag region must not act through the overlay.
    <div className="no-drag fixed inset-0 z-[60]">
      {/* Only the scrim fades: fading the panel's ancestor would switch its blur off. */}
      <motion.div
        className="absolute inset-0 bg-scrim"
        onPointerDown={close}
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: m.duration.fast / 1000 }}
      />
      <motion.div
        role="dialog"
        aria-label="Quick search"
        initial={{ y: -8, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: -8, scale: 0.98 }}
        transition={m.spring}
        onKeyDown={onKeyDown}
        // Clicks on blank parts of the panel keep focus in the input, so Esc, arrows and
        // Space keep working (Space must type, not toggle playback).
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest('input, button')) e.preventDefault()
        }}
        className="glass-strong absolute top-12 left-1/2 flex max-h-[min(560px,calc(100vh-96px))] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl"
      >
        <label className="flex h-14 flex-none items-center gap-3 border-b border-divider px-4">
          <Search size={18} className="flex-none text-text-subdued" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(-1)
            }}
            placeholder="Search Spotify, SoundCloud, your files"
            aria-label="Quick search"
            className="min-w-0 flex-1 bg-transparent text-lg text-text outline-none placeholder:text-text-muted"
          />
          <kbd className="flex-none rounded-md border border-divider px-1.5 py-px font-sans text-[10px] text-text-muted">
            Esc
          </kbd>
        </label>
        <div ref={listRef} role="listbox" aria-label="Results" className="overflow-y-auto p-2">
          {!q ? (
            <p className="px-3 py-6 text-center text-sm text-text-muted">
              Type to search everything. Enter shows all results; ↑ ↓ pick one.
            </p>
          ) : r.query === '' && r.loading && flat.length <= 1 ? (
            <p className="px-3 py-6 text-center text-sm text-text-muted">Searching…</p>
          ) : (
            groups.map((g) => (
              <div key={g.title || 'all'} className="pb-1">
                {g.title && (
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-text-muted uppercase">
                    {g.title}
                  </p>
                )}
                {g.items.map((it) => {
                  index++
                  const i = index
                  return (
                    <Row
                      key={itemKey(it)}
                      item={it}
                      index={i}
                      active={i === current || (current < 0 && i === hovered)}
                      query={q}
                      onHover={() => setHovered(i)}
                      onRun={() => run(it)}
                    />
                  )
                })}
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  )
}

function Row({
  item,
  index,
  active,
  query,
  onHover,
  onRun
}: {
  item: Item
  index: number
  active: boolean
  query: string
  onHover: () => void
  onRun: () => void
}): React.JSX.Element {
  const base = `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-[80ms] ${
    active ? 'bg-raised-hover' : ''
  }`
  const common = {
    role: 'option' as const,
    'aria-selected': active,
    'data-index': index,
    onPointerMove: onHover,
    onClick: onRun,
    className: base
  }
  if (item.kind === 'all') {
    return (
      <button {...common}>
        <span className="flex size-9 flex-none items-center justify-center rounded-md bg-raised text-text-subdued">
          <Search size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate text-text-subdued">
          See all results for <span className="font-semibold text-text">“{query}”</span>
        </span>
        <span className="flex items-center gap-1 text-xs text-text-muted">
          Enter <ArrowRight size={14} />
        </span>
      </button>
    )
  }
  if (item.kind === 'track') {
    const t = item.track
    return (
      <button {...common}>
        <Artwork src={t.artworkUrl} size={36} className="rounded-md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-text">{t.title}</span>
          <span className="flex items-center gap-1.5 text-sm text-text-subdued">
            <SourceDot provider={t.provider} />
            <span className="truncate">{t.artists.join(', ') || 'Unknown artist'}</span>
          </span>
        </span>
        <span className="text-sm text-text-muted tabular-nums">{formatTime(t.durationMs)}</span>
      </button>
    )
  }
  if (item.kind === 'artist') {
    const a = item.artist
    return (
      <button {...common}>
        <span className="flex size-9 flex-none items-center justify-center overflow-hidden rounded-full bg-raised text-text-muted">
          {a.imageUrl ? (
            <img src={a.imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <UserRound size={16} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-text">
            <span className="truncate">{a.name}</span>
            {a.verified && <BadgeCheck size={13} className="flex-none text-accent" />}
          </span>
          <span className="flex items-center gap-1.5 text-sm text-text-subdued">
            <SourceDot provider={a.provider} />
            Artist
          </span>
        </span>
      </button>
    )
  }
  const s = item.set
  return (
    <button {...common}>
      <span className="flex size-9 flex-none items-center justify-center overflow-hidden rounded-md bg-raised text-text-muted">
        {s.artworkUrl ? (
          <img src={s.artworkUrl} alt="" className="size-full object-cover" />
        ) : (
          <ListMusic size={16} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-text">{s.name}</span>
        <span className="flex items-center gap-1.5 text-sm text-text-subdued">
          <SourceDot provider={s.provider} />
          <span className="truncate">{s.artists[0]?.name ?? 'Playlist'}</span>
        </span>
      </span>
    </button>
  )
}
