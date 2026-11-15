import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { MatchReason } from '@shared/match'
import { SERVICE_NAME } from '@renderer/lib/services'
import { useFind } from '@renderer/state/find'
import { motion as m } from '@renderer/styles/tokens'
import SourceBadge from './SourceBadge'
import TrackRow from './TrackRow'
import { usePlayback } from '@renderer/state/player'
import { playFrom } from '@renderer/state/playContext'

const REASON: Record<MatchReason, string> = {
  isrc: 'Same recording (ISRC)',
  'title-artist': 'Same title and artist'
}

/** "Find on Spotify/SoundCloud" results, over the main window. Escape or the backdrop closes it. */
export default function FindDialog(): React.JSX.Element {
  const open = useFind((s) => s.open)
  const close = useFind((s) => s.close)
  const panelRef = useRef<HTMLDivElement>(null)
  const currentId = usePlayback((st) => st.current?.track.id)
  const playing = usePlayback((st) => st.status === 'playing')

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const result = open?.result
  const matches = result?.state === 'ok' ? result.data.matches : []
  const tracks = matches.map((x) => x.track)
  const exact = matches.filter((x) => x.reason === 'isrc').length

  return (
    <AnimatePresence>
      {open && (
        <div
          key="find"
          // no-drag: the title bar's drag region must not act through the overlay.
          className="no-drag fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
        >
          {/* Only the scrim fades: fading an ancestor of the glass panel would switch
              its blur off until the fade ends. */}
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="absolute inset-0 bg-scrim"
            onMouseDown={() => close()}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="find-title"
            tabIndex={-1}
            initial={{ y: 12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 12, scale: 0.98 }}
            transition={m.spring}
            className="relative flex max-h-[70vh] w-[min(720px,90vw)] flex-col overflow-hidden rounded-2xl glass-strong outline-none"
          >
            <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
              <div className="min-w-0">
                <h2 id="find-title" className="flex items-center gap-2 text-lg font-bold">
                  <SourceBadge provider={open.service} />
                  Find on {SERVICE_NAME[open.service]}
                </h2>
                <p className="mt-1 truncate text-sm text-text-subdued">
                  {open.source.title}, {open.source.artists.join(', ') || 'Unknown artist'}
                </p>
              </div>
              <button
                aria-label="Close"
                onClick={close}
                className="rounded-full p-1 text-text-subdued transition-colors duration-[140ms] hover:text-text"
              >
                <X size={18} />
              </button>
            </header>
            <div className="min-h-0 overflow-y-auto px-2 pb-4">
              {result?.state === 'loading' && (
                <p className="px-3 py-6 text-sm text-text-subdued">
                  Searching {SERVICE_NAME[open.service]}…
                </p>
              )}
              {result?.state === 'error' && (
                <p className="px-3 py-6 text-sm text-danger">{result.error}</p>
              )}
              {result?.state === 'ok' && matches.length === 0 && (
                <p className="px-3 py-6 text-sm text-text-subdued">
                  No match on {SERVICE_NAME[open.service]}. It may not be there, or it’s listed
                  under a different title.
                </p>
              )}
              {matches.length > 0 && (
                <>
                  <p className="px-3 pb-2 text-sm text-text-subdued">
                    {exact > 0
                      ? `${exact} with the same recording (ISRC), the rest by title and artist.`
                      : 'Matched by title and artist. Check it before replacing anything.'}
                  </p>
                  <div role="list">
                    {matches.map((x, i) => (
                      <TrackRow
                        key={`${i}:${x.track.id}`}
                        track={x.track}
                        index={i}
                        isCurrent={x.track.id === currentId}
                        playing={playing}
                        onPlay={() => void playFrom(tracks, i, null)}
                        note={
                          <span
                            className={`flex-none rounded-full px-2 py-0.5 text-xs ${x.reason === 'isrc' ? 'bg-accent/20 text-accent' : 'bg-raised text-text-subdued'}`}
                          >
                            {REASON[x.reason]}
                          </span>
                        }
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
