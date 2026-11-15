import { AnimatePresence, motion } from 'motion/react'
import { Pause, Play } from 'lucide-react'
import { motion as m } from '@renderer/styles/tokens'
import { STICKY_STRIP } from '@renderer/lib/useScrolledPast'

/** Round accent play button for page headers (48 px; 32 px in the sticky strip). */
export function HeroPlayButton({
  onClick,
  disabled,
  playing,
  small,
  label = 'Play'
}: {
  onClick: () => void
  disabled?: boolean
  playing?: boolean
  small?: boolean
  label?: string
}): React.JSX.Element {
  return (
    <motion.button
      aria-label={playing ? 'Pause' : label}
      disabled={disabled}
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      transition={m.spring}
      className={`flex flex-none items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_8px_24px_rgba(114,137,218,0.35)] transition-[background-color,transform] duration-[140ms] hover:scale-[1.04] hover:bg-accent-hover disabled:opacity-40 ${
        small ? 'size-8' : 'size-12'
      }`}
    >
      {playing ? (
        <Pause size={small ? 14 : 20} fill="currentColor" />
      ) : (
        <Play size={small ? 14 : 20} fill="currentColor" className="ml-0.5" />
      )}
    </motion.button>
  )
}

/**
 * Slim frosted strip over the top of a page once its hero scrolls away: a small play
 * button, the title and (optionally) the list's column header. It is a sibling of the
 * page's scroll area, not inside it: the scroll area carries the fade mask, and glass
 * inside a masked element can only blur what is inside that element's own layer.
 */
export function StickyTitle({
  show,
  title,
  play,
  below
}: {
  show: boolean
  title: string
  play?: React.ReactNode
  below?: React.ReactNode
}): React.JSX.Element {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          // Slide only: fading an ancestor of glass would switch its blur off mid-way.
          initial={{ y: '-100%' }}
          animate={{ y: 0 }}
          exit={{ y: '-100%' }}
          transition={{ duration: m.duration.fast / 1000, ease: [0.2, 0, 0, 1] }}
          className="absolute inset-x-0 top-0 z-30"
        >
          <div className="glass rounded-t-panel border-x-0 border-t-0">
            <div className="flex items-center gap-3 px-5" style={{ height: STICKY_STRIP }}>
              {play}
              <span className="truncate text-lg font-bold tracking-[-0.01em]">{title}</span>
            </div>
            {below && <div className="px-2">{below}</div>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
