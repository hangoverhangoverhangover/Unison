import { BadgeCheck, ListMusic, Play, UserRound } from 'lucide-react'
import { useState } from 'react'
import type { Album, Artist, Track } from '@shared/types'
import { ALBUM_TYPE_LABEL, releaseYear } from '@renderer/lib/catalog'
import { SERVICE_NAME } from '@renderer/lib/services'
import type { TopResult } from '@renderer/lib/searchMerge'
import { useUi } from '@renderer/state/ui'
import Artwork from './Artwork'
import { playFrom } from '@renderer/state/playContext'

/** Small coloured dot naming the service a result comes from. */
export function SourceDot({
  provider,
  className = ''
}: {
  provider: Track['provider']
  className?: string
}): React.JSX.Element {
  const color =
    provider === 'spotify' ? 'bg-spotify' : provider === 'soundcloud' ? 'bg-soundcloud' : 'bg-local'
  const name = provider === 'local' ? 'Local file' : SERVICE_NAME[provider]
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={`inline-block size-1.5 flex-none rounded-full ${color} ${className}`}
    />
  )
}

function Img({
  src,
  round,
  fallback
}: {
  src?: string
  round?: boolean
  fallback: React.ReactNode
}): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  return (
    <span
      className={`block aspect-square w-full overflow-hidden bg-raised shadow-[0_8px_24px_rgba(0,0,0,0.25)] ${
        round ? 'rounded-full' : 'rounded-md'
      }`}
    >
      {src && !broken ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-text-muted">
          {fallback}
        </span>
      )}
    </span>
  )
}

export function ArtistCard({ artist }: { artist: Artist }): React.JSX.Element {
  const setView = useUi((s) => s.setView)
  return (
    <button
      onClick={() => setView(`artist:${artist.id}`)}
      className="group flex min-w-0 flex-col items-center gap-2 rounded-xl p-2.5 text-center transition-colors duration-[140ms] hover:bg-raised"
    >
      <Img src={artist.imageUrl} round fallback={<UserRound size={36} strokeWidth={1.5} />} />
      <span className="flex w-full min-w-0 items-center justify-center gap-1.5">
        <SourceDot provider={artist.provider} />
        <span className="truncate font-semibold text-text">{artist.name}</span>
        {artist.verified && (
          <BadgeCheck size={14} className="flex-none text-accent" aria-label="Verified" />
        )}
      </span>
    </button>
  )
}

function setCaption(s: Album): string {
  const owner = s.artists[0]?.name
  const year = s.type === 'playlist' ? undefined : releaseYear(s.releaseDate)
  return [ALBUM_TYPE_LABEL[s.type], owner, year].filter(Boolean).join(' · ')
}

export function SetCard({ set }: { set: Album }): React.JSX.Element {
  const setView = useUi((s) => s.setView)
  return (
    <button
      onClick={() => setView(`album:${set.id}`)}
      className="flex min-w-0 flex-col gap-2 rounded-xl p-2.5 text-left transition-colors duration-[140ms] hover:bg-raised"
    >
      <Img src={set.artworkUrl} fallback={<ListMusic size={36} strokeWidth={1.5} />} />
      <span className="line-clamp-2 leading-snug font-semibold text-text">{set.name}</span>
      <span className="truncate text-sm text-text-subdued">{setCaption(set)}</span>
    </button>
  )
}

/** Wrapping grid of cards (never scrolls sideways). */
export function CardGrid({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1">{children}</div>
  )
}

/** The big "Top result" card: an artist, or a song you can play straight away. */
export function TopResultCard({ top }: { top: NonNullable<TopResult> }): React.JSX.Element {
  const setView = useUi((s) => s.setView)
  if (top.kind === 'artist') {
    const a = top.artist
    return (
      <button
        onClick={() => setView(`artist:${a.id}`)}
        className="flex h-full w-full flex-col items-start justify-end gap-3 rounded-2xl bg-raised p-5 text-left transition-colors duration-[140ms] hover:bg-raised-hover"
      >
        <span className="w-24">
          <Img src={a.imageUrl} round fallback={<UserRound size={36} strokeWidth={1.5} />} />
        </span>
        <span className="flex max-w-full items-center gap-2">
          <span className="truncate text-[28px] leading-tight font-extrabold tracking-[-0.02em] text-text">
            {a.name}
          </span>
          {a.verified && (
            <BadgeCheck size={20} className="flex-none text-accent" aria-label="Verified" />
          )}
        </span>
        <span className="flex items-center gap-2 text-sm text-text-subdued">
          <SourceDot provider={a.provider} />
          {a.provider === 'spotify' ? 'Artist' : 'SoundCloud artist'}
          {a.followers !== undefined && ` · ${a.followers.toLocaleString()} followers`}
        </span>
      </button>
    )
  }
  const t = top.track
  return (
    <div className="group relative flex h-full w-full flex-col items-start justify-end gap-3 rounded-2xl bg-raised p-5 transition-colors duration-[140ms] hover:bg-raised-hover">
      <Artwork src={t.artworkUrl} size={96} className="rounded-lg shadow-lg" />
      <span className="max-w-full truncate text-[28px] leading-tight font-extrabold tracking-[-0.02em] text-text">
        {t.title}
      </span>
      <span className="flex max-w-full items-center gap-2 text-sm text-text-subdued">
        <SourceDot provider={t.provider} />
        <span className="truncate">Song · {t.artists.join(', ') || 'Unknown artist'}</span>
      </span>
      <button
        aria-label={`Play ${t.title}`}
        onClick={() => void playFrom([t], 0)}
        className="absolute right-5 bottom-5 flex size-12 translate-y-1 items-center justify-center rounded-full bg-accent text-on-accent opacity-0 shadow-lg transition-[opacity,transform] duration-[140ms] group-hover:translate-y-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Play size={20} fill="currentColor" className="ml-0.5" />
      </button>
    </div>
  )
}
