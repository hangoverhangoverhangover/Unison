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
  const now = lines[line]
  const next = lines[line + 1]
  // No such line (lyrics just changed), or an empty last line marking where the
  // singing ends: nothing to show.
  if (!now || (!now.text && !next)) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[86px] z-30 flex justify-center px-6">
      {/* Fixed width, so the pill never jumps in size between short and long lines. */}
      <button
        onClick={() => setView('lyrics')}
        title="Open lyrics"
        className="glass-bar pointer-events-auto w-[min(640px,100%)] overflow-hidden rounded-2xl px-5 py-2 text-center"
      >
        {/* Both lines move together: the old pair slides up and fades as the new one
            rises in (transform and opacity on the text only; the glass stays put). */}
        <div className="relative h-[38px]">
          <AnimatePresence initial={false}>
            <motion.div
              key={`${line}:${now.timeMs}`}
              className="absolute inset-0"
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -18, opacity: 0 }}
              transition={{ duration: m.duration.base / 1000, ease: [0.2, 0, 0, 1] }}
            >
              <p className="truncate text-md font-bold text-text">{now.text || '♪'}</p>
              <p className="truncate text-xs text-text-muted">{next?.text ?? ''}</p>
            </motion.div>
          </AnimatePresence>
        </div>
      </button>
    </div>
  )
}
