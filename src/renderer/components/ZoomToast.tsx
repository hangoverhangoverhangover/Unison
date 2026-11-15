import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useAppearance } from '@renderer/state/appearance'
import { motion as m, size } from '@renderer/styles/tokens'

const SHOW_MS = 1200

/** A small "110%" pill for a moment after the zoom level changes. */
export default function ZoomToast(): React.JSX.Element {
  const zoom = useAppearance((s) => s.zoom)
  const [shown, setShown] = useState<number | null>(null)
  const first = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    // The first value is the saved zoom arriving at launch: no toast for that.
    if (first.current) {
      first.current = false
      return
    }
    setShown(zoom)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setShown(null), SHOW_MS)
  }, [zoom])
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <AnimatePresence>
      {shown !== null && (
        <motion.div
          role="status"
          initial={{ y: 8 }}
          animate={{ y: 0 }}
          exit={{ y: 8, transition: { duration: m.duration.fast / 1000 } }}
          transition={m.spring}
          className="glass-strong pointer-events-none fixed left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-1.5 text-sm font-semibold tabular-nums"
          // Just above the floating play bar, which grows with the zoom.
          style={{ bottom: (size.playBar + size.playBarInset * 2 + 8) * shown }}
        >
          {Math.round(shown * 100)}%
        </motion.div>
      )}
    </AnimatePresence>
  )
}
