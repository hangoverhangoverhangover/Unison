import { BadgeCheck, ListMusic, Shuffle, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Album, ArtistPage, Playlist } from '@shared/types'
import { playback } from '@renderer/playback/controller'
import { useCatalog } from '@renderer/state/catalog'
import { useUi } from '@renderer/state/ui'
import { isAlbumLike, releaseCaption } from '@renderer/lib/catalog'
import { effect } from '@renderer/styles/tokens'
import { Message } from '@renderer/components/CollectionView'
import DownloadAllButton from '@renderer/components/DownloadAllButton'
import SourceBadge from '@renderer/components/SourceBadge'
import { TrackRows } from '@renderer/components/TrackList'
import { FollowButton, ProfileReposts } from '@renderer/components/SocialButtons'
import { HeroPlayButton, StickyTitle } from '@renderer/components/PageHeader'
import { useScrolledPast } from '@renderer/lib/useScrolledPast'
import ActivePill from '@renderer/components/ActivePill'
import { playFrom } from '@renderer/state/playContext'
import { usePlayingFrom, useQueuedFrom } from '@renderer/state/playContext'
import type { Track } from '@shared/types'

type Filter = 'all' | 'albums' | 'singles'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'albums', label: 'Albums' },
  { key: 'singles', label: 'Singles and EPs' }
]

/** Square cover card for a release or playlist; opens its page. */
function Card({
  id,
  name,
  caption,
  artworkUrl
}: {
  id: string
  name: string
  caption: string
  artworkUrl?: string
}): React.JSX.Element {
  const setView = useUi((s) => s.setView)
  return (
    <button
      onClick={() => setView(`album:${id}`)}
      className="group flex min-w-0 flex-col gap-2 rounded-lg p-2 text-left transition-colors duration-[140ms] hover:bg-raised/70 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="aspect-square w-full overflow-hidden rounded-md bg-raised shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center">
            <ListMusic size={40} strokeWidth={1.5} className="text-text-subdued" />
          </span>
        )}
      </span>
      <span className="line-clamp-2 font-bold text-text">{name}</span>
      <span className="truncate text-sm text-text-subdued">{caption}</span>
    </button>
  )
}

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-1'

function Discography({ releases }: { releases: Album[] }): React.JSX.Element | null {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = useMemo(
    () =>
      releases.filter((r) =>
        filter === 'all' ? true : filter === 'albums' ? isAlbumLike(r) : !isAlbumLike(r)
      ),
    [releases, filter]
  )
  if (releases.length === 0) return null
  const hasAlbums = releases.some(isAlbumLike)
  const hasSingles = releases.some((r) => !isAlbumLike(r))
  return (
    <section className="mt-8">
      <h2 className="px-4 text-xl font-bold">Discography</h2>
      {hasAlbums && hasSingles && (
        <div className="mt-3 flex gap-2 px-4" role="radiogroup" aria-label="Filter releases">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="radio"
              aria-checked={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`relative isolate rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-[140ms] ${
                filter === f.key ? 'text-base' : 'bg-raised text-text hover:bg-raised/70'
              }`}
            >
              {filter === f.key && <ActivePill layoutId="artist-filter" />}
              {f.label}
            </button>
          ))}
        </div>
      )}
      <div className={`${GRID} mt-3 px-2`}>
        {shown.map((r) => (
          <Card
            key={r.id}
            id={r.id}
            name={r.name}
            caption={releaseCaption(r)}
            artworkUrl={r.artworkUrl}
          />
        ))}
      </div>
    </section>
  )
}

function Playlists({ playlists }: { playlists: Playlist[] }): React.JSX.Element | null {
  if (playlists.length === 0) return null
  return (
    <section className="mt-8">
      <h2 className="px-4 text-xl font-bold">Playlists</h2>
      <div className={`${GRID} mt-3 px-2`}>
        {playlists.map((p) => (
          <Card
            key={p.id}
            id={p.id}
            name={p.name}
            caption={p.trackCount ? `${p.trackCount} tracks` : 'Playlist'}
            artworkUrl={p.artworkUrl}
          />
        ))}
      </div>
    </section>
  )
}

/** SoundCloud: every upload, loaded on request (profiles can have hundreds). */
function AllTracks({ id, count }: { id: string; count?: number }): React.JSX.Element | null {
  const load = useCatalog((s) => s.artistTracks[id])
  const fetchAll = useCatalog((s) => s.loadArtistTracks)
  const [open, setOpen] = useState(false)
  if (!count) return null
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between px-4">
        <h2 className="text-xl font-bold">All tracks</h2>
        <button
          onClick={() => {
            setOpen((o) => !o)
            if (!open) void fetchAll(id)
          }}
          className="text-sm font-bold text-text-subdued hover:text-text"
          aria-expanded={open}
        >
          {open ? 'Hide' : `Show all ${count}`}
        </button>
      </div>
      {open && (
        <div className="mt-2 px-2">
          {load?.state === 'ok' ? (
            <TrackRows tracks={load.data} />
          ) : load?.state === 'error' ? (
            <p className="px-4 text-sm text-danger">{load.error}</p>
          ) : (
            <p className="px-4 text-sm text-text-subdued">Loading tracks…</p>
          )}
        </div>
      )}
    </section>
  )
}

/** The artist's play button: pauses / resumes when their top tracks are playing. */
function ArtistPlay({
  tracks,
  artistName,
  small
}: {
  tracks: Track[]
  artistName: string
  small?: boolean
}): React.JSX.Element {
  const view = useUi((s) => s.view)
  const playing = usePlayingFrom(view)
  const queued = useQueuedFrom(view)
  return (
    <HeroPlayButton
      small={small}
      label={`Play ${artistName}`}
      playing={playing}
      onClick={() => (queued ? void playback.toggle() : void playFrom(tracks, 0))}
    />
  )
}

function Header({
  page,
  sentinel
}: {
  page: ArtistPage
  sentinel: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const { artist, topTracks } = page
  const backdrop = artist.bannerUrl ?? artist.imageUrl
  const shufflePlay = (): void => {
    if (topTracks.length === 0) return
    playback.setShuffle(true)
    void playFrom(topTracks, Math.floor(Math.random() * topTracks.length))
  }
  const fetchAll = useCatalog((s) => s.loadArtistTracks)
  return (
    <div className="relative overflow-hidden">
      {backdrop && (
        <img
          src={backdrop}
          alt=""
          aria-hidden
          className={`absolute inset-0 size-full object-cover ${artist.bannerUrl ? 'opacity-80' : 'scale-125 opacity-55'}`}
          style={{
            filter: artist.bannerUrl ? undefined : `blur(${effect.heroBlur}px) saturate(1.3)`,
            maskImage: 'linear-gradient(180deg, #000 30%, transparent 100%)'
          }}
        />
      )}
      <div className="relative flex items-end gap-7 px-7 pt-24 pb-6">
        <div className="size-[160px] flex-none overflow-hidden rounded-full bg-raised shadow-[0_16px_48px_rgba(0,0,0,0.45)] ring-1 ring-white/10">
          {artist.imageUrl ? (
            <img src={artist.imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center">
              <UserRound size={56} strokeWidth={1.5} className="text-text-subdued" />
            </span>
          )}
        </div>
        <div className="min-w-0 pb-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.08em] text-text-subdued uppercase">
            <SourceBadge provider={artist.provider} />
            {artist.provider === 'spotify' ? 'Spotify artist' : 'SoundCloud profile'}
            {artist.verified && (
              <span className="ml-1 flex items-center gap-1 text-accent">
                <BadgeCheck size={16} aria-hidden /> Verified
              </span>
            )}
          </p>
          <h1
            className={`mt-1 font-black tracking-[-0.03em] ${artist.name.length > 18 ? 'line-clamp-2 text-[48px] leading-[52px]' : 'text-hero'}`}
          >
            {artist.name}
          </h1>
          {artist.followers !== undefined && (
            <p className="mt-2 text-sm text-text-subdued">
              {artist.followers.toLocaleString()}{' '}
              {artist.followers === 1 ? 'follower' : 'followers'}
            </p>
          )}
        </div>
      </div>
      <div className="relative flex items-center gap-3 px-7 pb-4">
        {topTracks.length > 0 && (
          <>
            <ArtistPlay artistName={artist.name} tracks={topTracks} />
            <button
              aria-label="Shuffle play"
              title="Shuffle play"
              onClick={shufflePlay}
              className="flex size-10 items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text"
            >
              <Shuffle size={20} />
            </button>
          </>
        )}
        {artist.provider === 'soundcloud' && (
          <>
            <FollowButton artist={artist} />
            <DownloadAllButton getTracks={() => fetchAll(artist.id)} count={page.trackCount} />
          </>
        )}
      </div>
      <div ref={sentinel} aria-hidden className="absolute bottom-0 h-px w-full" />
    </div>
  )
}

function Popular({ page }: { page: ArtistPage }): React.JSX.Element | null {
  const [more, setMore] = useState(false)
  const tracks = page.topTracks
  if (tracks.length === 0) return null
  return (
    <section className="mt-2">
      <h2 className="px-4 text-xl font-bold">Popular</h2>
      <div className="mt-2 px-2">
        <TrackRows tracks={more ? tracks : tracks.slice(0, 5)} />
      </div>
      {tracks.length > 5 && (
        <button
          onClick={() => setMore((v) => !v)}
          className="mt-1 px-4 py-2 text-sm font-bold text-text-subdued hover:text-text"
        >
          {more ? 'Show less' : 'See more'}
        </button>
      )}
    </section>
  )
}

/** Spotify artist or SoundCloud profile (`artist:<provider>:<id>`). */
export default function ArtistView({ id }: { id: string }): React.JSX.Element {
  const page = useCatalog((s) => s.artists[id])
  const load = useCatalog((s) => s.loadArtist)
  useEffect(() => {
    void load(id)
  }, [id, load])

  if (!page || (page.state !== 'ok' && page.state !== 'error')) {
    return (
      <div className="h-full overflow-y-auto page-fade pb-page px-6 pt-16">
        <p className="text-text-subdued">Loading artist…</p>
      </div>
    )
  }
  if (page.state === 'error') {
    return (
      <div className="relative h-full overflow-y-auto page-fade pb-page pt-16">
        <Message title="Couldn't load this artist" body={page.error} />
      </div>
    )
  }
  return <ArtistBody key={id} page={page.data} />
}

function ArtistBody({ page: data }: { page: ArtistPage }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const past = useScrolledPast(scrollRef, sentinel)
  const top = data.topTracks
  return (
    <div className="relative h-full">
      <StickyTitle
        show={past}
        title={data.artist.name}
        play={
          top.length > 0 ? (
            <ArtistPlay small artistName={data.artist.name} tracks={top} />
          ) : undefined
        }
      />
      <div ref={scrollRef} className="relative h-full overflow-y-auto page-fade pb-page">
        <Header page={data} sentinel={sentinel} />
        <Popular page={data} />
        <Discography releases={data.releases} />
        {data.artist.provider === 'soundcloud' && (
          <AllTracks id={data.artist.id} count={data.trackCount} />
        )}
        <Playlists playlists={data.playlists} />
        {data.artist.provider === 'soundcloud' && <ProfileReposts userId={data.artist.nativeId} />}
      </div>
    </div>
  )
}
