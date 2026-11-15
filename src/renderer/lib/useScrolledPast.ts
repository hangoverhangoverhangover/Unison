import { useEffect, useState } from 'react'

/**
 * True once `sentinel` (placed at the bottom of a page's hero) has scrolled out of
 * `root`, i.e. when the sticky title strip should show.
 */
export function useScrolledPast(
  root: React.RefObject<HTMLElement | null>,
  sentinel: React.RefObject<HTMLElement | null>
): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !root.current) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry) setPast(!entry.isIntersecting && entry.boundingClientRect.top < 100)
      },
      { root: root.current, rootMargin: '-56px 0px 0px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [root, sentinel])
  return past
}

/** Height of the sticky strip; sticky table headers below it sit at this offset. */
export const STICKY_STRIP = 56
