import { AnimatePresence, motion } from 'motion/react'
import { useLyrics } from '@renderer/state/lyrics'
import { useUi } from '@renderer/state/ui'
import { useLyricPosition } from '@renderer/lib/useLyricPosition'
import { motion as m } from '@renderer/styles/tokens'

/**
 * The current lyric line in a slim frosted pill just above the play bar, with the next
 * line faint underneath. Shown when the song has synced lyrics and the bar is on (off
 * on the full lyrics page, which already shows them). Click to open the lyrics page.
 */
export default function LyricsBar(): React.JSX.Element | null {
  const lines = useLyrics((s) => s.result?.synced ?? null)
  const barOn = useLyrics((s) => s.barOn)
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const { line } = useLyricPosition(barOn && view !== 'lyrics' ? lines : null)
  if (!lines || !barOn || view === 'lyrics' || line < 0) return null
  const now = lines[line]!
  const next = lines[line + 1]
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[86px] z-30 flex justify-center px-6">
      <button
        onClick={() => setView('lyrics')}
        title="Open lyrics"
        className="glass-bar pointer-events-auto max-w-[min(720px,100%)] overflow-hidden rounded-2xl px-5 py-2 text-center"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {/* Slide the new line in from below (transform only, so the glass keeps its blur). */}
          <motion.p
            key={`${line}:${now.timeMs}`}
            initial={{ y: 14 }}
            animate={{ y: 0 }}
            exit={{ y: -14 }}
            transition={{ duration: m.duration.base / 1000, ease: [0.2, 0, 0, 1] }}
            className="truncate text-md font-bold text-text"
          >
            {now.text || '♪'}
          </motion.p>
        </AnimatePresence>
        {next?.text && <p className="truncate text-xs text-text-muted">{next.text}</p>}
      </button>
    </div>
  )
}
