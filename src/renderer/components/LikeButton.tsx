import { motion } from 'motion/react'
import { Heart } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Track } from '@shared/types'
import { serviceStore } from '@renderer/state/services'
import { motion as m } from '@renderer/styles/tokens'

/**
 * Heart for service tracks. Local files have nothing to like, and Discography likes
 * aren't in the app yet, so for those it renders nothing.
 */
export default function LikeButton({
  track,
  size = 18
}: {
  track: Track
  size?: number
}): React.JSX.Element | null {
  const useStore = serviceStore(track.provider === 'soundcloud' ? 'soundcloud' : 'spotify')
  const liked = useStore((s) => s.liked[track.id] ?? false)
  const checkLiked = useStore((s) => s.checkLiked)
  const setLiked = useStore((s) => s.setLiked)
  const [error, setError] = useState<string>()
  const likeable = track.provider === 'spotify' || track.provider === 'soundcloud'

  useEffect(() => {
    if (likeable) void checkLiked([track.id])
  }, [track.id, likeable, checkLiked])

  if (!likeable) return null
  const label = error ?? (liked ? 'Remove from Liked Songs' : 'Save to Liked Songs')

  return (
    <motion.button
      aria-label={label}
      title={label}
      aria-pressed={liked}
      onClick={() => {
        setError(undefined)
        setLiked(track, !liked).catch((err: Error) => setError(err.message))
      }}
      whileTap={{ scale: 0.8 }}
      animate={{ scale: liked ? [1, 1.25, 1] : 1 }}
      transition={m.spring}
      className={`flex size-8 flex-none items-center justify-center rounded-full transition-colors duration-[140ms] ${
        liked ? 'text-like' : error ? 'text-danger' : 'text-text-subdued hover:text-text'
      }`}
    >
      <Heart size={size} fill={liked ? 'currentColor' : 'none'} />
    </motion.button>
  )
}
