import { Film, ImagePlus, Trash2 } from 'lucide-react'
import { playerMediaUrl, type PlayerMedia, type PlayerMediaScope } from '@shared/player'
import { usePlayback } from '@renderer/state/player'
import { usePlayerPage, type PlayerParts } from '@renderer/state/playerPage'
import Switch from './Switch'

const ghost =
  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text disabled:opacity-40'

function scopeLabel(s: PlayerMediaScope): string {
  if (s.type === 'all') return 'Every song'
  if (s.type === 'song') return `Song: ${s.title}`
  if (s.type === 'artist') return `Artist: ${s.name}`
  return `Album: ${s.name}${s.artist ? ` (${s.artist})` : ''}`
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

function MediaRow({ m }: { m: PlayerMedia }): React.JSX.Element {
  const remove = usePlayerPage((s) => s.remove)
  const setScope = usePlayerPage((s) => s.setScope)
  const track = usePlayback((s) => s.current?.track ?? null)
  const artist = track?.artists[0]
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="relative h-12 w-20 flex-none overflow-hidden rounded-md bg-raised">
        {m.kind === 'video' ? (
          <>
            <video
              src={playerMediaUrl(m)}
              muted
              preload="metadata"
              className="size-full object-cover"
            />
            <Film size={12} className="absolute right-1 bottom-1 text-white drop-shadow" />
          </>
        ) : (
          <img src={playerMediaUrl(m)} alt="" className="size-full object-cover" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{m.name}</span>
        <span className="block truncate text-xs text-text-muted">
          {scopeLabel(m.scope)} · {sizeLabel(m.size)}
        </span>
      </span>
      <select
        aria-label={`Show ${m.name} for`}
        value={m.scope.type}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'all') void setScope(m.id, { type: 'all' })
          else if (v === 'artist' && artist) void setScope(m.id, { type: 'artist', name: artist })
          else if (v === 'album' && track?.album)
            void setScope(m.id, { type: 'album', name: track.album, artist })
        }}
        className="rounded-md bg-raised px-2 py-1 text-sm text-text outline-none"
        title="Artist and album use the song that's playing"
      >
        <option value="all">Every song</option>
        {m.scope.type === 'song' && <option value="song">{m.scope.title}</option>}
        <option value="artist" disabled={!artist && m.scope.type !== 'artist'}>
          {m.scope.type === 'artist' ? m.scope.name : artist ? `Artist: ${artist}` : 'Artist'}
        </option>
        <option value="album" disabled={!track?.album && m.scope.type !== 'album'}>
          {m.scope.type === 'album'
            ? m.scope.name
            : track?.album
              ? `Album: ${track.album}`
              : 'Album'}
        </option>
      </select>
      <button className={ghost} aria-label={`Remove ${m.name}`} onClick={() => void remove(m.id)}>
        <Trash2 size={14} />
      </button>
    </li>
  )
}

const PARTS: { key: keyof PlayerParts; label: string }[] = [
  { key: 'artist', label: 'Artist info' },
  { key: 'lyrics', label: 'Lyrics' },
  { key: 'queue', label: 'Up next' },
  { key: 'visualizer', label: 'Level bars' }
]

/** Settings → Player: backgrounds (every song, an artist, an album) and page parts. */
export default function PlayerMediaSection(): React.JSX.Element {
  const media = usePlayerPage((s) => s.media)
  const error = usePlayerPage((s) => s.error)
  const add = usePlayerPage((s) => s.add)
  const parts = usePlayerPage((s) => s.parts)
  const setPart = usePlayerPage((s) => s.setPart)
  const track = usePlayback((s) => s.current?.track ?? null)
  const artist = track?.artists[0]
  const total = media.reduce((n, m) => n + m.size, 0)

  return (
    <section className="settings-card">
      <h2 className="text-lg font-bold">Player</h2>
      <p className="mt-1 text-sm text-text-subdued">
        Pictures and videos behind the Player page. One set for an album wins over one for its
        artist, which wins over every song. Videos: MP4 (H.264) or WebM.
      </p>
      <div className="mt-3 flex flex-wrap gap-1">
        <button className={ghost} onClick={() => void add({ type: 'all' })}>
          <ImagePlus size={14} /> Add for every song
        </button>
        <button
          className={ghost}
          disabled={!artist}
          onClick={() => artist && void add({ type: 'artist', name: artist })}
        >
          <ImagePlus size={14} /> {artist ? `Add for ${artist}` : 'Add for an artist (play one)'}
        </button>
        {track?.album && (
          <button
            className={ghost}
            onClick={() => void add({ type: 'album', name: track.album!, artist })}
          >
            <ImagePlus size={14} /> Add for {track.album}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {media.length > 0 && (
        <>
          <ul className="mt-2 divide-y divide-divider">
            {media.map((m) => (
              <MediaRow key={m.id} m={m} />
            ))}
          </ul>
          <p className="mt-1 text-xs text-text-muted">{sizeLabel(total)} in your data folder</p>
        </>
      )}
      <p className="mt-5 text-sm font-semibold text-text-subdued">Show on the page</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {PARTS.map((p) => (
          <label
            key={p.key}
            className="flex items-center justify-between rounded-lg bg-raised px-3 py-2 text-sm"
          >
            {p.label}
            <Switch label={p.label} checked={parts[p.key]} onChange={(on) => setPart(p.key, on)} />
          </label>
        ))}
      </div>
    </section>
  )
}
