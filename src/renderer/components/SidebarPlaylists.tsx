import * as ContextMenu from '@radix-ui/react-context-menu'
import { ListMusic } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Playlist } from '@shared/types'
import { orderPlaylists, reorder } from '@renderer/lib/playlistOrder'
import { SERVICE_NAME } from '@renderer/lib/services'
import { usePlaylistPrefs } from '@renderer/state/playlistPrefs'
import { useAllPlaylists } from '@renderer/state/allPlaylists'
import { useUi } from '@renderer/state/ui'
import SourceBadge from './SourceBadge'
import PlayingMark from './PlayingMark'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Second line under a playlist name: owner for service playlists, size for app ones. */
export function PlaylistDetail({ p }: { p: Playlist }): React.JSX.Element {
  if (p.source === 'app') return <>{plural(p.trackCount ?? 0, 'track')}</>
  return (
    <span className="flex items-center gap-1.5">
      <SourceBadge provider={p.source} />
      <span className="truncate">Playlist · {p.ownerName ?? SERVICE_NAME[p.source]}</span>
    </span>
  )
}

export function PlaylistCover({ p, size = 20 }: { p: Playlist; size?: number }): React.JSX.Element {
  return p.artworkUrl ? (
    <img
      src={p.artworkUrl}
      alt=""
      loading="lazy"
      className="size-full object-cover"
      draggable={false}
    />
  ) : (
    <ListMusic size={size} />
  )
}

function Item({
  p,
  onDragEnd,
  compact
}: {
  p: Playlist
  onDragEnd: () => void
  compact?: boolean
}): React.JSX.Element {
  const view = `playlist:${p.id}` as const
  const active = useUi((s) => s.view === view)
  const setView = useUi((s) => s.setView)
  const setHidden = usePlaylistPrefs((s) => s.setHidden)
  const controls = useDragControls()
  // A drag that ends over the item must not also count as a click.
  const dragged = useRef(false)
  return (
    <Reorder.Item
      value={p.id}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => (dragged.current = true)}
      onDragEnd={onDragEnd}
      className="relative list-none"
      whileDrag={{ scale: 1.02, zIndex: 10 }}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <button
            onPointerDown={(e) => {
              dragged.current = false
              controls.start(e)
            }}
            onClick={() => {
              if (!dragged.current) setView(view)
            }}
            aria-current={active ? 'page' : undefined}
            aria-label={compact ? p.name : undefined}
            title={compact ? p.name : undefined}
            className={`flex w-full touch-none items-center gap-3 rounded-lg text-left transition-colors duration-[140ms] ${
              compact ? 'justify-center p-1.5' : 'px-2 py-1.5'
            } ${
              active
                ? 'bg-raised text-text'
                : 'text-text-subdued hover:bg-raised/60 hover:text-text'
            }`}
          >
            <span className="flex size-10 flex-none items-center justify-center overflow-hidden rounded-md bg-raised">
              <PlaylistCover p={p} />
            </span>
            {!compact && (
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-text">{p.name}</span>
                <span className="block truncate text-sm text-text-subdued">
                  <PlaylistDetail p={p} />
                </span>
              </span>
            )}
            {!compact && <PlayingMark view={view} />}
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="glass-strong z-50 min-w-48 rounded-xl p-1 text-md">
            <ContextMenu.Item
              onSelect={() => setView(view)}
              className="cursor-default rounded-md px-3 py-2 outline-none data-[highlighted]:bg-raised-hover"
            >
              Open
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={() => void setHidden(p.id, true)}
              className="cursor-default rounded-md px-3 py-2 outline-none data-[highlighted]:bg-raised-hover"
            >
              Hide from sidebar
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={() => setView('library')}
              className="cursor-default rounded-md px-3 py-2 outline-none data-[highlighted]:bg-raised-hover"
            >
              Show all in Library
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </Reorder.Item>
  )
}

/** Sidebar playlists: one list for all sources, in your order, hidden ones left out. Drag to reorder. */
export default function SidebarPlaylists({ compact }: { compact?: boolean }): React.JSX.Element {
  const all = useAllPlaylists()
  const prefs = usePlaylistPrefs((s) => s.prefs)
  const hidden = usePlaylistPrefs((s) => s.hidden)
  const save = usePlaylistPrefs((s) => s.save)
  const ordered = useMemo(() => orderPlaylists(all, prefs), [all, prefs])
  const visible = useMemo(() => ordered.filter((p) => !hidden.has(p.id)), [ordered, hidden])
  const byId = useMemo(() => new Map(visible.map((p) => [p.id, p])), [visible])

  // Local order while dragging; reset from the saved order otherwise.
  const [ids, setIds] = useState<string[]>(() => visible.map((p) => p.id))
  const visibleKey = visible.map((p) => p.id).join('|')
  const [syncedKey, setSyncedKey] = useState(visibleKey)
  if (syncedKey !== visibleKey) {
    setSyncedKey(visibleKey)
    setIds(visible.map((p) => p.id))
  }

  const commit = (): void => {
    if (ids.join('|') === visibleKey) return
    void save({ ...prefs, order: reorder(ordered, hidden, ids, prefs.order) })
  }

  const load = usePlaylistPrefs((s) => s.load)
  const loaded = usePlaylistPrefs((s) => s.loaded)
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const hiddenCount = ordered.length - visible.length
  return (
    <>
      <Reorder.Group axis="y" values={ids} onReorder={setIds} className="m-0 p-0">
        {ids.map((id) => {
          const p = byId.get(id)
          return p ? <Item key={id} p={p} compact={compact} onDragEnd={commit} /> : null
        })}
      </Reorder.Group>
      {hiddenCount > 0 && !compact && <HiddenLink count={hiddenCount} />}
    </>
  )
}

function HiddenLink({ count }: { count: number }): React.JSX.Element {
  const setView = useUi((s) => s.setView)
  return (
    <button
      onClick={() => setView('library')}
      className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-text-subdued transition-colors duration-[140ms] hover:bg-raised/60 hover:text-text"
    >
      {plural(count, 'hidden playlist')} in Library
    </button>
  )
}
