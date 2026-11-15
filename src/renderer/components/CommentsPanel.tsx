import { useVirtualizer } from '@tanstack/react-virtual'
import { Clock3 } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TrackComment } from '@shared/provider'
import type { Track } from '@shared/types'
import { playback } from '@renderer/playback/controller'
import { usePlayback } from '@renderer/state/player'
import { useScTrack } from '@renderer/state/soundcloudTrack'
import { useSoundCloud } from '@renderer/state/services'
import { formatTime } from '@renderer/lib/format'
import { commentCountLabel } from '@renderer/lib/comments'
import Waveform from './Waveform'
import Artwork from './Artwork'
import EntityLinks from './EntityLinks'
import TrackDetails from './TrackDetails'

/**
 * Right-hand "Details" panel for the playing track: SoundCloud gets its waveform with
 * timed comments; Spotify and local files get artwork, links and the artist.
 */
export default function DetailsPanel(): React.JSX.Element {
  const track = usePlayback((s) => s.current?.track)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!track ? (
        <p className="px-4 py-2 text-sm text-text-subdued">
          Play something to see its details here.
        </p>
      ) : track.provider === 'soundcloud' ? (
        <TrackComments key={track.id} track={track} />
      ) : (
        <TrackDetails key={track.id} track={track} />
      )}
    </div>
  )
}

function TrackComments({ track }: { track: Track }): React.JSX.Element {
  const load = useScTrack((s) => s.load)
  const waveform = useScTrack((s) => s.waveforms[track.nativeId])
  const comments = useScTrack((s) => s.comments[track.nativeId])
  const reload = useScTrack((s) => s.reloadComments)
  const durationMs = usePlayback((s) => s.durationMs) || track.durationMs
  const isCurrent = usePlayback((s) => s.current?.track.id === track.id)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => load(track.nativeId), [load, track.nativeId])

  const list = comments?.state === 'ok' ? comments.data : []

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 page-fade pb-page">
      {/* Header on a soft, blurred copy of the artwork (like playlist pages). */}
      <div className="relative -mx-4 overflow-hidden px-4 pt-1 pb-2">
        {track.artworkUrl && (
          <img
            src={track.artworkUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full scale-125 object-cover opacity-50"
            style={{
              filter: 'blur(32px) saturate(1.3)',
              maskImage: 'linear-gradient(180deg, #000 0%, transparent 100%)'
            }}
          />
        )}
        <div className="relative flex items-center gap-3">
          <Artwork src={track.artworkUrl} size={56} className="rounded-lg shadow-lg" />
          <div className="min-w-0">
            <p className="truncate font-bold">
              <EntityLinks
                names={[track.title]}
                refs={[{ id: track.id, name: track.title }]}
                kind="track"
              />
            </p>
            <p className="truncate text-sm text-text-subdued">
              <EntityLinks names={track.artists} refs={track.artistRefs} />
            </p>
          </div>
        </div>

        <div className="relative mt-3">
          {waveform?.state === 'ok' && waveform.data.length > 0 ? (
            <Waveform
              samples={waveform.data}
              durationMs={durationMs}
              comments={list}
              live={isCurrent}
            />
          ) : waveform?.state === 'error' ? (
            <p className="text-sm text-danger">{waveform.error}</p>
          ) : waveform?.state === 'ok' ? (
            <p className="text-sm text-text-subdued">This track has no waveform.</p>
          ) : (
            <div
              className="h-[92px] animate-pulse rounded-md bg-raised/40"
              aria-label="Loading waveform"
            />
          )}
        </div>
      </div>

      <Composer track={track} />

      <div className="mt-5 flex items-center justify-between pb-2">
        <h3 className="font-bold">
          {comments?.state === 'ok' ? commentCountLabel(list) : 'Comments'}
        </h3>
      </div>
      {comments?.state === 'error' ? (
        <div className="text-sm">
          <p className="text-danger">{comments.error}</p>
          <button
            onClick={() => void reload(track.nativeId)}
            className="mt-2 font-bold text-text-subdued hover:text-text"
          >
            Try again
          </button>
        </div>
      ) : comments?.state === 'ok' && list.length === 0 ? (
        <p className="text-sm text-text-subdued">No comments yet. Be the first.</p>
      ) : (
        <CommentList comments={list} scrollRef={scrollRef} canSeek={isCurrent} />
      )}
    </div>
  )
}

interface Row {
  c: TrackComment
  reply: boolean
}

/** Threads flattened for the virtualizer: each comment, then its replies. */
function flatten(comments: TrackComment[]): Row[] {
  const rows: Row[] = []
  for (const c of comments) {
    rows.push({ c, reply: false })
    for (const r of c.replies ?? []) rows.push({ c: r, reply: true })
  }
  return rows
}

export function CommentList({
  comments,
  scrollRef,
  canSeek
}: {
  comments: TrackComment[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  canSeek: boolean
}): React.JSX.Element {
  const rows = useMemo(() => flatten(comments), [comments])
  const listRef = useRef<HTMLDivElement>(null)
  const [offsetTop, setOffsetTop] = useState(0)
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setOffsetTop(el.offsetTop))
    ro.observe(el.parentElement ?? el)
    setOffsetTop(el.offsetTop)
    return () => ro.disconnect()
  }, [])
  // Comments can run into the thousands: virtualize with measured row heights.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
    scrollMargin: offsetTop
  })
  return (
    <div
      ref={listRef}
      role="list"
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const { c, reply } = rows[row.index]!
        return (
          <div
            key={c.id}
            role="listitem"
            aria-label={reply ? `Reply from ${c.author.username || 'someone'}` : undefined}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className={`absolute inset-x-0 flex gap-3 py-2 ${reply ? 'ml-[13px] border-l-2 border-divider pl-4' : ''}`}
            style={{ transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)` }}
          >
            <span
              className={`${reply ? 'size-5' : 'size-7'} flex-none overflow-hidden rounded-full bg-raised`}
            >
              {c.author.avatarUrl && (
                <img
                  src={c.author.avatarUrl}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              )}
            </span>
            <div className="min-w-0 text-sm">
              <p className="flex items-baseline gap-2">
                <span className="truncate font-bold">{c.author.username || 'Someone'}</span>
                {!reply && (
                  <button
                    onClick={() => canSeek && playback.seek(c.timestampMs)}
                    disabled={!canSeek}
                    title={canSeek ? 'Jump to this moment' : undefined}
                    className="flex-none text-accent tabular-nums hover:text-accent-hover disabled:text-text-muted"
                  >
                    {formatTime(c.timestampMs)}
                  </button>
                )}
              </p>
              <p className="break-words text-text-subdued">{c.body}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Write a timed comment. The time is stamped when you start writing (and can be
 * updated); posting needs an explicit second confirmation because the app can't
 * delete comments.
 */
export function Composer({ track }: { track: Track }): React.JSX.Element {
  const connected = useSoundCloud((s) => s.status?.state === 'connected')
  const post = useScTrack((s) => s.post)
  const isCurrent = usePlayback((s) => s.current?.track.id === track.id)
  const [body, setBody] = useState('')
  const [stampMs, setStampMs] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [posted, setPosted] = useState<string>()

  if (!connected) {
    return (
      <p className="mt-4 rounded-md bg-raised/50 px-3 py-2 text-sm text-text-subdued">
        Log in to SoundCloud in Settings to comment.
      </p>
    )
  }

  const stampNow = (): void => setStampMs(isCurrent ? playback.getPositionMs() : 0)
  const at = formatTime(stampMs ?? 0)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await post(track.nativeId, body, stampMs ?? 0)
      setPosted(`Comment posted at ${at}.`)
      setBody('')
      setStampMs(null)
      setConfirming(false)
    } catch (err) {
      setError((err as Error).message)
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4">
      <textarea
        value={body}
        rows={2}
        maxLength={1000}
        placeholder="Add a comment at this moment"
        aria-label="Comment"
        onFocus={() => stampMs === null && stampNow()}
        onChange={(e) => {
          setBody(e.target.value)
          setPosted(undefined)
          setConfirming(false)
        }}
        className="w-full resize-none rounded-lg bg-raised px-3 py-2 text-sm text-text outline-none ring-1 ring-divider placeholder:text-text-muted focus:ring-2 focus:ring-accent"
      />
      {confirming ? (
        <div
          role="alertdialog"
          aria-label="Confirm comment"
          className="mt-2 rounded-md bg-raised px-3 py-3 text-sm"
        >
          <p>
            Post this comment publicly on SoundCloud at <b className="tabular-nums">{at}</b>? You
            can&apos;t delete it from this app afterwards.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              autoFocus
              disabled={busy}
              onClick={() => void submit()}
              className="rounded-md bg-accent px-3 py-1.5 font-bold text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? 'Posting…' : 'Post comment'}
            </button>
            <button
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded-md px-3 py-1.5 font-bold text-text-subdued hover:text-text"
            >
              Keep editing
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2 text-sm">
          {stampMs !== null && (
            <span className="flex items-center gap-1 text-text-subdued tabular-nums">
              <Clock3 size={14} /> at {at}
            </span>
          )}
          {stampMs !== null && isCurrent && (
            <button onClick={stampNow} className="font-bold text-text-subdued hover:text-text">
              Use current time
            </button>
          )}
          <button
            disabled={!body.trim()}
            onClick={() => setConfirming(true)}
            className="ml-auto rounded-md bg-accent px-3 py-1.5 font-bold text-on-accent hover:bg-accent-hover disabled:opacity-40"
          >
            Post comment
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {posted && (
        <p className="mt-2 text-sm text-text-subdued" aria-live="polite">
          {posted}
        </p>
      )}
    </div>
  )
}
