import * as ContextMenu from '@radix-ui/react-context-menu'
import { ExternalLink, ImagePlus, Maximize, Minimize } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { LastfmArtist } from '@shared/lastfm'
import { mediaFor, pickFor, playerMediaUrl, scopesFor, type PlayerMedia } from '@shared/player'
import type { Artist, Track } from '@shared/types'
import { playback } from '@renderer/playback/controller'
import { readSpectrum, SPECTRUM_BINS } from '@renderer/playback/audioGraph'
import { usePlayback } from '@renderer/state/player'
import { useLyrics } from '@renderer/state/lyrics'
import { usePlayerPage, type VizSettings } from '@renderer/state/playerPage'
import { useUi } from '@renderer/state/ui'
import { useLyricPosition } from '@renderer/lib/useLyricPosition'
import { useFullscreen } from '@renderer/lib/useFullscreen'
import { artColor } from '@renderer/lib/artColor'
import { readSystemSpectrum, startSystemSound, stopSystemSound } from '@renderer/lib/systemSound'
import { useAppearance } from '@renderer/state/appearance'
import { blur } from '@renderer/styles/tokens'
import Artwork from '@renderer/components/Artwork'

/** Your picture or video for this song, or the blurred cover. */
function Background({ track }: { track: Track | null }): React.JSX.Element {
  const media = usePlayerPage((s) => s.media)
  const pick: PlayerMedia | null = pickFor(mediaFor(media, track), track?.id ?? 'none')
  const videoRef = useRef<HTMLVideoElement>(null)

  // Videos pause while the window is hidden (no point decoding them).
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onVis = (): void => void (document.hidden ? v.pause() : v.play().catch(() => {}))
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [pick?.id])

  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden bg-base">
      {pick?.kind === 'video' ? (
        <video
          ref={videoRef}
          key={pick.id}
          src={playerMediaUrl(pick)}
          autoPlay
          loop
          muted
          playsInline
          className="size-full object-cover motion-reduce:hidden"
        />
      ) : pick ? (
        <img key={pick.id} src={playerMediaUrl(pick)} alt="" className="size-full object-cover" />
      ) : (
        track?.artworkUrl && (
          <img
            src={track.artworkUrl}
            alt=""
            className="size-full scale-125 object-cover"
            style={{ filter: `blur(${blur.ambient}px) saturate(1.3)` }}
          />
        )
      )}
      {/* Shade so the words stay readable on any picture. */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/25 to-black/70" />
    </div>
  )
}

/** Name, picture, bio, tags and links: Last.fm plus the song's service. */
function ArtistPanel({ track }: { track: Track }): React.JSX.Element | null {
  const name = track.artists[0] ?? ''
  const artistId = track.artistRefs?.[0]?.id
  const setView = useUi((s) => s.setView)
  const [info, setInfo] = useState<{
    key: string
    lastfm: LastfmArtist | null
    artist: Artist | null
  }>()
  const key = `${name}|${artistId ?? ''}`
  useEffect(() => {
    let live = true
    void Promise.all([
      window.api.invoke('lastfm:artistInfo', name).catch(() => null),
      artistId ? window.api.invoke('music:getArtistInfo', artistId).catch(() => null) : null
    ]).then(([lastfm, artist]) => live && setInfo({ key, lastfm, artist }))
    return () => {
      live = false
    }
  }, [key, name, artistId])
  if (!name) return null
  const lastfm = info?.key === key ? info.lastfm : null
  const artist = info?.key === key ? info.artist : null
  const links: { label: string; url: string }[] = []
  if (artist?.url)
    links.push({ label: track.provider === 'spotify' ? 'Spotify' : 'SoundCloud', url: artist.url })
  if (lastfm?.url) links.push({ label: 'Last.fm', url: lastfm.url })

  return (
    <section className="max-w-[360px] text-white">
      <div className="flex items-center gap-3">
        {artist?.imageUrl && (
          <img
            src={artist.imageUrl}
            alt=""
            className="size-14 rounded-full object-cover shadow-lg"
          />
        )}
        <div className="min-w-0">
          {artist ? (
            <button
              onClick={() => setView(`artist:${artist.id}`)}
              className="truncate text-left text-2xl font-black hover:underline"
            >
              {artist.name}
            </button>
          ) : (
            <p className="truncate text-2xl font-black">{name}</p>
          )}
          {(lastfm?.listeners || artist?.followers) && (
            <p className="text-sm text-white/70">
              {lastfm?.listeners
                ? `${lastfm.listeners.toLocaleString()} listeners on Last.fm`
                : `${artist!.followers!.toLocaleString()} followers`}
            </p>
          )}
        </div>
      </div>
      {lastfm?.bio && (
        <p className="mt-3 line-clamp-[10] text-sm leading-relaxed text-white/85">{lastfm.bio}</p>
      )}
      {!!lastfm?.tags.length && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {lastfm.tags.map((t) => (
            <span key={t} className="rounded-full bg-white/12 px-2 py-0.5 text-xs text-white/85">
              {t}
            </span>
          ))}
        </div>
      )}
      {links.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-semibold text-white/80 hover:text-white hover:underline"
            >
              {l.label} <ExternalLink size={12} />
            </a>
          ))}
        </div>
      )}
    </section>
  )
}

/** The whole lyrics in a column, the current line bright and bold. */
function LyricsColumn(): React.JSX.Element | null {
  const result = useLyrics((s) => s.result)
  const lines = result?.synced ?? null
  const { line } = useLyricPosition(lines)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (line < 0) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-line="${line}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [line])
  if (!lines && !result?.plain) return null
  return (
    <div
      ref={listRef}
      className="h-full w-[min(380px,32vw)] overflow-y-auto py-[20vh] text-center [mask-image:linear-gradient(transparent,#000_15%,#000_85%,transparent)] [scrollbar-width:none]"
    >
      {lines ? (
        lines.map((l, i) =>
          !l.text && i === lines.length - 1 ? null : (
            <button
              key={`${i}:${l.timeMs}`}
              data-line={i}
              onClick={() => playback.seek(l.timeMs)}
              className={`block w-full px-2 py-1 text-[15px] leading-snug transition-colors duration-300 ${
                i === line ? 'font-bold text-white' : 'text-white/55 hover:text-white/80'
              }`}
            >
              {l.text || '♪'}
            </button>
          )
        )
      ) : (
        <p className="text-[15px] leading-relaxed whitespace-pre-line text-white/80">
          {result?.plain}
        </p>
      )}
    </div>
  )
}

/**
 * What plays next. Narrow covers until you point at it: then the strip widens (the
 * page makes room) to show each song's title and artist, and the song under the
 * pointer grows, pushing the others apart. Click one to jump there.
 */
function QueueStrip(): React.JSX.Element | null {
  const queue = usePlayback((s) => s.queue)
  if (queue.length === 0) return null
  return (
    <div className="group/strip flex h-full w-16 flex-none flex-col gap-1 overflow-x-hidden overflow-y-auto pt-10 pb-2 transition-[width] duration-200 ease-out [scrollbar-width:none] hover:w-72 focus-within:w-72">
      <p className="truncate px-1 pb-1 text-xs font-bold tracking-wide text-white/70 uppercase opacity-0 transition-opacity duration-200 group-hover/strip:opacity-100 group-focus-within/strip:opacity-100">
        Up next · {queue.length}
      </p>
      {queue.slice(0, 30).map((item, i) => (
        <button
          key={item.uid}
          aria-label={`Play ${item.track.title} by ${item.track.artists.join(', ')}`}
          onClick={async () => {
            for (let k = 0; k <= i; k++) await playback.next()
          }}
          className="group/item flex w-full flex-none items-center gap-3 rounded-lg p-1 text-left transition-colors duration-200 hover:bg-black/45 focus-visible:bg-black/45 focus-visible:outline-none"
        >
          <span className="size-14 flex-none overflow-hidden rounded-md opacity-80 shadow-lg transition-[width,height,opacity] duration-200 ease-out group-hover/item:size-20 group-hover/item:opacity-100 group-focus-visible/item:size-20">
            <Artwork src={item.track.artworkUrl} size={80} fill className="size-full" />
          </span>
          <span className="min-w-0 text-white opacity-0 transition-opacity duration-200 group-hover/strip:opacity-100 group-focus-within/strip:opacity-100">
            <span className="block truncate text-sm font-semibold">{item.track.title}</span>
            <span className="block truncate text-xs text-white/70">
              {item.track.artists.join(', ') || 'Unknown artist'}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

/**
 * The bar colour: the theme's (the cover's main colour in the artwork theme, else the
 * accent), white, or your own.
 */
function vizColor(viz: VizSettings, art: string | null): string {
  if (viz.color === 'white') return '#ffffff'
  if (viz.color === 'custom') return viz.customColor
  if (art) return art
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent')
  return accent.trim() || '#7289da'
}

/**
 * Level bars from the audio (local files and SoundCloud; Spotify can't be read).
 * Style, count, height, sensitivity, colour and opacity come from Settings → Player.
 */
function Visualizer(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const viz = usePlayerPage((s) => s.viz)
  // The draw loop reads the latest settings without restarting.
  const vizRef = useRef(viz)
  useEffect(() => {
    vizRef.current = viz
  }, [viz])
  // Artwork theme: the bars take the cover's colour.
  const artTheme = useAppearance((s) => s.theme === 'artwork')
  const cover = usePlayback((s) => s.current?.track.artworkUrl)
  // Spotify songs: the PC's own sound, when that's turned on (Spotify's can't be read).
  const spotify = usePlayback((s) => s.current?.track.provider === 'spotify')
  const useSystem = spotify && viz.systemSound
  const systemRef = useRef(false)
  useEffect(() => {
    systemRef.current = useSystem
    if (!useSystem) return
    void startSystemSound()
    return () => stopSystemSound()
  }, [useSystem])
  const artRef = useRef<string | null>(null)
  useEffect(() => {
    artRef.current = null
    if (!artTheme) return
    let live = true
    void artColor(cover).then((c) => {
      if (live) artRef.current = c
    })
    return () => {
      live = false
    }
  }, [artTheme, cover])
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const data = new Uint8Array(SPECTRUM_BINS)
    let raf = 0
    const draw = (): void => {
      const v = vizRef.current
      const ctx = canvas.getContext('2d')
      const w = (canvas.width = canvas.clientWidth * devicePixelRatio)
      const h = (canvas.height = canvas.clientHeight * devicePixelRatio)
      if (ctx) {
        ctx.clearRect(0, 0, w, h)
        const ok =
          (systemRef.current ? readSystemSpectrum(data) : readSpectrum(data)) &&
          playback.getState().status === 'playing'
        const n = v.bars
        // Low frequencies get more bars (that's where the music is).
        const level = (i: number): number =>
          ok
            ? Math.min(
                1,
                (data[Math.floor((i / n) ** 1.6 * (SPECTRUM_BINS * 0.7))]! / 255) * v.sensitivity
              )
            : 0
        const color = vizColor(v, artRef.current)
        ctx.fillStyle = color
        ctx.strokeStyle = color
        const min = 2 * devicePixelRatio
        if (v.style === 'wave') {
          const pts = Array.from({ length: n }, (_, i) => ({
            x: (i / (n - 1)) * w,
            y: h - Math.max(min, level(i) * (h - min))
          }))
          ctx.beginPath()
          ctx.moveTo(0, h)
          ctx.lineTo(pts[0]!.x, pts[0]!.y)
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1]!
            const b = pts[i]!
            ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2)
          }
          ctx.lineTo(w, pts[pts.length - 1]!.y)
          ctx.lineTo(w, h)
          ctx.closePath()
          ctx.globalAlpha = 0.25 * v.opacity
          ctx.fill()
          ctx.globalAlpha = v.opacity
          ctx.lineWidth = 2 * devicePixelRatio
          ctx.stroke()
        } else {
          const bw = w / n
          for (let i = 0; i < n; i++) {
            const lv = level(i)
            const bh = Math.max(min, lv * h)
            ctx.globalAlpha = (0.55 + lv * 0.45) * v.opacity
            const y = v.style === 'mirror' ? (h - bh) / 2 : h - bh
            ctx.fillRect(i * bw + bw * 0.15, y, bw * 0.7, bh)
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} aria-hidden className="w-full" style={{ height: viz.height }} />
}

/**
 * Full-window player (QoL 4): your picture or video behind the song, the artist on
 * the left, the cover, the whole lyrics on the right, what's next, and level bars.
 */
export default function PlayerView(): React.JSX.Element {
  const track = usePlayback((s) => s.current?.track ?? null)
  const parts = usePlayerPage((s) => s.parts)
  const full = useFullscreen()
  const add = usePlayerPage((s) => s.add)
  const setView = useUi((s) => s.setView)

  return (
    // Right-click anywhere: add a picture, GIF or video for this song, artist, album
    // or every song.
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className="relative isolate flex h-full flex-col overflow-hidden">
          <Background track={track} />
          <button
            onClick={() =>
              void (document.fullscreenElement
                ? document.exitFullscreen()
                : document.documentElement.requestFullscreen())
            }
            aria-label={full ? 'Leave full screen' : 'Full screen'}
            title={full ? 'Leave full screen (Esc)' : 'Full screen'}
            className="absolute top-4 right-4 z-10 rounded-full bg-black/40 p-2 text-white/80 hover:text-white"
          >
            {full ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
          {!track ? (
            <p className="m-auto text-white/80">Play something to fill this page.</p>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 gap-6 px-8 pt-8">
                <div className="flex min-w-0 flex-1 flex-col justify-between pb-6">
                  {parts.artist ? <ArtistPanel track={track} /> : <span />}
                  <div className="flex items-end gap-4">
                    <div className="size-[clamp(140px,22vh,260px)] flex-none overflow-hidden rounded-lg shadow-2xl">
                      <Artwork src={track.artworkUrl} size={260} fill className="size-full" />
                    </div>
                    <div className="min-w-0 pb-1 text-white">
                      <p className="truncate text-xl font-black">{track.title}</p>
                      <p className="truncate text-white/75">{track.artists.join(', ')}</p>
                    </div>
                  </div>
                </div>
                {parts.lyrics && <LyricsColumn />}
                {parts.queue && <QueueStrip />}
              </div>
              {parts.visualizer && (
                <div className="px-8 pb-[calc(var(--play-bar-height)+var(--play-bar-inset)+8px)]">
                  <Visualizer />
                </div>
              )}
              {!parts.visualizer && <div className="pb-page" />}
            </>
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="glass-strong z-50 min-w-56 max-w-80 rounded-xl p-1 text-md">
          <ContextMenu.Label className="px-3 pt-1.5 pb-1 text-xs text-text-muted">
            Add a picture, GIF or video for
          </ContextMenu.Label>
          {scopesFor(track).map((s) => (
            <ContextMenu.Item
              key={s.label}
              onSelect={() => void add(s.scope)}
              className="flex items-center gap-2 rounded-md px-3 py-2 outline-none data-[highlighted]:bg-raised-hover"
            >
              <ImagePlus size={14} className="flex-none" />
              <span className="truncate">{s.label}</span>
            </ContextMenu.Item>
          ))}
          <ContextMenu.Separator className="my-1 h-px bg-divider" />
          <ContextMenu.Item
            onSelect={() => setView('settings')}
            className="rounded-md px-3 py-2 outline-none data-[highlighted]:bg-raised-hover"
          >
            Manage backgrounds…
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
