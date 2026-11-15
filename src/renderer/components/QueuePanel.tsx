import { Reorder } from 'motion/react'
import { GripVertical, X } from 'lucide-react'
import type { QueueItem } from '@shared/playback'
import { playback } from '@renderer/playback/controller'
import { usePlayback } from '@renderer/state/player'
import Artwork from './Artwork'
import SourceBadge from './SourceBadge'

function Row({ item, current }: { item: QueueItem; current?: boolean }): React.JSX.Element {
  const { track } = item
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Artwork src={track.artworkUrl} size={40} />
      <div className="min-w-0">
        <p className={`truncate ${current ? 'text-accent' : ''}`}>{track.title}</p>
        <p className="flex items-center gap-1.5 text-sm text-text-subdued">
          <SourceBadge provider={track.provider} />
          <span className="truncate">{track.artists.join(', ') || 'Unknown artist'}</span>
        </p>
      </div>
    </div>
  )
}

export default function QueuePanel(): React.JSX.Element {
  const current = usePlayback((s) => s.current)
  const queue = usePlayback((s) => s.queue)

  // Reorder hands back the new order. It always differs from the old one by a
  // single item moving, so find the changed span [i, j] and turn it into one move().
  const onReorder = (next: QueueItem[]): void => {
    const n = queue.length
    let i = 0
    while (i < n && queue[i]!.uid === next[i]!.uid) i++
    if (i === n) return
    let j = n - 1
    while (queue[j]!.uid === next[j]!.uid) j--
    if (next[j]!.uid === queue[i]!.uid) playback.moveInQueue(i, j)
    else playback.moveInQueue(j, i)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 page-fade pb-page">
        <h3 className="px-2 pt-2 pb-1 font-bold">Now playing</h3>
        {current ? (
          <div className="rounded-lg bg-raised px-2 py-2">
            <Row item={current} current />
          </div>
        ) : (
          <p className="px-2 py-2 text-sm text-text-subdued">
            Nothing playing. Double-click a song to start.
          </p>
        )}

        <div className="flex items-center justify-between px-2 pt-5 pb-1">
          <h3 className="font-bold">Next up</h3>
          {queue.length > 0 && (
            <button
              onClick={() => playback.clearQueue()}
              className="rounded-md px-2 py-1 text-sm font-bold text-text-subdued transition-colors duration-[140ms] hover:text-text"
            >
              Clear
            </button>
          )}
        </div>
        {queue.length === 0 ? (
          <p className="px-2 py-2 text-sm text-text-subdued">
            Right-click a song and choose Add to queue.
          </p>
        ) : (
          <Reorder.Group axis="y" values={queue} onReorder={onReorder} className="flex flex-col">
            {queue.map((item) => (
              <Reorder.Item
                key={item.uid}
                value={item}
                className="group flex items-center gap-1 rounded-lg px-1 py-1.5 hover:bg-raised/70"
                whileDrag={{ scale: 1.02 }}
              >
                <GripVertical size={14} className="flex-none text-text-muted" />
                <Row item={item} />
                <button
                  aria-label={`Remove ${item.track.title} from queue`}
                  onClick={() => playback.removeFromQueue(item.uid)}
                  className="rounded-md p-1 text-text-muted opacity-0 transition-opacity duration-[140ms] group-hover:opacity-100 hover:text-text focus-visible:opacity-100"
                >
                  <X size={14} />
                </button>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        )}
      </div>
    </div>
  )
}
