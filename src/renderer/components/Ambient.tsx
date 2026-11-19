import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { usePlayback } from '@renderer/state/player'
import { useAppearance } from '@renderer/state/appearance'
import { blur, motion as m } from '@renderer/styles/tokens'
import { customBackdrop } from '@shared/theme'

// Calm washes for when there's no artwork (or the theme doesn't follow it).
const WASH = {
  none: [
    'radial-gradient(60% 70% at 15% 10%, rgba(76, 58, 140, 0.55), transparent 70%)',
    'radial-gradient(55% 60% at 90% 80%, rgba(30, 64, 120, 0.5), transparent 70%)',
    'radial-gradient(40% 50% at 60% 40%, rgba(114, 137, 218, 0.18), transparent 70%)',
    '#0f1019'
  ].join(', '),
  dark: [
    'radial-gradient(70% 70% at 20% 0%, rgba(114, 137, 218, 0.14), transparent 70%)',
    'radial-gradient(60% 60% at 100% 100%, rgba(90, 70, 150, 0.12), transparent 70%)',
    '#101119'
  ].join(', '),
  light: [
    'radial-gradient(60% 70% at 10% 0%, rgba(176, 190, 255, 0.55), transparent 70%)',
    'radial-gradient(55% 60% at 95% 90%, rgba(255, 196, 214, 0.5), transparent 70%)',
    'radial-gradient(50% 50% at 60% 50%, rgba(255, 236, 214, 0.45), transparent 70%)',
    '#eceff6'
  ].join(', ')
}

/**
 * The window's background. Artwork theme: the playing track's cover, scaled up and
 * blurred into a colour wash under a dark scrim, crossfading on track change. Dark
 * and Light: a fixed wash. A plain filtered <img> is drawn once by the GPU, so this
 * costs little while scrolling, and needs no pixel reads (no CORS).
 */
export default function Ambient(): React.JSX.Element {
  const theme = useAppearance((s) => s.theme)
  const custom = useAppearance((s) => s.customTheme)
  const customImage = useAppearance((s) => s.customImage)
  const art = usePlayback((s) => s.current?.track.artworkUrl)
  const [failed, setFailed] = useState<string | undefined>()
  const src = theme === 'artwork' && art && art !== failed ? art : undefined

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            theme === 'artwork'
              ? WASH.none
              : theme === 'custom'
                ? customBackdrop(custom)
                : WASH[theme]
        }}
      />
      {theme === 'custom' && custom.backdrop === 'image' && customImage && (
        <>
          <img
            src={customImage}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full object-cover"
          />
          {/* Your shade over the picture, in the theme colour, so text stays readable. */}
          <div
            className="absolute inset-0"
            style={{ background: custom.background, opacity: custom.imageDim }}
          />
        </>
      )}
      <AnimatePresence initial={false}>
        {src && (
          <motion.img
            key={src}
            src={src}
            alt=""
            draggable={false}
            onError={() => setFailed(src)}
            className="absolute inset-0 size-full object-cover"
            style={{
              filter: `blur(${blur.ambient}px) saturate(1.4)`,
              transform: 'scale(1.4)'
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: m.duration.crossfade / 1000, ease: [0.2, 0, 0, 1] }}
          />
        )}
      </AnimatePresence>
      {theme === 'artwork' && (
        // The title bar has no panel behind it: a little extra shade at the top keeps its
        // icons and the Windows caption buttons readable over a bright cover.
        <div
          className="absolute inset-x-0 top-0 h-16"
          style={{ background: 'linear-gradient(180deg, rgba(10, 9, 18, 0.45), transparent)' }}
        />
      )}
      {theme === 'artwork' && (
        // Keeps white text readable even over a bright white cover.
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(10, 9, 18, 0.5) 0%, rgba(10, 9, 18, 0.6) 100%)'
          }}
        />
      )}
    </div>
  )
}
