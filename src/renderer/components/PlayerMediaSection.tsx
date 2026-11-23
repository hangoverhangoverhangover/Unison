import { Film, ImagePlus, Trash2 } from 'lucide-react'
import { playerMediaUrl, type PlayerMedia, type PlayerMediaScope } from '@shared/player'
import { usePlayback } from '@renderer/state/player'
import {
  usePlayerPage,
  SWAP_LIMITS,
  VIZ_LIMITS,
  type PlayerParts,
  type VizColor,
  type VizStyle
} from '@renderer/state/playerPage'
import ActivePill from './ActivePill'
import { ColorField, RangeField } from './CustomThemeEditor'
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

const pill = (on: boolean): string =>
  `relative isolate rounded-full px-3 py-1 text-sm font-semibold transition-colors duration-[140ms] ${
    on ? 'text-base' : 'bg-raised text-text-subdued hover:bg-raised-hover hover:text-text'
  }`

function Choice<T extends string>({
  label,
  id,
  value,
  options,
  onChange
}: {
  label: string
  id: string
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div>
      <p className="text-sm font-semibold text-text-subdued">{label}</p>
      <div role="radiogroup" aria-label={label} className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={pill(value === o.id)}
          >
            {value === o.id && <ActivePill layoutId={id} />}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const STYLES: { id: VizStyle; label: string }[] = [
  { id: 'bars', label: 'Bars' },
  { id: 'mirror', label: 'Mirrored' },
  { id: 'wave', label: 'Wave' }
]
const COLORS: { id: VizColor; label: string }[] = [
  { id: 'accent', label: 'Match theme' },
  { id: 'white', label: 'White' },
  { id: 'custom', label: 'Your colour' }
]

/** Level bar look: style, count, height, sensitivity, colour, opacity. */
function VisualizerSettings(): React.JSX.Element {
  const viz = usePlayerPage((s) => s.viz)
  const setViz = usePlayerPage((s) => s.setViz)
  return (
    <div className="mt-5 flex flex-col gap-4">
      <p className="text-sm font-semibold text-text-subdued">Level bars</p>
      <Choice
        label="Style"
        id="viz-style"
        value={viz.style}
        options={STYLES}
        onChange={(style) => setViz({ style })}
      />
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <RangeField
          label={viz.style === 'wave' ? 'Points' : 'Bars'}
          value={viz.bars}
          min={VIZ_LIMITS.bars[0]}
          max={VIZ_LIMITS.bars[1]}
          step={4}
          format={(v) => String(v)}
          onChange={(bars) => setViz({ bars })}
        />
        <RangeField
          label="Height"
          value={viz.height}
          min={VIZ_LIMITS.height[0]}
          max={VIZ_LIMITS.height[1]}
          step={4}
          format={(v) => `${v} px`}
          onChange={(height) => setViz({ height })}
        />
        <RangeField
          label="Sensitivity"
          value={viz.sensitivity}
          min={VIZ_LIMITS.sensitivity[0]}
          max={VIZ_LIMITS.sensitivity[1]}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(sensitivity) => setViz({ sensitivity })}
        />
        <RangeField
          label="Opacity"
          value={viz.opacity}
          min={VIZ_LIMITS.opacity[0]}
          max={VIZ_LIMITS.opacity[1]}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(opacity) => setViz({ opacity })}
        />
      </div>
      <Choice
        label="Colour"
        id="viz-color"
        value={viz.color}
        options={COLORS}
        onChange={(color) => setViz({ color })}
      />
      {viz.color === 'custom' && (
        <div className="flex">
          <ColorField
            label="Bar colour"
            value={viz.customColor}
            onChange={(customColor) => setViz({ customColor })}
          />
        </div>
      )}
      <label className="flex items-start justify-between gap-4 rounded-lg bg-raised px-3 py-2 text-sm">
        <span>
          <span className="block font-semibold">Bars for Spotify songs</span>
          <span className="block text-xs text-text-muted">
            Spotify&apos;s audio can&apos;t be read, so the bars listen to your PC&apos;s sound
            instead, only while the Player page shows a Spotify song. Other sounds (Discord, videos)
            move them too.
          </span>
        </span>
        <Switch
          label="Bars for Spotify songs"
          checked={viz.systemSound}
          onChange={(systemSound) => setViz({ systemSound })}
        />
      </label>
    </div>
  )
}

/** Swap between backgrounds: how long pictures stay, how often videos and GIFs play. */
function SwapSettings(): React.JSX.Element {
  const swap = usePlayerPage((s) => s.swap)
  const setSwap = usePlayerPage((s) => s.setSwap)
  return (
    <div className="mt-4 flex flex-col gap-4">
      <label className="flex items-start justify-between gap-4 rounded-lg bg-raised px-3 py-2 text-sm">
        <span>
          <span className="block font-semibold">Swap backgrounds</span>
          <span className="block text-xs text-text-muted">
            When more than one fits the song (say, three for every song), move from one to the next.
            Off: one stays for the whole song and videos loop.
          </span>
        </span>
        <Switch label="Swap backgrounds" checked={swap.on} onChange={(on) => setSwap({ on })} />
      </label>
      {swap.on && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <RangeField
            label="Pictures stay"
            value={swap.imageSeconds}
            min={SWAP_LIMITS.imageSeconds[0]}
            max={SWAP_LIMITS.imageSeconds[1]}
            step={1}
            format={(v) =>
              v >= 60 ? `${Math.floor(v / 60)} min ${v % 60 ? `${v % 60} s` : ''}`.trim() : `${v} s`
            }
            onChange={(imageSeconds) => setSwap({ imageSeconds })}
          />
          <RangeField
            label="Videos and GIFs play"
            value={swap.plays}
            min={SWAP_LIMITS.plays[0]}
            max={SWAP_LIMITS.plays[1]}
            step={1}
            format={(v) => (v === 1 ? 'once' : `${v} times`)}
            onChange={(plays) => setSwap({ plays })}
          />
        </div>
      )}
    </div>
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
      <SwapSettings />
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
      {parts.visualizer && <VisualizerSettings />}
    </section>
  )
}
