import { ChartColumn, FolderOpen, Library, MonitorPlay, Plus, Rss } from 'lucide-react'
import { SMART_KINDS, SMART_META } from '@renderer/lib/smart'
import SmartIcon from './SmartIcon'
import { useLibrary } from '@renderer/state/library'
import { useSoundCloud, useSpotify } from '@renderer/state/services'
import { useLikes } from '@renderer/state/likes'
import { usePlaylists } from '@renderer/state/playlists'
import { LikedCover } from '@renderer/views/ServiceViews'
import { SIDEBAR } from '@shared/layout'
import SidebarPlaylists from './SidebarPlaylists'
import { useUi, type View } from '@renderer/state/ui'
import PlayingMark from './PlayingMark'

function NavItem({
  view,
  icon,
  label,
  detail,
  compact
}: {
  view: View
  icon: React.ReactNode
  label: string
  detail?: React.ReactNode
  /** Icon rail: cover only, name in the tooltip. */
  compact?: boolean
}): React.JSX.Element {
  const active = useUi((s) => s.view === view)
  const setView = useUi((s) => s.setView)
  return (
    <button
      onClick={() => setView(view)}
      aria-current={active ? 'page' : undefined}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className={`flex w-full items-center gap-3 rounded-lg text-left transition-colors duration-[140ms] ${
        compact ? 'justify-center p-1.5' : 'px-2 py-1.5'
      } ${active ? 'bg-raised text-text' : 'text-text-subdued hover:bg-raised/60 hover:text-text'}`}
    >
      <span className="flex size-10 flex-none items-center justify-center overflow-hidden rounded-md bg-raised">
        {icon}
      </span>
      {!compact && (
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-text">{label}</span>
          {detail && <span className="block truncate text-sm text-text-subdued">{detail}</span>}
        </span>
      )}
      {!compact && <PlayingMark view={view} />}
    </button>
  )
}

function TopItem({
  view,
  icon,
  label,
  compact
}: {
  view: View
  icon: React.ReactNode
  label: string
  compact?: boolean
}): React.JSX.Element {
  const active = useUi((s) => s.view === view)
  const setView = useUi((s) => s.setView)
  return (
    <button
      onClick={() => setView(view)}
      aria-current={active ? 'page' : undefined}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className={`flex w-full items-center gap-3.5 rounded-lg py-2 font-semibold transition-colors duration-[140ms] ${
        compact ? 'justify-center px-0' : 'px-3'
      } ${active ? 'bg-raised text-text' : 'text-text-subdued hover:bg-raised/60 hover:text-text'}`}
    >
      {icon}
      {!compact && label}
    </button>
  )
}

/** The three history-built playlists as one row of square tiles. */
function SmartTiles(): React.JSX.Element {
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  return (
    <div className="grid grid-cols-3 gap-1.5 px-1 pt-1 pb-2">
      {SMART_KINDS.map((k) => {
        const v = `smart:${k}` as const
        const active = view === v
        return (
          <button
            key={k}
            onClick={() => setView(v)}
            aria-current={active ? 'page' : undefined}
            className={`group flex min-w-0 flex-col gap-1.5 rounded-lg p-1.5 text-left transition-colors duration-[140ms] ${
              active ? 'bg-raised' : 'hover:bg-raised/60'
            }`}
          >
            <span className="aspect-square w-full overflow-hidden rounded-md shadow-sm">
              <SmartIcon kind={k} size={22} />
            </span>
            <span
              className={`line-clamp-2 text-xs leading-tight font-semibold ${
                active ? 'text-text' : 'text-text-subdued group-hover:text-text'
              }`}
            >
              {SMART_META[k].name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function LikesItem({ compact }: { compact?: boolean }): React.JSX.Element {
  const likes = useLikes((s) => s.likes)
  const anyConnected = useSpotify((s) => s.status?.state === 'connected')
  const scConnected = useSoundCloud((s) => s.status?.state === 'connected')
  return (
    <NavItem
      compact={compact}
      view="likes"
      icon={<LikedCover size={18} />}
      label="Liked Songs"
      detail={
        likes.state === 'ok' && likes.data.length > 0
          ? plural(likes.data.length, 'song')
          : anyConnected || scConnected
            ? 'Spotify and SoundCloud'
            : 'Connect a service'
      }
    />
  )
}

/**
 * Left sidebar. `width` is the rendered width; at SIDEBAR.rail it becomes an icon rail
 * (icons and covers only, names in tooltips). `handle` is its resize handle.
 */
export default function Sidebar({
  width,
  handle
}: {
  width: number
  handle?: React.ReactNode
}): React.JSX.Element {
  const trackCount = useLibrary((s) => s.tracks.length)
  const scConnected = useSoundCloud((s) => s.status?.state === 'connected')
  const compact = width <= SIDEBAR.rail

  return (
    <nav className="relative flex flex-none flex-col gap-2" style={{ width }}>
      <div className="glass rounded-panel p-1.5">
        {scConnected && (
          <TopItem compact={compact} view="feed" icon={<Rss size={20} />} label="Feed" />
        )}
        <TopItem compact={compact} view="player" icon={<MonitorPlay size={20} />} label="Player" />
        <TopItem compact={compact} view="stats" icon={<ChartColumn size={20} />} label="Stats" />
      </div>
      <div className="glass flex min-h-0 flex-1 flex-col rounded-panel p-1.5">
        <LibraryHeader compact={compact} />
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto page-fade pb-page">
          {compact ? (
            SMART_KINDS.map((k) => (
              <NavItem
                key={k}
                compact
                view={`smart:${k}`}
                icon={<SmartIcon kind={k} />}
                label={SMART_META[k].name}
              />
            ))
          ) : (
            <SmartTiles />
          )}
          <LikesItem compact={compact} />
          <NavItem
            compact={compact}
            view="local"
            icon={<FolderOpen size={20} className="text-accent" />}
            label="Local Files"
            detail={plural(trackCount, 'track')}
          />
          {!compact && (
            <div className="flex items-center justify-between px-2 pt-4 pb-1">
              <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
                Playlists
              </span>
              <NewPlaylistButton />
            </div>
          )}
          {compact && <div className="mx-3 my-2 h-px bg-divider" />}
          <SidebarPlaylists compact={compact} />
        </div>
      </div>
      {handle}
    </nav>
  )
}

function NewPlaylistButton(): React.JSX.Element {
  const create = usePlaylists((s) => s.create)
  const setView = useUi((s) => s.setView)
  return (
    <button
      aria-label="New playlist"
      title="New playlist"
      onClick={() =>
        void create('New playlist').then((p) => {
          if (p) setView(`playlist:${p.id}`)
        })
      }
      className="flex size-7 items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text"
    >
      <Plus size={16} />
    </button>
  )
}

/** "Your Library" heading: opens the full Library (every playlist, hidden ones too). */
function LibraryHeader({ compact }: { compact?: boolean }): React.JSX.Element {
  const active = useUi((s) => s.view === 'library')
  const setView = useUi((s) => s.setView)
  return (
    <button
      onClick={() => setView('library')}
      aria-current={active ? 'page' : undefined}
      aria-label={compact ? 'Your Library' : undefined}
      title="Show every playlist, including hidden ones"
      className={`flex items-center gap-3 rounded-lg pt-2 pb-2 text-left transition-colors duration-[140ms] ${
        compact ? 'justify-center' : 'px-3'
      } ${active ? 'text-text' : 'text-text-subdued hover:text-text'}`}
    >
      <Library size={20} />
      {!compact && <span className="text-lg font-bold">Your Library</span>}
    </button>
  )
}
