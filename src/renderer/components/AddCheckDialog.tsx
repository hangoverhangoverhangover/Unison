import { useState } from 'react'
import { useAddCheck } from '@renderer/state/addCheck'
import { SERVICE_NAME } from '@renderer/lib/services'
import Artwork from './Artwork'
import Modal, { DialogButton } from './Modal'

const SOURCE: Record<string, string> = { ...SERVICE_NAME, local: 'local file' }

/** "Already in this playlist": add anyway, add only the new ones, or cancel (QoL 4). */
export default function AddCheckDialog(): React.JSX.Element {
  const pending = useAddCheck((s) => s.pending)
  const answer = useAddCheck((s) => s.answer)
  const setAsk = useAddCheck((s) => s.setAsk)
  const [showList, setShowList] = useState(false)
  const [dontAsk, setDontAsk] = useState(false)

  const choose = (c: 'all' | 'new' | 'cancel'): void => {
    if (dontAsk && c !== 'cancel') setAsk(false)
    setShowList(false)
    setDontAsk(false)
    answer(c)
  }

  const count = pending?.tracks.length ?? 0
  const dupes = pending?.matches ?? []
  const one = count === 1
  const first = dupes[0]
  const allDupes = dupes.length === count

  return (
    <Modal
      open={!!pending}
      onClose={() => choose('cancel')}
      title={one ? 'Already in this playlist' : `${dupes.length} of ${count} are already there`}
      subtitle={pending ? `Adding to ${pending.playlistName}` : undefined}
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-sm text-text-subdued">
            <input
              type="checkbox"
              checked={dontAsk}
              onChange={(e) => setDontAsk(e.target.checked)}
              className="accent-accent"
            />
            Don&apos;t ask again
          </label>
          <DialogButton onClick={() => choose('cancel')}>Cancel</DialogButton>
          <DialogButton onClick={() => choose('all')}>
            {one ? 'Add anyway' : 'Add all'}
          </DialogButton>
          {!one && !allDupes && (
            <DialogButton primary onClick={() => choose('new')}>
              Add only new ones
            </DialogButton>
          )}
          {(one || allDupes) && (
            <DialogButton primary onClick={() => choose('cancel')}>
              Don&apos;t add
            </DialogButton>
          )}
        </>
      }
    >
      {one && first ? (
        <p className="text-sm text-text-subdued">
          <span className="font-semibold text-text">{first.track.title}</span> is already in{' '}
          {pending?.playlistName}
          {first.sameTrack ? '.' : ` (as the ${SOURCE[first.match.provider]} version).`}
        </p>
      ) : (
        <>
          <button
            onClick={() => setShowList(!showList)}
            className="text-sm font-semibold text-text-subdued hover:text-text"
          >
            {showList ? 'Hide the songs' : 'Show which songs'}
          </button>
          {showList && (
            <ul className="mt-2 max-h-64 overflow-y-auto">
              {dupes.map((d) => (
                <li key={d.track.id} className="flex items-center gap-3 py-1.5">
                  <Artwork src={d.track.artworkUrl} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{d.track.title}</span>
                    <span className="block truncate text-xs text-text-muted">
                      {d.sameTrack ? 'Same track' : `As the ${SOURCE[d.match.provider]} version`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  )
}
