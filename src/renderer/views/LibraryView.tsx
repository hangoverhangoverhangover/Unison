import { ChartColumn, CopyCheck, Users, Eye, EyeOff, FolderOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Playlist } from '@shared/types'
import { fold } from '@renderer/lib/filter'
import { orderPlaylists } from '@renderer/lib/playlistOrder'
import { useAllPlaylists } from '@renderer/state/allPlaylists'
import { useLibrary } from '@renderer/state/library'
import { useLikes } from '@renderer/state/likes'
import { usePlaylistPrefs } from '@renderer/state/playlistPrefs'
import { useUi, type View } from '@renderer/state/ui'
import { Message } from '@renderer/components/CollectionView'
import ListFilter from '@renderer/components/ListFilter'
import { PlaylistCover, PlaylistDetail } from '@renderer/components/SidebarPlaylists'
import { LikedCover } from './ServiceViews'
import ActivePill from '@renderer/components/ActivePill'
import PlayingMark from '@renderer/components/PlayingMark'

type Filter = 'all' | 'shown' | 'hidden'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'shown', label: 'In sidebar' },
  { key: 'hidden', label: 'Hidden' }
]

function Shortcut({
  view,
  icon,
  label,
  detail
}: {
  view: View
  icon: React.ReactNode
  label: string
  detail: string
}): React.JSX.Element {
  const setView = useUi((s) => s.setView)
  return (
    <button
      onClick={() => setView(view)}
      className="flex min-w-0 items-center gap-3 rounded-xl bg-raised p-2 pr-3 text-left transition-colors duration-[140ms] hover:bg-raised-hover"
    >
      <span className="flex size-12 flex-none items-center justify-center overflow-hidden rounded-md bg-raised">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-bold">{label}</span>
        <span className="block truncate text-sm text-text-subdued">{detail}</span>
      </span>
    </button>
  )
}

function Row({ p, hidden }: { p: Playlist; hidden: boolean }): React.JSX.Element {
  const setView = useUi((s) => s.setView)
  const setHidden = usePlaylistPrefs((s) => s.setHidden)
  return (
    <li className="group flex items-center gap-3 rounded-lg pr-2 transition-colors duration-[140ms] hover:bg-raised/70">
      <button
        onClick={() => setView(`playlist:${p.id}`)}
        className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
      >
        <span
          className={`flex size-12 flex-none items-center justify-center overflow-hidden rounded-md bg-raised ${hidden ? 'opacity-50' : ''}`}
        >
          <PlaylistCover p={p} size={22} />
        </span>
        <span className="min-w-0">
          <span
            className={`block truncate font-bold ${hidden ? 'text-text-subdued' : 'text-text'}`}
          >
            {p.name}
          </span>
          <span className="block truncate text-sm text-text-subdued">
            <PlaylistDetail p={p} />
          </span>
        </span>
        <PlayingMark view={`playlist:${p.id}`} />
      </button>
      {hidden && (
        <span className="flex-none rounded-full bg-raised px-2 py-0.5 text-xs text-text-subdued">
          Hidden
        </span>
      )}
      <button
        onClick={() => void setHidden(p.id, !hidden)}
        aria-label={hidden ? `Show ${p.name} in the sidebar` : `Hide ${p.name} from the sidebar`}
        title={hidden ? 'Show in sidebar' : 'Hide from sidebar'}
        className="flex size-9 flex-none items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        {hidden ? <Eye size={18} /> : <EyeOff size={18} />}
      </button>
    </li>
  )
}

/** Every playlist, hidden ones included, in sidebar order. Hide or show each one here. */
export default function LibraryView(): React.JSX.Element {
  const all = useAllPlaylists()
  const prefs = usePlaylistPrefs((s) => s.prefs)
  const hidden = usePlaylistPrefs((s) => s.hidden)
  const error = usePlaylistPrefs((s) => s.error)
  const likes = useLikes((s) => s.likes)
  const localCount = useLibrary((s) => s.tracks.length)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const ordered = useMemo(() => orderPlaylists(all, prefs), [all, prefs])
  const shown = useMemo(() => {
    const words = fold(query).split(' ').filter(Boolean)
    return ordered.filter((p) => {
      const isHidden = hidden.has(p.id)
      if (filter === 'shown' && isHidden) return false
      if (filter === 'hidden' && !isHidden) return false
      const hay = fold(`${p.name} ${p.ownerName ?? ''}`)
      return words.every((w) => hay.includes(w))
    })
  }, [ordered, hidden, filter, query])

  return (
    <div className="relative h-full overflow-y-auto page-fade pb-page px-4 pt-8">
      <header className="flex flex-wrap items-end justify-between gap-4 px-2 pt-4">
        <div>
          <h1 className="text-[32px] leading-10 font-black">Your Library</h1>
          <p className="mt-1 text-sm text-text-subdued">
            Every playlist, including ones hidden from the sidebar. Drag playlists in the sidebar to
            reorder them.
          </p>
        </div>
      </header>

      {/* Same-size tiles, most used first. */}
      <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2 px-2">
        <Shortcut
          view="likes"
          icon={<LikedCover size={20} />}
          label="Liked Songs"
          detail={likes.state === 'ok' ? `${likes.data.length} songs` : 'Spotify and SoundCloud'}
        />
        <Shortcut
          view="local"
          icon={<FolderOpen size={22} className="text-accent" />}
          label="Local Files"
          detail={`${localCount} tracks`}
        />
        <Shortcut
          view="following"
          icon={<Users size={22} className="text-accent" />}
          label="Following"
          detail="People you follow on SoundCloud"
        />
        <Shortcut
          view="stats"
          icon={<ChartColumn size={22} className="text-accent" />}
          label="Your listening"
          detail="Top artists and tracks"
        />
        <Shortcut
          view="duplicates"
          icon={<CopyCheck size={22} className="text-accent" />}
          label="Duplicates"
          detail="Same song in two places"
        />
      </div>

      {/* Filters and the playlist search sit together, right above the list they act on. */}
      <div className="mt-6 flex items-center gap-2 px-2">
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="radio"
              aria-checked={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`relative isolate rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-[140ms] ${
                filter === f.key ? 'text-base' : 'bg-raised text-text hover:bg-raised/70'
              }`}
            >
              {filter === f.key && <ActivePill layoutId="library-filter" />}
              {f.label}
              {f.key === 'hidden' && hidden.size > 0
                ? ` (${prefs.hidden.filter((id) => all.some((p) => p.id === id)).length})`
                : ''}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <ListFilter value={query} onChange={setQuery} label="Search playlists" />
        </div>
      </div>
      {error && <p className="mt-3 px-2 text-sm text-danger">{error}</p>}

      {shown.length === 0 ? (
        <Message
          title={filter === 'hidden' && !query ? 'No hidden playlists' : 'No playlists here'}
          body={
            filter === 'hidden' && !query
              ? 'Right-click a playlist in the sidebar and choose Hide from sidebar.'
              : 'Try another filter or fewer words.'
          }
        />
      ) : (
        <ul className="mt-3 flex flex-col">
          {shown.map((p) => (
            <Row key={p.id} p={p} hidden={hidden.has(p.id)} />
          ))}
        </ul>
      )}
    </div>
  )
}
