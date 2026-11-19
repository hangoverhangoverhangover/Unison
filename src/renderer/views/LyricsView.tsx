import { Mic, Pencil } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { playback } from '@renderer/playback/controller'
import { useLyrics } from '@renderer/state/lyrics'
import { useLyricPosition } from '@renderer/lib/useLyricPosition'
import { Message } from '@renderer/components/CollectionView'
import Switch from '@renderer/components/Switch'

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
      {!track ? (
        <Message title="Play something" body="Lyrics for the playing song show up here." />
      ) : loading ? (
        <p className="text-text-subdued">Looking for lyrics…</p>
      ) : result?.instrumental && !lines ? (
        <Message title="Instrumental" body="This one has no words." />
      ) : lines ? (
        <ol className="flex flex-col gap-3 pb-[30vh]">
          {lines.map((l, i) => {
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
          </p>
          <div className="text-[22px] leading-relaxed font-bold whitespace-pre-line text-text-subdued">
            {result.plain}
          </div>
        </>
      ) : (
        <Message
          title="No lyrics found"
          body="LRCLIB doesn’t have this one. Paste the lyrics yourself and sync them as the song plays."
        />
      )}
    </div>
  )
}
