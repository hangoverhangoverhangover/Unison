import { ChevronRight, ListMusic, Repeat2, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FeedItem } from '@shared/soundcloud'
import type { Album } from '@shared/types'
import { useCatalog } from '@renderer/state/catalog'
import { TrackRows } from './TrackList'
import type { Track } from '@shared/types'
import { timeAgo } from '@renderer/lib/format'
import { ALBUM_TYPE_LABEL } from '@renderer/lib/catalog'
import { usePlayback } from '@renderer/state/player'
import { useUi } from '@renderer/state/ui'
import TrackRow from './TrackRow'
import { playFrom } from '@renderer/state/playContext'

/**
 * SoundCloud feed or reposts: who posted or reposted what, when. Every entry is
 * numbered in order, songs and playlists alike. Tracks play as one list (in feed
 * order); a playlist or album opens its page, or unfolds in place (its songs get their
 * own numbering).
 */
export default function FeedList({
  items,
  showBy = true
}: {
  items: FeedItem[]
  /** Hide "X reposted" on a profile's own reposts list. */
  showBy?: boolean
}): React.JSX.Element {
  const setView = useUi((s) => s.setView)
  const currentId = usePlayback((s) => s.current?.track.id)
  const playing = usePlayback((s) => s.status === 'playing')
  const tracks = useMemo(() => items.map((i) => i.track).filter((t): t is Track => !!t), [items])

  // Position of each track in the playable list (the feed's songs, in order).
  let trackIndex = -1
  return (
    <ul className="flex flex-col">
      {items.map((item, position) => {
        const header = showBy ? (
          <p className="flex items-center gap-2 px-4 pt-3 pb-1 text-xs text-text-subdued">
            <span className="size-5 flex-none overflow-hidden rounded-full bg-raised">
              {item.by.avatarUrl ? (
                <img
                  src={item.by.avatarUrl}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : (
                <UserRound size={12} className="m-1 text-text-subdued" />
              )}
            </span>
            <button
              onClick={() => setView(`artist:${item.by.id}`)}
              className="font-bold text-text hover:underline"
            >
              {item.by.name}
            </button>
            {item.type === 'repost' ? (
              <span className="flex items-center gap-1">
                <Repeat2 size={12} /> reposted
              </span>
            ) : (
              <span>posted</span>
            )}
            <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
          </p>
        ) : null

        if (item.track) {
          trackIndex++
          const i = trackIndex
          return (
            <li key={item.id}>
              {header}
              <TrackRow
                track={item.track}
                index={position}
                isCurrent={item.track.id === currentId}
                playing={playing}
                onPlay={() => void playFrom(tracks, i)}
              />
            </li>
          )
        }
        const set = item.set
        if (!set) return null
        return (
          <li key={item.id}>
            {header}
            <SetRow set={set} number={position + 1} onOpen={() => setView(`album:${set.id}`)} />
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A playlist or album in the feed, numbered like the songs around it. The chevron
 * unfolds its songs underneath (numbered from 1, indented); the name opens its page.
 */
function SetRow({
  set,
  number,
  onOpen
}: {
  set: Album
  number: number
  onOpen: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const page = useCatalog((s) => s.albums[set.id])
  const load = useCatalog((s) => s.loadAlbum)
  useEffect(() => {
    if (open && !page) void load(set.id)
  }, [open, page, load, set.id])

  return (
    <div>
      <div className="group grid h-14 grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-4 rounded-lg px-4 transition-colors duration-[140ms] hover:bg-raised/70">
        <span className="text-right text-text-subdued tabular-nums">{number}</span>
        <button onClick={onOpen} className="flex min-w-0 items-center gap-3 text-left">
          <span className="size-10 flex-none overflow-hidden rounded-sm bg-raised">
            {set.artworkUrl ? (
              <img src={set.artworkUrl} alt="" loading="lazy" className="size-full object-cover" />
            ) : (
              <ListMusic size={18} className="m-2.5 text-text-subdued" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-text group-hover:underline">{set.name}</span>
            <span className="block truncate text-sm text-text-subdued">
              {ALBUM_TYPE_LABEL[set.type]} · {set.artists[0]?.name ?? 'Unknown'} · {set.trackCount}{' '}
              {set.trackCount === 1 ? 'track' : 'tracks'}
            </span>
          </span>
        </button>
        <button
          aria-label={open ? `Hide the songs in ${set.name}` : `Show the songs in ${set.name}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex size-8 items-center justify-center justify-self-end rounded-full text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text"
        >
          <ChevronRight
            size={18}
            className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          />
        </button>
      </div>
      {open && (
        <div className="ml-10 border-l border-divider pl-2">
          {page?.state === 'ok' ? (
            <TrackRows tracks={page.data.tracks} showAlbum={false} />
          ) : page?.state === 'error' ? (
            <p className="px-4 py-2 text-sm text-danger">{page.error}</p>
          ) : (
            <p className="px-4 py-2 text-sm text-text-subdued">Loading songs…</p>
          )}
        </div>
      )}
    </div>
  )
}
