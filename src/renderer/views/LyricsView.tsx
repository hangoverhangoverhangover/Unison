import { Mic, Pencil, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Track } from '@shared/types'
import { playback } from '@renderer/playback/controller'
import { useLyrics } from '@renderer/state/lyrics'
import { useLyricPosition } from '@renderer/lib/useLyricPosition'
import { Message } from '@renderer/components/CollectionView'
import Switch from '@renderer/components/Switch'

const field =
  'min-w-0 flex-1 rounded-lg bg-raised px-3 py-2 text-sm text-text outline-none ring-1 ring-divider placeholder:text-text-muted focus:ring-2 focus:ring-accent'

/**
 * Look again with a better title and artist (file names like "06 Track 6", or a
 * wrong match): LRCLIB, then Genius. What's found is kept for this song.
 */
function SearchAgain({ track, onDone }: { track: Track; onDone?: () => void }): React.JSX.Element {
  const search = useLyrics((s) => s.search)
  const loading = useLyrics((s) => s.loading)
  const error = useLyrics((s) => s.error)
  const [title, setTitle] = useState(track.title)
  const [artist, setArtist] = useState(track.artists[0] ?? '')
  const [missed, setMissed] = useState(false)
  const go = async (): Promise<void> => {
    setMissed(false)
    const found = await search(title, artist)
    if (found) onDone?.()
    else setMissed(true)
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void go()
      }}
      className="mx-auto mt-6 w-full max-w-xl"
    >
      <div className="flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          aria-label="Song title"
          className={field}
        />
        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="Artist"
          aria-label="Artist"
          className={field}
        />
        <button
          type="submit"
          disabled={loading || !title.trim() || !artist.trim()}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-bold text-on-accent transition-colors duration-[140ms] hover:bg-accent-hover disabled:opacity-40"
        >
          <Search size={14} /> {loading ? 'Searching…' : 'Search'}
        </button>
      </div>
      {missed && !error && (
        <p className="mt-2 text-sm text-text-muted">Still nothing on LRCLIB or Genius for that.</p>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </form>
  )
}

/** How long auto-scroll waits after the user scrolls the lyrics themselves. */
const MANUAL_SCROLL_PAUSE_MS = 4000

/**
 * Full lyrics for the playing song, over the artwork wash. Synced lyrics follow the
 * song (line by line, word by word when the lyrics have word timing); click a line to
 * jump there. Missing or unsynced lyrics can be added and synced in the editor.
 */
export default function LyricsView(): React.JSX.Element {
  const track = useLyrics((s) => s.track)
  const result = useLyrics((s) => s.result)
  const loading = useLyrics((s) => s.loading)
  const barOn = useLyrics((s) => s.barOn)
  const setBar = useLyrics((s) => s.setBar)
  const openEditor = useLyrics((s) => s.setEditorOpen)
  const lines = result?.synced ?? null
  const { line, word } = useLyricPosition(lines)
  const scrollRef = useRef<HTMLDivElement>(null)
  const manualUntil = useRef(0)
  const [searching, setSearching] = useState<string | null>(null)
  const searchOpen = !!track && searching === track.id

  // Keep the current line in the middle, unless the user is scrolling around.
  useEffect(() => {
    if (line < 0 || Date.now() < manualUntil.current) return
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-line="${line}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [line])

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-[0.08em] text-text-subdued uppercase">
          Lyrics
          {result?.source === 'lrclib' && ' · from LRCLIB'}
          {result?.source === 'user' && ' · yours'}
          {result?.source === 'genius' && ' · from Genius'}
        </p>
        <h1 className="truncate text-[32px] leading-tight font-black tracking-[-0.02em]">
          {track?.title ?? 'Nothing playing'}
        </h1>
        {track && <p className="truncate text-text-subdued">{track.artists.join(', ')}</p>}
      </div>
      {track && (
        <div className="flex items-center gap-4">
          {lines && (
            <label className="flex items-center gap-2 text-sm text-text-subdued">
              Show above the play bar
              <Switch label="Show lyrics above the play bar" checked={barOn} onChange={setBar} />
            </label>
          )}
          {result && result.source !== 'none' && result.source !== 'user' && (
            <button
              onClick={() => setSearching(searchOpen ? null : track.id)}
              title="Wrong lyrics? Search with another title or artist"
              className="flex items-center gap-2 rounded-full bg-raised px-3 py-1.5 text-sm font-semibold transition-colors duration-[140ms] hover:bg-raised-hover"
            >
              <Search size={14} /> Search again
            </button>
          )}
          <button
            onClick={() => openEditor(true)}
            className="flex items-center gap-2 rounded-full bg-raised px-3 py-1.5 text-sm font-semibold transition-colors duration-[140ms] hover:bg-raised-hover"
          >
            <Pencil size={14} />
            {result?.source === 'none' || !result
              ? 'Add lyrics'
              : lines
                ? 'Edit or re-sync'
                : 'Sync these lyrics'}
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div
      ref={scrollRef}
      onWheel={() => (manualUntil.current = Date.now() + MANUAL_SCROLL_PAUSE_MS)}
      className="h-full overflow-y-auto page-fade pb-page px-8 pt-8"
    >
      {header}
      {searchOpen && track && (
        <div className="-mt-2 mb-6">
          <SearchAgain key={track.id} track={track} onDone={() => setSearching(null)} />
        </div>
      )}
      {!track ? (
        <Message title="Play something" body="Lyrics for the playing song show up here." />
      ) : loading ? (
        <p className="text-text-subdued">Looking for lyrics…</p>
      ) : result?.instrumental && !lines ? (
        <Message title="Instrumental" body="This one has no words." />
      ) : lines ? (
        <ol className="flex flex-col gap-3 pb-[30vh]">
          {lines.map((l, i) => {
            // An empty last line only marks where the singing ends.
            if (!l.text && i === lines.length - 1) return <li key="end" data-line={i} />
            const state = i === line ? 'now' : i < line ? 'past' : 'next'
            return (
              <li key={`${i}:${l.timeMs}`} data-line={i}>
                <button
                  onClick={() => playback.seek(l.timeMs)}
                  className={`origin-left text-left text-[28px] leading-snug font-extrabold tracking-[-0.01em] transition-[color,transform,opacity] duration-300 ${
                    state === 'now'
                      ? 'scale-[1.02] text-text'
                      : state === 'past'
                        ? 'text-text-subdued opacity-70 hover:opacity-100'
                        : 'text-text-muted hover:text-text-subdued'
                  }`}
                >
                  {l.words?.length && state === 'now'
                    ? l.words.map((w, wi) => (
                        <span
                          key={wi}
                          className={`transition-colors duration-150 ${
                            wi <= word ? 'text-text' : 'text-text-muted'
                          }`}
                        >
                          {w.text}
                        </span>
                      ))
                    : l.text || '♪'}
                </button>
              </li>
            )
          })}
        </ol>
      ) : result?.plain ? (
        <>
          <p className="mb-4 flex items-center gap-2 text-sm text-text-muted">
            <Mic size={14} /> These lyrics aren’t synced yet. Sync them to follow along.
            {result.source === 'genius' && result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto font-semibold text-text-subdued hover:text-text hover:underline"
              >
                View on Genius
              </a>
            )}
          </p>
          <div className="text-[22px] leading-relaxed font-bold whitespace-pre-line text-text-subdued">
            {result.plain}
          </div>
        </>
      ) : (
        <>
          <Message
            title="No lyrics found"
            body="LRCLIB and Genius don’t have this one under this name. Try the real title and artist, or paste the lyrics yourself and sync them as the song plays."
          />
          <SearchAgain key={track.id} track={track} />
        </>
      )}
    </div>
  )
}
