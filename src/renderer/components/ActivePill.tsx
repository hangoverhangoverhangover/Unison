import { motion } from 'motion/react'
import { motion as m } from '@renderer/styles/tokens'

/**
 * The highlight behind the selected option of a segmented control. Every option in
 * a group renders it only when selected, with the same `layoutId`, so it slides from
 * the old option to the new one instead of jumping. Put it first inside a button that
 * has `relative isolate`.
 */
export default function ActivePill({
  layoutId,
  className = 'rounded-full bg-text'
}: {
  layoutId: string
  className?: string
}): React.JSX.Element {
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden
      transition={m.spring}
      className={`absolute inset-0 -z-10 ${className}`}
    />
  )
}
