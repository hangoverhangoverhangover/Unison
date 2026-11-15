import { useVirtualizer } from '@tanstack/react-virtual'
import { Clock3 } from 'lucide-react'
import { useCallback } from 'react'
import type { Track } from '@shared/types'
import { usePlayback } from '@renderer/state/player'
import { useMemo } from 'react'
import { listShape } from '@renderer/lib/trackListShape'
import TrackRow, { ROW_GRID, ROW_GRID_NO_ALBUM, ROW_HEIGHT, type RowContext } from './TrackRow'
import { playFrom } from '@renderer/state/playContext'

/** The list's column labels (# / Title / Album / duration). */
export function ColumnHeader({
  sticky = false,
  showAlbum = true
}: {
  sticky?: boolean
  showAlbum?: boolean
}): React.JSX.Element {
  return (
    <div
      className={`${showAlbum ? ROW_GRID : ROW_GRID_NO_ALBUM} h-9 border-b border-divider text-xs font-semibold tracking-[0.06em] text-text-muted uppercase ${
        sticky ? 'sticky top-0 z-10' : ''
      }`}
    >
      <span className="text-right">#</span>
      <span>Title</span>
      {showAlbum && <span>Album</span>}
      <span className="flex justify-end">
        <Clock3 size={16} aria-label="Duration" />
      </span>
    </div>
  )
}

/**
 * Virtualized track table. Always virtualized (lists here easily pass 100 rows).
 * The scroll container is owned by the parent (so the hero header scrolls with it);
 * pass it in with `scrollRef`, and `offsetTop` = height above the list inside it.
 */
export default function TrackList({
  tracks,
  scrollRef,
  offsetTop,
  context,
  positions
}: {
  tracks: Track[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  offsetTop: number
  context?: RowContext
  /** Each row's position in the full list, when `tracks` is filtered. */
  positions?: number[]
}): React.JSX.Element {
  const currentId = usePlayback((s) => s.current?.track.id)
  const playing = usePlayback((s) => s.status === 'playing')
  const shape = useMemo(() => listShape(tracks), [tracks])
  // TanStack Virtual returns a mutable instance; React Compiler skips this component, which is fine.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin: offsetTop
  })
  const playAt = useCallback((i: number) => void playFrom(tracks, i), [tracks])

  return (
    <div>
      <ColumnHeader showAlbum={shape.hasAlbums} />
      <div role="list" className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const track = tracks[row.index]!
          return (
            <TrackRow
              key={`${row.index}:${track.id}`}
              track={track}
              index={row.index}
              position={positions?.[row.index]}
              isCurrent={track.id === currentId}
              playing={playing}
              onPlay={() => playAt(row.index)}
              context={context}
              className="absolute inset-x-0"
              style={{
                transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`
              }}
              showAlbum={shape.hasAlbums}
              mixed={shape.mixed}
            />
          )
        })}
      </div>
    </div>
  )
}

/** Plain (non-virtual) rows for short lists, e.g. one search group (≤ 20 rows). */
export function TrackRows({
  tracks,
  showAlbum
}: {
  tracks: Track[]
  /** Defaults to whether any track has an album. */
  showAlbum?: boolean
}): React.JSX.Element {
  const currentId = usePlayback((s) => s.current?.track.id)
  const playing = usePlayback((s) => s.status === 'playing')
  const shape = useMemo(() => listShape(tracks), [tracks])
  return (
    <div role="list">
      {tracks.map((track, i) => (
        <TrackRow
          key={`${i}:${track.id}`}
          track={track}
          index={i}
          isCurrent={track.id === currentId}
          playing={playing}
          showAlbum={showAlbum ?? shape.hasAlbums}
          mixed={shape.mixed}
          onPlay={() => void playFrom(tracks, i)}
        />
      ))}
    </div>
  )
}
