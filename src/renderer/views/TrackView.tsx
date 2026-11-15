import { ListPlus, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ScTrackPage } from '@shared/soundcloud'
import { playback } from '@renderer/playback/controller'
import { usePlayback } from '@renderer/state/player'
import { HeroPlayButton } from '@renderer/components/PageHeader'
import { useScTrack } from '@renderer/state/soundcloudTrack'
import { useUi } from '@renderer/state/ui'
import { compactNumber, formatCount, formatTime, timeAgo } from '@renderer/lib/format'
import { effect } from '@renderer/styles/tokens'
import { CommentList, Composer } from '@renderer/components/CommentsPanel'
import { commentCountLabel } from '@renderer/lib/comments'
import { Message } from '@renderer/components/CollectionView'
import DownloadButton from '@renderer/components/DownloadButton'
import { RepostButton } from '@renderer/components/SocialButtons'
import EntityLinks from '@renderer/components/EntityLinks'
import LikeButton from '@renderer/components/LikeButton'
import Waveform from '@renderer/components/Waveform'
import { playFrom } from '@renderer/state/playContext'

/** Long descriptions fold to this many lines until "Show more". */
const DESCRIPTION_LINES = 6

function Description({ page }: { page: ScTrackPage }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const text = page.description
  if (!text && page.tags.length === 0) return null
  const long = !!text && (text.split('\n').length > DESCRIPTION_LINES || text.length > 480)
  return (
    <section>
      {text && (
        <p
          className={`text-md whitespace-pre-line break-words text-text ${long && !open ? 'line-clamp-6' : ''}`}
        >
          {text}
        </p>
      )}
      {long && (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-2 text-sm font-bold text-text-subdued hover:text-text"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
      {page.tags.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Tags">
          {page.tags.map((t) => (
            <li key={t} className="rounded-full bg-raised px-3 py-1 text-sm text-text-subdued">
              #{t}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Uploader({ page }: { page: ScTrackPage }): React.JSX.Element {
  const setView = useUi((s) => s.setView)
  const u = page.uploader
  const counts: [string, number | undefined][] = [
    ['play', page.plays],
    ['like', page.likes],
    ['repost', page.reposts]
  ]
  const stats = counts.flatMap(([word, n]) =>
    n === undefined ? [] : [`${compactNumber(n)} ${word}${n === 1 ? '' : 's'}`]
  )
  return (
    <aside className="flex flex-col gap-3">
      <button
        onClick={() => setView(`artist:${u.id}`)}
        className="flex items-center gap-4 rounded-xl bg-raised p-4 text-left transition-colors duration-[140ms] hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="size-16 flex-none overflow-hidden rounded-full bg-raised">
          {u.imageUrl ? (
            <img src={u.imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center">
              <UserRound size={28} className="text-text-subdued" />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-bold">{u.name}</span>
          <span className="block text-sm text-text-subdued">
            {u.followers !== undefined &&
              `${formatCount(u.followers)} ${u.followers === 1 ? 'follower' : 'followers'}`}
            {u.followers !== undefined && u.trackCount !== undefined && ', '}
            {u.trackCount !== undefined &&
              `${formatCount(u.trackCount)} ${u.trackCount === 1 ? 'track' : 'tracks'}`}
          </span>
        </span>
      </button>
      {stats.length > 0 && (
        <p className="px-1 text-sm text-text-subdued tabular-nums">{stats.join(' · ')}</p>
      )}
    </aside>
  )
}

/** A SoundCloud track's own page, laid out like soundcloud.com (`track:soundcloud:<id>`). */
export default function TrackView({ id }: { id: string }): React.JSX.Element {
  const nativeId = id.slice('soundcloud:'.length)
  const page = useScTrack((s) => s.pages[nativeId])
  const loadPage = useScTrack((s) => s.loadPage)
  const loadMedia = useScTrack((s) => s.load)
  const waveform = useScTrack((s) => s.waveforms[nativeId])
  const comments = useScTrack((s) => s.comments[nativeId])
  const isCurrent = usePlayback((s) => s.current?.track.id === id)
  const playing = usePlayback((s) => s.status === 'playing')
  const liveDuration = usePlayback((s) => s.durationMs)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadPage(nativeId)
    loadMedia(nativeId)
  }, [nativeId, loadPage, loadMedia])

  if (!page || (page.state !== 'ok' && page.state !== 'error')) {
    return (
      <div className="relative h-full px-6 pt-16">
        <p className="text-text-subdued">Loading track…</p>
      </div>
    )
  }
  if (page.state === 'error') {
    return (
      <div className="relative h-full pt-16">
        <Message title="Couldn't load this track" body={page.error} />
      </div>
    )
  }

  const data = page.data
  const track = data.track
  const list = comments?.state === 'ok' ? comments.data : []
  const durationMs = (isCurrent && liveDuration) || track.durationMs
  const togglePlay = (): void => {
    if (isCurrent) void (playing ? playback.pause() : playback.play())
    else void playFrom([track], 0)
  }

  return (
    <div ref={scrollRef} className="relative h-full overflow-y-auto page-fade pb-page">
      <div className="relative overflow-hidden">
        {track.artworkUrl && (
          <img
            src={track.artworkUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full scale-125 object-cover opacity-55"
            style={{
              filter: `blur(${effect.heroBlur}px) saturate(1.3)`,
              maskImage: 'linear-gradient(180deg, #000 0%, transparent 100%)'
            }}
          />
        )}
        <div className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-7 px-7 pt-12 pb-6">
          <div className="flex min-w-0 flex-col">
            <div className="flex items-start gap-4">
              <HeroPlayButton
                label={`Play ${track.title}`}
                playing={isCurrent && playing}
                onClick={togglePlay}
              />
              <div className="min-w-0">
                <h1 className="line-clamp-2 text-[34px] leading-10 font-black tracking-[-0.02em] break-words">
                  {track.title}
                </h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-text-subdued">
                  <EntityLinks
                    names={[data.uploader.name]}
                    refs={[{ id: data.uploader.id, name: data.uploader.name }]}
                    className="font-bold text-text"
                  />
                  {data.createdAt && (
                    <time dateTime={data.createdAt}>{timeAgo(data.createdAt)}</time>
                  )}
                  {data.genre && (
                    <span className="rounded-full bg-raised px-2 py-0.5 text-xs">
                      #{data.genre}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="mt-auto pt-8">
              {waveform?.state === 'ok' && waveform.data.length > 0 ? (
                <Waveform
                  samples={waveform.data}
                  durationMs={durationMs}
                  comments={list}
                  live={isCurrent}
                  height={88}
                />
              ) : (
                <div className="h-[112px] animate-pulse rounded-md bg-raised" aria-hidden />
              )}
              <p className="mt-1 text-right text-xs text-text-subdued tabular-nums">
                {formatTime(track.durationMs)}
              </p>
            </div>
          </div>
          <div className="size-[clamp(160px,22vw,300px)] overflow-hidden rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
            {track.artworkUrl ? (
              <img src={track.artworkUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="block size-full bg-raised" />
            )}
          </div>
        </div>
        <div className="relative flex items-center gap-2 px-7 pb-4">
          <LikeButton track={track} />
          <DownloadButton track={track} alwaysVisible />
          <RepostButton track={track} />
          <button
            aria-label="Add to queue"
            title="Add to queue"
            onClick={() => playback.addToQueue([track])}
            className="flex size-8 items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ListPlus size={18} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-8 px-7 pt-4">
        <div className="min-w-0">
          <Description page={data} />
          <div className="mt-6 max-w-2xl">
            <Composer track={track} />
          </div>
          <h2 className="mt-6 pb-2 font-bold">
            {comments?.state === 'ok' ? commentCountLabel(list) : 'Comments'}
          </h2>
          {comments?.state === 'error' ? (
            <p className="text-sm text-danger">{comments.error}</p>
          ) : comments?.state === 'ok' && list.length === 0 ? (
            <p className="text-sm text-text-subdued">No comments yet. Be the first.</p>
          ) : (
            <CommentList comments={list} scrollRef={scrollRef} canSeek={isCurrent} />
          )}
        </div>
        <Uploader page={data} />
      </div>
    </div>
  )
}
