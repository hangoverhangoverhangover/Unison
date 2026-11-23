import * as ContextMenu from '@radix-ui/react-context-menu'
import { ChevronRight, Pause, Play, Plus } from 'lucide-react'
import { useMemo } from 'react'
import type { Track } from '@shared/types'
import { isPlayable } from '@shared/types'
import { UNPLAYABLE_REASON } from '@shared/soundcloud'
import { playback } from '@renderer/playback/controller'
import { formatTime } from '@renderer/lib/format'
import { serviceStore } from '@renderer/state/services'
import { usePlaylists } from '@renderer/state/playlists'
import { useUi } from '@renderer/state/ui'
import Artwork from './Artwork'
import { SourceDot } from './SearchCards'
import SourceBadge from './SourceBadge'
import DownloadButton from './DownloadButton'
import EntityLinks from './EntityLinks'
import { useDownloads } from '@renderer/state/downloads'
import { useFind } from '@renderer/state/find'
import { useTagEditor } from '@renderer/state/tagEditor'
import { useLibrary } from '@renderer/state/library'
import { SERVICE_NAME } from '@renderer/lib/services'
import EqBars from './EqBars'
import { useTitleFix } from '@renderer/state/titleFix'
import BackgroundMenu from './BackgroundMenu'

export const ROW_HEIGHT = 56
export const ROW_GRID =
  'grid grid-cols-[40px_minmax(0,4fr)_minmax(0,3fr)_96px] items-center gap-4 px-4'
/** Same row without the Album column (lists where no track has an album). */
export const ROW_GRID_NO_ALBUM = 'grid grid-cols-[40px_minmax(0,1fr)_96px] items-center gap-4 px-4'

export interface RowContext {
  /** Set when the list is a playlist the user can edit: enables "Remove from this playlist". */
  playlistId?: string
}

/** One track row with its right-click menu. Positioning is up to the list. */
export default function TrackRow({
  track,
  index,
  position,
  isCurrent,
  playing,
  onPlay,
  context,
  style,
  className = '',
  note,
  showAlbum = true,
  mixed = false
}: {
  track: Track
  index: number
  /** Position in the full list when the shown list is filtered (playlist removal). */
  position?: number
  isCurrent: boolean
  playing: boolean
  onPlay: () => void
  context?: RowContext
  style?: React.CSSProperties
  className?: string
  /** A small label after the title (e.g. why a search result matched). */
  note?: React.ReactNode
  /** Show the Album column (hidden when no track in the list has one). */
  showAlbum?: boolean
  /** The list mixes services: show a small source dot after the title. */
  mixed?: boolean
}): React.JSX.Element {
  const playable = isPlayable(track)
  const reason =
    !playable && track.availability && track.availability !== 'full'
      ? UNPLAYABLE_REASON[track.availability]
      : undefined

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          role="listitem"
          onDoubleClick={onPlay}
          title={reason}
          className={`${showAlbum ? ROW_GRID : ROW_GRID_NO_ALBUM} group rounded-lg transition-colors duration-[140ms] hover:bg-raised/70 data-[state=open]:bg-raised ${playable ? '' : 'opacity-50'} ${className}`}
          style={{ height: ROW_HEIGHT, ...style }}
        >
          <span className="relative flex justify-end text-text-subdued tabular-nums">
            <span className={`group-hover:invisible ${isCurrent ? 'text-accent' : ''}`}>
              {isCurrent && playing ? <EqBars /> : index + 1}
            </span>
            {/* On the song that's playing, the button pauses and resumes it instead of
                starting it over. */}
            <button
              aria-label={isCurrent && playing ? `Pause ${track.title}` : `Play ${track.title}`}
              onClick={() => {
                if (!isCurrent) onPlay()
                else if (playing) playback.pause()
                else void playback.play()
              }}
              className="invisible absolute inset-y-0 right-0 flex items-center text-text group-hover:visible"
            >
              {isCurrent && playing ? (
                <Pause size={16} fill="currentColor" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
            </button>
          </span>
          <span className="flex min-w-0 items-center gap-3">
            <Artwork src={track.artworkUrl} size={40} />
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`truncate ${isCurrent ? 'text-accent' : 'text-text'}`}>
                  {track.provider === 'soundcloud' ? (
                    <EntityLinks
                      names={[track.title]}
                      refs={[{ id: track.id, name: track.title }]}
                      kind="track"
                    />
                  ) : (
                    track.title
                  )}
                </span>
                {mixed && <SourceDot provider={track.provider} />}
                {note}
                {reason && (
                  <span className="flex-none rounded-sm bg-raised px-1.5 text-xs text-text-subdued">
                    {reason}
                  </span>
                )}
              </span>
              <span className="flex items-center text-sm text-text-subdued">
                <EntityLinks names={track.artists} refs={track.artistRefs} className="truncate" />
              </span>
            </span>
          </span>
          {showAlbum && (
            <span className="truncate text-sm text-text-subdued">
              {track.album && track.albumRef ? (
                <EntityLinks names={[track.album]} refs={[track.albumRef]} kind="album" />
              ) : (
                track.album
              )}
            </span>
          )}
          <span className="flex items-center justify-end gap-2 text-sm text-text-subdued tabular-nums">
            <DownloadButton track={track} />
            {formatTime(track.durationMs)}
          </span>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={MENU}>
          <MenuItem onSelect={onPlay}>Play</MenuItem>
          <MenuItem onSelect={() => playback.playNext([track])}>Play next</MenuItem>
          <MenuItem onSelect={() => playback.addToQueue([track])}>Add to queue</MenuItem>
          <ContextMenu.Separator className="my-1 h-px bg-divider" />
          <AddToPlaylistMenu track={track} />
          {context?.playlistId && (
            <MenuItem
              onSelect={() =>
                void usePlaylists.getState().removeAt(context.playlistId!, [position ?? index])
              }
            >
              Remove from this playlist
            </MenuItem>
          )}
          {track.provider !== 'local' && <LikeMenuItem track={track} />}
          {track.provider === 'soundcloud' && <DownloadMenuItem track={track} />}
          {track.provider === 'soundcloud' && (
            <MenuItem onSelect={() => useTitleFix.getState().open(track)}>
              Fix artist and title…
            </MenuItem>
          )}
          <BackgroundMenu track={track} />
          {track.provider === 'local' && (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-divider" />
              <MenuItem onSelect={() => useTagEditor.getState().editTrack(track)}>
                Edit tags…
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  useTagEditor.getState().editFolder(track, useLibrary.getState().tracks)
                }
              >
                Edit tags for this folder…
              </MenuItem>
            </>
          )}
          <ContextMenu.Separator className="my-1 h-px bg-divider" />
          {(['spotify', 'soundcloud'] as const)
            .filter((service) => service !== track.provider)
            .map((service) => (
              <MenuItem key={service} onSelect={() => void useFind.getState().find(track, service)}>
                Find on {SERVICE_NAME[service]}
              </MenuItem>
            ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

const MENU = 'glass-strong z-50 min-w-52 max-w-72 rounded-xl p-1 text-md'

function MenuItem({
  children,
  onSelect
}: {
  children: React.ReactNode
  onSelect: () => void
}): React.JSX.Element {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      className="flex items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-raised-hover"
    >
      {children}
    </ContextMenu.Item>
  )
}

/**
 * "Add to playlist" submenu: a new playlist, your app playlists (any source), and
 * playlists you can edit on the track's own service.
 */
function AddToPlaylistMenu({ track }: { track: Track }): React.JSX.Element {
  const app = usePlaylists((s) => s.app)
  const createWith = usePlaylists((s) => s.create)
  const addTracks = usePlaylists((s) => s.addTracks)
  const setView = useUi((s) => s.setView)
  const service = track.provider === 'local' ? null : track.provider
  const useStore = serviceStore(service ?? 'spotify')
  // Select the stable list, then filter: a selector returning a new array each time
  // makes zustand re-render forever.
  const loaded = useStore((s) => s.playlists)
  const servicePlaylists = useMemo(
    () => (service && loaded.state === 'ok' ? loaded.data.filter((p) => p.canEdit) : []),
    [service, loaded]
  )

  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className="flex items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-raised-hover data-[state=open]:bg-white/10">
        Add to playlist
        <ChevronRight size={14} className="ml-auto text-text-subdued" />
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent className={`${MENU} max-h-80 overflow-y-auto`}>
          <MenuItem
            onSelect={() =>
              void createWith('New playlist', [track]).then((p) => {
                if (p) setView(`playlist:${p.id}`)
              })
            }
          >
            <Plus size={14} />
            New playlist
          </MenuItem>
          {app.length > 0 && <ContextMenu.Separator className="my-1 h-px bg-divider" />}
          {app.map((p) => (
            <MenuItem key={p.id} onSelect={() => void addTracks(p.id, [track])}>
              <span className="truncate">{p.name}</span>
            </MenuItem>
          ))}
          {servicePlaylists.length > 0 && (
            <ContextMenu.Separator className="my-1 h-px bg-divider" />
          )}
          {servicePlaylists.map((p) => (
            <MenuItem key={p.id} onSelect={() => void addTracks(p.id, [track])}>
              <SourceBadge provider={track.provider} />
              <span className="truncate">{p.name}</span>
            </MenuItem>
          ))}
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  )
}

function LikeMenuItem({ track }: { track: Track }): React.JSX.Element {
  const useStore = serviceStore(track.provider === 'soundcloud' ? 'soundcloud' : 'spotify')
  const liked = useStore((s) => s.liked[track.id] ?? false)
  const setLiked = useStore((s) => s.setLiked)
  return (
    <MenuItem onSelect={() => void setLiked(track, !liked).catch(() => undefined)}>
      {liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
    </MenuItem>
  )
}

function DownloadMenuItem({ track }: { track: Track }): React.JSX.Element {
  const item = useDownloads((s) => s.byScId[track.nativeId])
  const enqueue = useDownloads((s) => s.enqueue)
  const retry = useDownloads((s) => s.retry)
  const setView = useUi((s) => s.setView)
  if (!item) return <MenuItem onSelect={() => void enqueue(track)}>Download</MenuItem>
  if (item.status === 'failed')
    return <MenuItem onSelect={() => void retry(item.id)}>Retry download</MenuItem>
  return (
    <MenuItem onSelect={() => setView('downloads')}>
      {item.status === 'done' ? 'Show in Downloads' : 'Downloading…'}
    </MenuItem>
  )
}

/** Static "now playing" glyph. No idle animation. */
