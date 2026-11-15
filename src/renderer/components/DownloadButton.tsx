import { CircleCheck, Download, RotateCcw } from 'lucide-react'
import type { Track } from '@shared/types'
import { itemProgress, useDownloads } from '@renderer/state/downloads'
import { useUi } from '@renderer/state/ui'

/** Progress ring for a queued or running download (18px, accent arc on the track tint). */
function Ring({ progress }: { progress: number }): React.JSX.Element {
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 18 18" className="size-[18px] -rotate-90" aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" className="stroke-progress-track" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        className="stroke-accent transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.04, progress))}
      />
    </svg>
  )
}

/**
 * Download control for SoundCloud rows. Hidden until hover when there's nothing to
 * show; stays visible while queued, running, done or failed.
 */
export default function DownloadButton({
  track,
  alwaysVisible = false
}: {
  track: Track
  /** Show the idle button without a hover (track page). */
  alwaysVisible?: boolean
}): React.JSX.Element | null {
  const item = useDownloads((s) => s.byScId[track.nativeId])
  const live = useDownloads((s) => (item ? s.progress[item.id] : undefined))
  const enqueue = useDownloads((s) => s.enqueue)
  const retry = useDownloads((s) => s.retry)
  const setView = useUi((s) => s.setView)
  if (track.provider !== 'soundcloud') return null

  const base =
    'flex size-7 flex-none items-center justify-center rounded-full transition-colors duration-[140ms] focus-visible:outline-2 focus-visible:outline-accent'

  if (!item) {
    return (
      <button
        aria-label={`Download ${track.title}`}
        title="Download"
        onClick={() => void enqueue(track)}
        className={`${base} ${alwaysVisible ? '' : 'invisible group-hover:visible focus-visible:visible'} text-text-subdued hover:text-text`}
      >
        <Download size={16} />
      </button>
    )
  }
  if (item.status === 'queued' || item.status === 'running') {
    const p =
      item.status === 'queued'
        ? 0
        : itemProgress(item, live === undefined ? {} : { [item.id]: live })
    return (
      <button
        aria-label={
          item.status === 'queued' ? 'Waiting to download' : `Downloading, ${Math.round(p * 100)}%`
        }
        title="Open Downloads"
        onClick={() => setView('downloads')}
        className={base}
      >
        <Ring progress={p} />
      </button>
    )
  }
  if (item.status === 'done') {
    return (
      <button
        aria-label="Downloaded. Open Downloads"
        title="Downloaded"
        onClick={() => setView('downloads')}
        className={`${base} text-accent hover:text-accent-hover`}
      >
        <CircleCheck size={16} />
      </button>
    )
  }
  return (
    <button
      aria-label={`Download failed: ${item.error ?? ''}. Retry`}
      title={item.error ? `${item.error} Click to retry.` : 'Retry download'}
      onClick={() => void retry(item.id)}
      className={`${base} text-danger hover:text-text`}
    >
      <RotateCcw size={16} />
    </button>
  )
}
