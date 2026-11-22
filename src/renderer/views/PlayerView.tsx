import { ExternalLink, Maximize, Minimize } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { LastfmArtist } from '@shared/lastfm'
import { mediaFor, pickFor, playerMediaUrl, type PlayerMedia } from '@shared/player'
import type { Artist, Track } from '@shared/types'
import { playback } from '@renderer/playback/controller'
import { readSpectrum, SPECTRUM_BINS } from '@renderer/playback/audioGraph'
import { usePlayback } from '@renderer/state/player'
import { useLyrics } from '@renderer/state/lyrics'
import { usePlayerPage } from '@renderer/state/playerPage'
import { useUi } from '@renderer/state/ui'
import { useLyricPosition } from '@renderer/lib/useLyricPosition'
import { useFullscreen } from '@renderer/lib/useFullscreen'
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

/** Covers of what plays next; click one to jump there. */
function QueueStrip(): React.JSX.Element | null {
  const queue = usePlayback((s) => s.queue)
  if (queue.length === 0) return null
  return (
    <div className="flex h-full w-14 flex-col gap-2 overflow-y-auto pt-10 pb-2 [scrollbar-width:none]">
      {queue.slice(0, 30).map((item, i) => (
        <button
          key={item.uid}
          title={`${item.track.title} · ${item.track.artists.join(', ')}`}
          onClick={async () => {
            for (let k = 0; k <= i; k++) await playback.next()
          }}
          className="flex-none overflow-hidden rounded-md opacity-80 shadow transition-opacity hover:opacity-100"
        >
          <Artwork src={item.track.artworkUrl} size={56} />
        </button>
      ))}
    </div>
  )
}

/** Level bars from the audio (local files and SoundCloud; Spotify can't be read). */
function Visualizer(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const data = new Uint8Array(SPECTRUM_BINS)
    const bars = 64
    let raf = 0
    const draw = (): void => {
      const ctx = canvas.getContext('2d')
      const w = (canvas.width = canvas.clientWidth * devicePixelRatio)
      const h = (canvas.height = canvas.clientHeight * devicePixelRatio)
      if (ctx) {
        ctx.clearRect(0, 0, w, h)
        const ok = readSpectrum(data) && playback.getState().status === 'playing'
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent')
        ctx.fillStyle = accent.trim() || '#7289da'
        const bw = w / bars
        for (let i = 0; i < bars; i++) {
          // Low frequencies get more bars (that's where the music is).
          const v = ok ? data[Math.floor((i / bars) ** 1.6 * (SPECTRUM_BINS * 0.7))]! / 255 : 0
          const bh = Math.max(2 * devicePixelRatio, v * h)
          ctx.globalAlpha = 0.55 + v * 0.45
          ctx.fillRect(i * bw + bw * 0.15, h - bh, bw * 0.7, bh)
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} aria-hidden className="h-16 w-full" />
}

/**
 * Full-window player (QoL 4): your picture or video behind the song, the artist on
 * the left, the cover, the whole lyrics on the right, what's next, and level bars.
 */
export default function PlayerView(): React.JSX.Element {
  const track = usePlayback((s) => s.current?.track ?? null)
  const parts = usePlayerPage((s) => s.parts)
  const full = useFullscreen()

  return (
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
                  <Artwork src={track.artworkUrl} size={260} className="size-full" />
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
  )
}
