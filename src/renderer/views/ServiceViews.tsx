import { Copy, Heart, ImageOff, ListMusic, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ServiceProvider } from '@shared/ipc'
import type { Provider } from '@shared/types'
import { serviceStore, useSoundCloud, useSpotify } from '@renderer/state/services'
import { useLikes } from '@renderer/state/likes'
import { usePlaylists } from '@renderer/state/playlists'
import { useUi } from '@renderer/state/ui'
import MoreMenu, { type MoreMenuItem } from '@renderer/components/MoreMenu'
import CoverPicker from '@renderer/components/CoverPicker'
import { useTransfer } from '@renderer/state/transfer'
import { SERVICE_NAME } from '@renderer/lib/services'
import CollectionView, { Message, PrimaryButton } from '@renderer/components/CollectionView'
import SourceBadge from '@renderer/components/SourceBadge'
import ActivePill from '@renderer/components/ActivePill'

/** Shown instead of a service view when the account isn't usable. Null when connected. */
export function ServiceGate({ provider }: { provider: ServiceProvider }): React.JSX.Element | null {
  const spotify = useSpotify((s) => s.status)
  const soundcloud = useSoundCloud((s) => s.status)
  const status = provider === 'spotify' ? spotify : soundcloud
  const login = serviceStore(provider)((s) => s.login)
  const setView = useUi((s) => s.setView)
  const name = SERVICE_NAME[provider]
  if (!status || status.state === 'connected') return null

  if (status.state === 'disconnected' && 'hasKey' in status && !status.hasKey) {
    return (
      <Message
        title={`${name} isn't set up`}
        body="Add your Spotify Client ID in Settings → Spotify. It takes about five minutes."
      >
        <PrimaryButton onClick={() => setView('settings')}>Open Settings</PrimaryButton>
      </Message>
    )
  }
  const expired = status.state === 'expired'
  const permissions = expired && 'reason' in status && status.reason === 'permissions'
  return (
    <Message
      title={
        !expired
          ? `Connect ${name}`
          : permissions
            ? `Log in to ${name} again`
            : `Your ${name} login expired`
      }
      body={
        !expired
          ? `Log in to see your ${name} likes and playlists and play them here.`
          : permissions
            ? 'The app needs one more Spotify permission to play music here. Log in again to grant it.'
            : `Log in to ${name} again to keep your likes and playlists here.`
      }
    >
      <PrimaryButton onClick={() => void login()}>
        {expired ? 'Log in again' : `Connect ${name}`}
      </PrimaryButton>
      <button
        onClick={() => setView('settings')}
        className="rounded-md px-4 py-2 font-bold text-text-subdued hover:text-text"
      >
        Open Settings
      </button>
    </Message>
  )
}

/** Liked Songs cover: Spotify violet into SoundCloud orange, the union of both. */
export function LikedCover({ size = 72 }: { size?: number }): React.JSX.Element {
  return (
    <div className="flex size-full items-center justify-center bg-[linear-gradient(135deg,#4f3fd1_0%,#8a5cf0_45%,#ff7a2e_100%)]">
      <Heart size={size} fill="currentColor" className="text-white" />
    </div>
  )
}

type LikesFilter = 'all' | ServiceProvider

function ago(iso: string | null | undefined): string | null {
  if (!iso) return null
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(mins)) return null
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`
}

/** Every liked track from every connected service, newest like first. */
export function LikedView(): React.JSX.Element {
  const likes = useLikes((s) => s.likes)
  const sync = useLikes((s) => s.sync)
  const syncNow = useLikes((s) => s.syncNow)
  const spotifyOn = useSpotify((s) => s.status?.state === 'connected')
  const soundcloudOn = useSoundCloud((s) => s.status?.state === 'connected')
  const [filter, setFilter] = useState<LikesFilter>('all')

  const all = useMemo(() => (likes.state === 'ok' ? likes.data.map((l) => l.track) : []), [likes])
  const counts = useMemo(() => {
    const c: Record<LikesFilter, number> = { all: all.length, spotify: 0, soundcloud: 0 }
    for (const t of all) if (t.provider !== 'local') c[t.provider]++
    return c
  }, [all])
  const tracks = useMemo(
    () => (filter === 'all' ? all : all.filter((t) => t.provider === filter)),
    [all, filter]
  )

  if (!spotifyOn && !soundcloudOn && all.length === 0) {
    return (
      <div className="h-full overflow-y-auto page-fade pb-page pt-16">
        <Message
          title="Connect a service to see your likes"
          body="Liked Songs brings your Spotify and SoundCloud likes together in one list."
        >
          <SettingsButton />
        </Message>
      </div>
    )
  }

  const last = [sync?.lastSyncedAt.spotify, sync?.lastSyncedAt.soundcloud]
    .filter((d): d is string => !!d)
    .sort()
    .pop()
  const errors = Object.entries(sync?.errors ?? {}).filter(([, e]) => !!e)
  const subtitle = sync?.syncing
    ? 'Syncing with your services…'
    : errors.length > 0
      ? `Couldn't sync ${errors.map(([p]) => SERVICE_NAME[p as ServiceProvider]).join(' and ')}: showing the last saved likes`
      : last
        ? `${counts.all} songs, synced ${ago(last)}`
        : undefined

  return (
    <CollectionView
      kicker="Your likes"
      filterLabel="Search in Liked Songs"
      title="Liked Songs"
      cover={<LikedCover />}
      tracks={tracks}
      subtitle={subtitle}
      loading={likes.state === 'loading' || likes.state === 'idle'}
      error={likes.state === 'error' ? likes.error : undefined}
      toolbar={
        <>
          <div role="radiogroup" aria-label="Show likes from" className="flex gap-2">
            {(['all', 'spotify', 'soundcloud'] as const).map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={filter === f}
                onClick={() => setFilter(f)}
                className={`relative isolate flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-[140ms] ${
                  filter === f ? 'text-base' : 'bg-raised text-text-subdued hover:text-text'
                }`}
              >
                {filter === f && <ActivePill layoutId="likes-filter" />}
                {f !== 'all' && <SourceBadge provider={f} />}
                {f === 'all' ? 'All' : SERVICE_NAME[f]}
                <span className="font-medium opacity-70">{counts[f]}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => void syncNow()}
            disabled={sync?.syncing}
            aria-label="Sync likes now"
            title="Sync likes now"
            className="ml-auto flex size-9 items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:text-text disabled:opacity-40"
          >
            <RefreshCw size={18} className={sync?.syncing ? 'animate-spin' : ''} />
          </button>
        </>
      }
      empty={
        <Message
          title={filter === 'all' ? 'No liked songs yet' : `No ${SERVICE_NAME[filter]} likes yet`}
          body="Tap the heart on any Spotify or SoundCloud track to save it here."
        />
      }
    />
  )
}

function SettingsButton(): React.JSX.Element {
  const setView = useUi((s) => s.setView)
  return <PrimaryButton onClick={() => setView('settings')}>Open Settings</PrimaryButton>
}

function sourceOf(id: string): Provider | 'app' {
  return id.startsWith('app:') ? 'app' : id.startsWith('soundcloud:') ? 'soundcloud' : 'spotify'
}

export function PlaylistView({ id }: { id: string }): React.JSX.Element {
  const source = sourceOf(id)
  const isApp = source === 'app'
  const provider: ServiceProvider = source === 'soundcloud' ? 'soundcloud' : 'spotify'
  const useStore = serviceStore(provider)
  const servicePlaylist = useStore((s) =>
    s.playlists.state === 'ok' ? s.playlists.data.find((p) => p.id === id) : undefined
  )
  const appPlaylist = usePlaylists((s) => s.app.find((p) => p.id === id))
  const playlist = isApp ? appPlaylist : servicePlaylist
  const serviceLoad = useStore((s) => s.playlistTracks[id])
  const appLoad = usePlaylists((s) => s.appTracks[id])
  const load = isApp ? appLoad : serviceLoad
  const loadTracks = usePlaylists((s) => s.loadTracks)
  const connected = useStore((s) => s.status?.state === 'connected')
  const ready = isApp || connected

  useEffect(() => {
    if (ready && !load) void loadTracks(id)
  }, [ready, id, load, loadTracks])

  if (!ready) {
    return (
      <div className="h-full overflow-y-auto page-fade pb-page pt-16">
        <ServiceGate provider={provider} />
      </div>
    )
  }
  const tracks = load?.state === 'ok' ? load.data : []
  const owner = isApp
    ? 'Your playlist'
    : playlist?.ownerName
      ? `${SERVICE_NAME[provider]} playlist by ${playlist.ownerName}`
      : `${SERVICE_NAME[provider]} playlist`

  const coverImage = playlist?.artworkUrl ? (
    <img src={playlist.artworkUrl} alt="" className="size-full object-cover" />
  ) : (
    <div className="flex size-full items-center justify-center bg-raised text-text-muted">
      <ListMusic size={72} strokeWidth={1.5} />
    </div>
  )

  return (
    <CollectionView
      filterLabel="Search in playlist"
      key={id}
      kicker={owner}
      title={playlist?.name ?? 'Playlist'}
      cover={isApp ? <CoverPicker playlistId={id}>{coverImage}</CoverPicker> : coverImage}
      tracks={tracks}
      loading={!load || load.state === 'loading' || load.state === 'idle'}
      error={load?.state === 'error' ? load.error : undefined}
      rowContext={playlist?.canEdit ? { playlistId: id } : undefined}
      toolbar={
        <>
          {playlist && (
            <PlaylistActions
              id={id}
              name={playlist.name}
              isApp={isApp}
              customCover={!!playlist.customArtwork}
              copyTargets={tracks.length > 0 ? (isApp ? null : provider) : 'none'}
            />
          )}
        </>
      }
      empty={
        <Message
          title="This playlist is empty"
          body={
            isApp
              ? 'Right-click any track and choose Add to playlist to put it here.'
              : `Tracks you add on ${SERVICE_NAME[provider]} show up here.`
          }
        />
      }
    />
  )
}

/** Rename and delete for in-app playlists. */
/**
 * A playlist's less common actions behind "⋯": copy to the other service, and for
 * app playlists rename, automatic cover and delete. Rename edits inline; delete asks
 * once more inline before it happens.
 */
function PlaylistActions({
  id,
  name,
  isApp,
  customCover,
  copyTargets
}: {
  id: string
  name: string
  isApp: boolean
  customCover: boolean
  /** Service to leave out of "Copy to", null for none left out, 'none' for no copy. */
  copyTargets: ServiceProvider | null | 'none'
}): React.JSX.Element {
  const rename = usePlaylists((s) => s.rename)
  const remove = usePlaylists((s) => s.remove)
  const setView = useUi((s) => s.setView)
  const start = useTransfer((s) => s.start)
  const spotifyOn = useSpotify((s) => s.status?.state === 'connected')
  const scOn = useSoundCloud((s) => s.status?.state === 'connected')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (editing) {
    return (
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) void rename(id, draft.trim())
          setEditing(false)
        }}
      >
        <input
          autoFocus
          value={draft}
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          aria-label="Playlist name"
          className="w-64 rounded-lg bg-raised px-3 py-1.5 text-sm text-text outline-none ring-1 ring-divider focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-on-accent hover:bg-accent-hover"
        >
          Save
        </button>
      </form>
    )
  }
  if (confirmDelete) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setView('likes')
            void remove(id)
          }}
          onBlur={() => setConfirmDelete(false)}
          autoFocus
          className="rounded-lg bg-danger px-3 py-1.5 text-sm font-bold text-white"
        >
          Delete “{name}”
        </button>
        <button
          onClick={() => setConfirmDelete(false)}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-text-subdued hover:text-text"
        >
          Cancel
        </button>
      </div>
    )
  }

  const targets =
    copyTargets === 'none'
      ? []
      : (['spotify', 'soundcloud'] as const).filter(
          (t) => t !== copyTargets && (t === 'spotify' ? spotifyOn : scOn)
        )
  const items: MoreMenuItem[] = [
    ...targets.map((t) => ({
      label: `Copy to ${SERVICE_NAME[t]}`,
      icon: Copy,
      onSelect: () => start(id, name, t)
    })),
    ...(isApp
      ? [
          {
            label: 'Rename',
            icon: Pencil,
            onSelect: () => {
              setDraft(name)
              setEditing(true)
            }
          },
          ...(customCover
            ? [
                {
                  label: 'Use automatic cover',
                  icon: ImageOff,
                  onSelect: () =>
                    void window.api
                      .invoke('playlists:clearCover', id)
                      .then(() => usePlaylists.getState().refresh())
                      .catch(() => undefined)
                }
              ]
            : []),
          {
            label: 'Delete playlist…',
            icon: Trash2,
            danger: true,
            onSelect: () => setConfirmDelete(true)
          }
        ]
      : [])
  ]
  return <MoreMenu items={items} label="Playlist options" />
}
