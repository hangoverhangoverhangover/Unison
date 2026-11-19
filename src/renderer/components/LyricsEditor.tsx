import { Hand, RotateCcw, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toLrc } from '@shared/lyrics'
import { playback } from '@renderer/playback/controller'
import { useLyrics } from '@renderer/state/lyrics'
import {
  buildLines,
  currentLineIndex,
  currentUnit,
  startSync,
  tap,
  undo,
  type SyncState
} from '@renderer/lib/lyricSync'
import Modal from './Modal'

type Step = 'text' | 'sync' | 'review'

const btn =
  'rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-[140ms] disabled:opacity-40'
const primary = `${btn} bg-accent text-on-accent hover:bg-accent-hover`
const ghost = `${btn} text-text-subdued hover:bg-raised hover:text-text`

/**
 * Add or fix lyrics for the playing song: paste them, then tap along as the song
 * plays (Space or the Tap button) to stamp each line, and optionally each word.
 * Saved on this computer only.
 */
export default function LyricsEditor(): React.JSX.Element {
  const open = useLyrics((s) => s.editorOpen)
  const setOpen = useLyrics((s) => s.setEditorOpen)
  const track = useLyrics((s) => s.track)
  const result = useLyrics((s) => s.result)
  const save = useLyrics((s) => s.save)
  const remove = useLyrics((s) => s.remove)
  const [step, setStep] = useState<Step>('text')
  const [text, setText] = useState('')
  const [sync, setSync] = useState<SyncState | null>(null)
  const [lineSync, setLineSync] = useState<SyncState | null>(null)
  const [busy, setBusy] = useState(false)
  const tapRef = useRef<HTMLButtonElement>(null)

  // Fresh start each time it opens, from the lyrics we already have.
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  const key = open ? (track?.id ?? 'none') : null
  if (key !== openedFor) {
    setOpenedFor(key)
    if (open) {
      setStep('text')
      setSync(null)
      setLineSync(null)
      setText(result?.plain ?? '')
    }
  }

  useEffect(() => {
    if (step === 'sync') tapRef.current?.focus()
  }, [step, sync?.mode])

  const begin = (mode: SyncState['mode']): void => {
    setSync(startSync(text, mode))
    setStep('sync')
    playback.seek(0)
    void playback.play()
  }
  const doTap = (): void => {
    if (!sync) return
    const next = tap(sync, playback.getPositionMs())
    setSync(next)
    if (next.done) {
      if (next.mode === 'lines') setLineSync(next)
      setStep('review')
    }
  }
  // While syncing, Space taps (and never reaches the play/pause shortcut), wherever
  // focus happens to be inside the dialog.
  const tapNow = useRef(doTap)
  useEffect(() => {
    tapNow.current = doTap
  })
  useEffect(() => {
    if (step !== 'sync') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== ' ') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!e.repeat) tapNow.current()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [step])
  const finish = async (s: SyncState | null): Promise<void> => {
    setBusy(true)
    const ok = await save(s ? toLrc(buildLines(s)) : text)
    setBusy(false)
    if (ok) setOpen(false)
  }

  const lines = sync?.lines ?? []
  const at = sync ? currentLineIndex(sync) : -1
  // Before the first tap the first line is only coming up; after, the highlight is the
  // line being sung, and a tap says it ended.
  const started = (sync?.cursor ?? 0) > 0
  const unit = sync?.mode === 'words' ? 'word' : 'line'
  let wordIndex = -1
  if (sync?.mode === 'words') {
    let k = currentUnit(sync)
    for (let i = 0; i < at; i++) k -= sync.words[i]!.length
    wordIndex = k
  }

  const footer =
    step === 'text' ? (
      <>
        {result?.source === 'user' && (
          <button
            className={`${ghost} mr-auto text-danger hover:text-danger`}
            onClick={() => void remove().then(() => setOpen(false))}
          >
            Remove my lyrics
          </button>
        )}
        <button className={ghost} disabled={!text.trim() || busy} onClick={() => void finish(null)}>
          Save without syncing
        </button>
        <button className={primary} disabled={!text.trim()} onClick={() => begin('lines')}>
          Sync line by line
        </button>
      </>
    ) : step === 'sync' ? (
      <>
        <button className={`${ghost} mr-auto`} onClick={() => begin(sync!.mode)}>
          <RotateCcw size={14} className="mr-1.5 inline" />
          Start over
        </button>
        <button
          className={ghost}
          disabled={!sync?.cursor}
          onClick={() => sync && setSync(undo(sync))}
        >
          <Undo2 size={14} className="mr-1.5 inline" />
          Undo
        </button>
      </>
    ) : (
      <>
        <button className={`${ghost} mr-auto`} onClick={() => begin('lines')}>
          Redo the lines
        </button>
        {sync?.mode === 'lines' && (
          <button className={ghost} onClick={() => begin('words')}>
            Also sync each word
          </button>
        )}
        <button className={primary} disabled={busy} onClick={() => void finish(sync ?? lineSync)}>
          Save
        </button>
      </>
    )

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      busy={busy}
      title={result?.source === 'none' || !result ? 'Add lyrics' : 'Edit lyrics'}
      subtitle={
        track
          ? `${track.title} · ${track.artists.join(', ')} · saved on this computer only`
          : undefined
      }
      footer={footer}
    >
      {step === 'text' && (
        <>
          <p className="mb-2 text-sm text-text-subdued">
            Paste the lyrics, one line per line. Next you&apos;ll tap along as the song plays to
            time each line.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            aria-label="Lyrics"
            placeholder="Paste lyrics here"
            className="w-full resize-none rounded-lg bg-raised px-3 py-2 text-sm leading-relaxed text-text outline-none ring-1 ring-divider placeholder:text-text-muted focus:ring-2 focus:ring-accent"
          />
        </>
      )}

      {step === 'sync' && sync && (
        <>
          <p className="mb-3 text-sm text-text-subdued">
            The song is playing from the start. Press{' '}
            <kbd className="rounded border border-divider px-1">Space</kbd> or Tap{' '}
            {started
              ? `when the highlighted ${unit} ends.`
              : `when the first ${unit} starts, then each time the ${unit} you hear ends.`}{' '}
            <span className="tabular-nums">
              {Math.max(0, sync.cursor - 1)} / {sync.total} done
            </span>
          </p>
          <ol className="mb-4 max-h-[42vh] overflow-y-auto rounded-lg bg-raised p-3">
            {lines.map((l, i) => (
              <li
                key={i}
                ref={(el) => {
                  if (i === at) el?.scrollIntoView({ block: 'nearest' })
                }}
                className={`rounded-md px-2 py-1 ${
                  i === at
                    ? started
                      ? 'bg-accent/20 font-bold text-text'
                      : 'font-bold text-text ring-1 ring-accent/60'
                    : i < at
                      ? 'text-text-subdued'
                      : 'text-text-muted'
                }`}
              >
                {sync.mode === 'words' && i === at
                  ? sync.words[i]!.map((w, wi) => (
                      <span
                        key={wi}
                        className={
                          wi === wordIndex ? 'underline decoration-accent decoration-2' : ''
                        }
                      >
                        {w}
                      </span>
                    ))
                  : l}
              </li>
            ))}
          </ol>
          <button
            ref={tapRef}
            onClick={doTap}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-4 text-lg font-bold text-on-accent transition-transform duration-75 hover:bg-accent-hover active:scale-[0.98]"
          >
            <Hand size={20} /> {started ? `Tap: ${unit} ended` : `Tap: first ${unit} starts`}
          </button>
        </>
      )}

      {step === 'review' && (
        <p className="text-sm text-text-subdued">
          {sync?.mode === 'words'
            ? 'Every word is timed. Save to use them, or redo the lines.'
            : 'Every line is timed. Save now, or go once more through the song to time each word too (shown word by word in the lyrics view).'}
        </p>
      )}
    </Modal>
  )
}
