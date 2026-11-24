import { Film, ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { playerMediaUrl, type PlayerMedia, type PlayerMediaScope } from '@shared/player'
import { usePlayback } from '@renderer/state/player'
import {
  usePlayerPage,
  BUILTIN_PRESETS,
  MAX_EXTRA_LAYERS,
  vizLayers,
  SWAP_LIMITS,
  VIZ_LIMITS,
  type PlayerParts,
  type ShaderPreset,
  type VizColor,
  type VizLayer,
  type VizPlacement,
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
  { id: 'wave', label: 'Wave' },
  { id: 'radial', label: 'Ring' },
  { id: 'circle', label: 'Circular wave' },
  { id: 'particles', label: 'Particles' },
  { id: 'spectrogram', label: 'Spectrogram' },
  { id: 'shader', label: 'Shader' }
]
const PLACEMENTS: { id: VizPlacement; label: string }[] = [
  { id: 'bottom', label: 'Bottom' },
  { id: 'cover', label: 'Around the cover' },
  { id: 'background', label: 'Full background' },
  { id: 'lyrics', label: 'Behind the lyrics' }
]
const COLORS: { id: VizColor; label: string }[] = [
  { id: 'accent', label: 'Match theme' },
  { id: 'white', label: 'White' },
  { id: 'custom', label: 'Your colours' }
]
const SHADERS: { id: ShaderPreset; label: string }[] = [
  { id: 'liquid', label: 'Liquid' },
  { id: 'kaleidoscope', label: 'Kaleidoscope' },
  { id: 'warp', label: 'Warp' }
]
const FPS: { id: '30' | '60'; label: string }[] = [
  { id: '60', label: '60 fps' },
  { id: '30', label: '30 fps (lighter)' }
]

const pct = (v: number): string => `${Math.round(v * 100)}%`

/** A setting that's on or off, with a line saying what it does. */
function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex items-start justify-between gap-4 rounded-lg bg-raised px-3 py-2 text-sm">
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-xs text-text-muted">{hint}</span>}
      </span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </label>
  )
}

function Heading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mt-2 text-sm font-semibold text-text-subdued">{children}</p>
}

/** Ready-made looks and your own saved ones. */
function Presets(): React.JSX.Element {
  const presets = usePlayerPage((s) => s.presets)
  const choose = usePlayerPage((s) => s.choosePreset)
  const save = usePlayerPage((s) => s.savePreset)
  const remove = usePlayerPage((s) => s.deletePreset)
  const [name, setName] = useState('')
  return (
    <div>
      <p className="text-sm font-semibold text-text-subdued">Presets</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {BUILTIN_PRESETS.map((p) => (
          <button key={p.name} onClick={() => choose(p)} className={pill(false)}>
            {p.name}
          </button>
        ))}
        {presets.map((p) => (
          <span key={p.name} className="flex items-center rounded-full bg-raised">
            <button
              onClick={() => choose(p)}
              className="rounded-l-full py-1.5 pr-1 pl-3 text-sm font-semibold text-text-subdued hover:text-text"
            >
              {p.name}
            </button>
            <button
              onClick={() => remove(p.name)}
              aria-label={`Delete preset ${p.name}`}
              title="Delete"
              className="rounded-r-full py-1.5 pr-2.5 pl-1 text-text-muted hover:text-text"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          save(name)
          setName('')
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Name this look to save it"
          aria-label="Preset name"
          className="min-w-0 flex-1 rounded-lg bg-raised px-3 py-1.5 text-sm text-text outline-none ring-1 ring-divider placeholder:text-text-muted focus:ring-2 focus:ring-accent"
        />
        <button type="submit" disabled={!name.trim()} className={ghost}>
          Save preset
        </button>
      </form>
    </div>
  )
}

/** Everything about the Player page's visualizer and its beat and bass effects. */
function VisualizerSettings(): React.JSX.Element {
  const viz = usePlayerPage((s) => s.viz)
  const setViz = usePlayerPage((s) => s.setViz)
  const L = VIZ_LIMITS
  const layers = vizLayers(viz)
  const uses = (...styles: VizStyle[]): boolean => layers.some((l) => styles.includes(l.style))
  const placed = (p: VizPlacement): boolean => layers.some((l) => l.placement === p)
  const barStyle = uses('bars', 'mirror', 'radial')
  const setExtra = (i: number, patch: Partial<VizLayer>): void =>
    setViz({ extraLayers: viz.extraLayers.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  return (
    <div className="mt-5 flex flex-col gap-4">
      <p className="text-sm font-semibold text-text-subdued">Visualizer</p>
      <Presets />
      <Choice
        label="Style"
        id="viz-style"
        value={viz.style}
        options={STYLES}
        onChange={(style) => setViz({ style })}
      />
      <Choice
        label="Where"
        id="viz-place"
        value={viz.placement}
        options={PLACEMENTS}
        onChange={(placement) => setViz({ placement })}
      />

      {viz.extraLayers.map((layer, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg bg-raised/60 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Style {i + 2}</p>
            <button
              onClick={() => setViz({ extraLayers: viz.extraLayers.filter((_, j) => j !== i) })}
              className={ghost}
            >
              <Trash2 size={14} /> Remove
            </button>
          </div>
          <Choice
            label="Style"
            id={`viz-style-${i}`}
            value={layer.style}
            options={STYLES}
            onChange={(style) => setExtra(i, { style })}
          />
          <Choice
            label="Where"
            id={`viz-place-${i}`}
            value={layer.placement}
            options={PLACEMENTS}
            onChange={(placement) => setExtra(i, { placement })}
          />
          <RangeField
            label="Opacity"
            value={layer.opacity}
            min={L.opacity[0]}
            max={L.opacity[1]}
            step={0.05}
            format={pct}
            onChange={(opacity) => setExtra(i, { opacity })}
          />
        </div>
      ))}
      {viz.extraLayers.length < MAX_EXTRA_LAYERS && (
        <button
          onClick={() =>
            setViz({
              extraLayers: [
                ...viz.extraLayers,
                {
                  style: viz.style === 'bars' ? 'shader' : 'bars',
                  placement: viz.placement === 'bottom' ? 'background' : 'bottom',
                  opacity: 0.8
                }
              ]
            })
          }
          className={`${ghost} self-start`}
        >
          <Plus size={14} /> Add another style
        </button>
      )}
      {placed('cover') && (
        <Toggle
          label="Round cover"
          hint="Make the cover round while a style sits around it, so a ring hugs it."
          checked={viz.roundCover}
          onChange={(roundCover) => setViz({ roundCover })}
        />
      )}

      <Heading>Size and feel</Heading>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {uses('bars', 'mirror', 'wave', 'radial') && (
          <RangeField
            label="Bars"
            value={viz.bars}
            min={L.bars[0]}
            max={L.bars[1]}
            step={4}
            format={(v) => String(v)}
            onChange={(bars) => setViz({ bars })}
          />
        )}
        {placed('bottom') && (
          <RangeField
            label="Height"
            value={viz.height}
            min={L.height[0]}
            max={L.height[1]}
            step={4}
            format={(v) => `${v} px`}
            onChange={(height) => setViz({ height })}
          />
        )}
        <RangeField
          label="Sensitivity"
          value={viz.sensitivity}
          min={L.sensitivity[0]}
          max={L.sensitivity[1]}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(sensitivity) => setViz({ sensitivity })}
        />
        <RangeField
          label={viz.extraLayers.length ? 'Opacity (style 1)' : 'Opacity'}
          value={viz.opacity}
          min={L.opacity[0]}
          max={L.opacity[1]}
          step={0.05}
          format={pct}
          onChange={(opacity) => setViz({ opacity })}
        />
        <RangeField
          label="Smoothing"
          value={viz.smoothing}
          min={L.smoothing[0]}
          max={L.smoothing[1]}
          step={0.05}
          format={(v) => (v < 0.4 ? `Snappy (${pct(v)})` : v > 0.8 ? `Fluid (${pct(v)})` : pct(v))}
          onChange={(smoothing) => setViz({ smoothing })}
        />
        <RangeField
          label="Trails"
          value={viz.trails}
          min={L.trails[0]}
          max={L.trails[1]}
          step={0.05}
          format={(v) => (v === 0 ? 'Off' : pct(v))}
          onChange={(trails) => setViz({ trails })}
        />
        <RangeField
          label="Glow"
          value={viz.glow}
          min={L.glow[0]}
          max={L.glow[1]}
          step={0.05}
          format={(v) => (v === 0 ? 'Off' : pct(v))}
          onChange={(glow) => setViz({ glow })}
        />
      </div>
      <Choice
        label="Frame rate"
        id="viz-fps"
        value={String(viz.fps) as '30' | '60'}
        options={FPS}
        onChange={(v) => setViz({ fps: v === '30' ? 30 : 60 })}
      />
      <Toggle
        label="Musical frequency scale"
        hint="Spread the bars over octaves, so bass and mids get more of them. Off: even over Hz (the right side is mostly treble)."
        checked={viz.logScale}
        onChange={(logScale) => setViz({ logScale })}
      />
      {(barStyle || uses('wave')) && (
        <>
          <Toggle
            label="Peak caps"
            hint="A small cap sits on each bar's peak and falls slowly, like a hi-fi meter."
            checked={viz.peaks}
            onChange={(peaks) => setViz({ peaks })}
          />
          {viz.peaks && (
            <RangeField
              label="Caps fall"
              value={viz.peakFall}
              min={L.peakFall[0]}
              max={L.peakFall[1]}
              step={0.1}
              format={(v) => (v < 0.6 ? 'Slowly' : v > 1.8 ? 'Fast' : 'Medium')}
              onChange={(peakFall) => setViz({ peakFall })}
            />
          )}
        </>
      )}

      {uses('particles') && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <RangeField
            label="Particles"
            value={viz.particleCount}
            min={L.particleCount[0]}
            max={L.particleCount[1]}
            step={10}
            format={(v) => String(v)}
            onChange={(particleCount) => setViz({ particleCount })}
          />
          <RangeField
            label="Speed"
            value={viz.particleSpeed}
            min={L.particleSpeed[0]}
            max={L.particleSpeed[1]}
            step={0.25}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(particleSpeed) => setViz({ particleSpeed })}
          />
        </div>
      )}
      {uses('spectrogram') && (
        <RangeField
          label="Scroll speed"
          value={viz.spectrogramSpeed}
          min={L.spectrogramSpeed[0]}
          max={L.spectrogramSpeed[1]}
          step={1}
          format={(v) => `${v} px a frame`}
          onChange={(spectrogramSpeed) => setViz({ spectrogramSpeed })}
        />
      )}
      {uses('circle') && (
        <RangeField
          label="Rings"
          value={viz.circleRings}
          min={L.circleRings[0]}
          max={L.circleRings[1]}
          step={1}
          format={(v) => String(v)}
          onChange={(circleRings) => setViz({ circleRings })}
        />
      )}
      {uses('shader') && (
        <>
          <Choice
            label="Effect"
            id="viz-shader"
            value={viz.shaderPreset}
            options={SHADERS}
            onChange={(shaderPreset) => setViz({ shaderPreset })}
          />
          <RangeField
            label="Intensity"
            value={viz.shaderIntensity}
            min={L.shaderIntensity[0]}
            max={L.shaderIntensity[1]}
            step={0.05}
            format={(v) => (v < 0.3 ? `Calm (${pct(v)})` : v > 0.7 ? `Wild (${pct(v)})` : pct(v))}
            onChange={(shaderIntensity) => setViz({ shaderIntensity })}
          />
        </>
      )}

      <Choice
        label="Colour"
        id="viz-color"
        value={viz.color}
        options={COLORS}
        onChange={(color) => setViz({ color })}
      />
      <Toggle
        label="Gradient"
        hint={
          viz.color === 'custom'
            ? 'Fade from your first colour to your second.'
            : 'Fade between two colours: the cover’s two main colours in the artwork theme, else the accent and a neighbour of it.'
        }
        checked={viz.gradient}
        onChange={(gradient) => setViz({ gradient })}
      />
      {viz.color === 'custom' && (
        <div className="flex flex-wrap gap-2">
          <ColorField
            label="Colour"
            value={viz.customColor}
            onChange={(customColor) => setViz({ customColor })}
          />
          {viz.gradient && (
            <ColorField
              label="Second colour"
              value={viz.customColor2}
              onChange={(customColor2) => setViz({ customColor2 })}
            />
          )}
        </div>
      )}

      <Heading>Beat and bass</Heading>
      <Toggle
        label="Beat detection"
        hint="Find the kicks in the bass. The effects below follow them."
        checked={viz.beat}
        onChange={(beat) => setViz({ beat })}
      />
      {viz.beat && (
        <>
          <RangeField
            label="Beat sensitivity"
            value={viz.beatSensitivity}
            min={L.beatSensitivity[0]}
            max={L.beatSensitivity[1]}
            step={0.1}
            format={(v) =>
              v < 0.8 ? 'Big kicks only' : v > 1.5 ? 'Every small one' : `${v.toFixed(1)}×`
            }
            onChange={(beatSensitivity) => setViz({ beatSensitivity })}
          />
          <Toggle
            label="Cover bumps"
            hint="The cover grows a little on each beat."
            checked={viz.beatCover}
            onChange={(beatCover) => setViz({ beatCover })}
          />
          <Toggle
            label="Background flash"
            hint="The background flashes and zooms a little on each beat."
            checked={viz.beatFlash}
            onChange={(beatFlash) => setViz({ beatFlash })}
          />
          <Toggle
            label="Bars kick"
            hint="The visualizer jumps up on each beat."
            checked={viz.beatKick}
            onChange={(beatKick) => setViz({ beatKick })}
          />
        </>
      )}
      <Toggle
        label="Background breathes with the bass"
        hint="Your picture or the blurred cover swells and brightens with the low end."
        checked={viz.bassBackground}
        onChange={(bassBackground) => setViz({ bassBackground })}
      />
      {viz.bassBackground && (
        <RangeField
          label="How much"
          value={viz.bassAmount}
          min={L.bassAmount[0]}
          max={L.bassAmount[1]}
          step={0.05}
          format={pct}
          onChange={(bassAmount) => setViz({ bassAmount })}
        />
      )}

      <Heading>Spotify</Heading>
      <Toggle
        label="Visualizer for Spotify songs"
        hint="Spotify's audio can't be read, so the visualizer listens to your PC's sound instead, only while the Player page shows a Spotify song. Other sounds (Discord, videos) move it too."
        checked={viz.systemSound}
        onChange={(systemSound) => setViz({ systemSound })}
      />
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
  { key: 'visualizer', label: 'Visualizer' }
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
