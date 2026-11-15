import { useCallback, useEffect, useState } from 'react'
import type { DuplicateGroup, MatchConfidence } from '@shared/transfer'
import type { Track } from '@shared/types'
import { ipcMessage, serviceStore } from '@renderer/state/services'
import Artwork from '@renderer/components/Artwork'
import { Message } from '@renderer/components/CollectionView'
import SourceBadge from '@renderer/components/SourceBadge'
import { playFrom } from '@renderer/state/playContext'

const CONFIDENCE: Record<MatchConfidence, string> = {
  isrc: 'Same recording (ISRC)',
  exact: 'Same artist and title',
  close: 'Close match'
}

function where(t: Track): string {
  if (t.provider === 'local') return t.localPath ?? 'Local file'
  return t.provider === 'spotify' ? 'Liked on Spotify' : 'Liked on SoundCloud'
}

function Row({ track, onUnliked }: { track: Track; onUnliked: () => void }): React.JSX.Element {
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string>()
  const unlike = async (): Promise<void> => {
    try {
      const store = serviceStore(track.provider === 'soundcloud' ? 'soundcloud' : 'spotify')
      await store.getState().setLiked(track, false)
      onUnliked()
    } catch (err) {
      setError(ipcMessage(err))
    }
  }
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-raised/50">
      <button
        aria-label={`Play ${track.title}`}
        onDoubleClick={() => void playFrom([track], 0)}
        onClick={() => void playFrom([track], 0)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <Artwork src={track.artworkUrl} size={40} />
        <span className="min-w-0">
          <span className="block truncate text-text">{track.title}</span>
          <span className="flex items-center gap-1.5 text-sm text-text-subdued">
            <SourceBadge provider={track.provider} />
            <span className="truncate">
              {track.artists.join(', ') || 'Unknown artist'} · {where(track)}
            </span>
          </span>
        </span>
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
      {track.provider !== 'local' &&
        (confirm ? (
          <span className="flex items-center gap-2 text-sm">
            Remove from Liked Songs?
            <button onClick={() => void unlike()} className="font-bold text-danger">
              Remove
            </button>
            <button onClick={() => setConfirm(false)} className="text-text-subdued hover:text-text">
              Keep
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            className="rounded-full px-3 py-1 text-sm font-bold text-text-subdued ring-1 ring-text-muted hover:text-text hover:ring-text"
          >
            Unlike this copy
          </button>
        ))}
    </li>
  )
}

/**
 * Songs that look like the same track across Liked Songs and local files. Nothing is
 * merged automatically: you decide per group, and "Not duplicates" hides a group.
 */
export default function DuplicatesView(): React.JSX.Element {
  const [groups, setGroups] = useState<DuplicateGroup[]>()
  const [error, setError] = useState<string>()

  const load = useCallback(() => {
    window.api
      .invoke('duplicates:find')
      .then(setGroups, (err: unknown) => setError(ipcMessage(err)))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const dismiss = async (key: string): Promise<void> => {
    setGroups((g) => g?.filter((x) => x.key !== key))
    await window.api.invoke('duplicates:dismiss', key).catch(() => undefined)
  }

  return (
    <div className="relative h-full overflow-y-auto page-fade pb-page px-4 pt-8">
      <header className="px-2 pt-4">
        <h1 className="text-[32px] leading-10 font-black">Duplicates</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-subdued">
          The same song liked on both services, or liked and also saved as a local file. Matches
          without an ISRC are guesses from the artist and title, so check each group.
        </p>
      </header>
      {error ? (
        <Message title="Couldn't look for duplicates" body={error} />
      ) : !groups ? (
        <p className="px-2 pt-6 text-text-subdued">Comparing your likes and local files…</p>
      ) : groups.length === 0 ? (
        <Message
          title="No duplicates found"
          body="Nothing in your likes and local files looks like the same song twice."
        />
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {groups.map((g) => (
            <li key={g.key} className="rounded-lg bg-raised/30 p-2">
              <div className="flex items-center justify-between px-2 pb-1">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${g.confidence === 'close' ? 'bg-raised text-text-subdued' : 'bg-accent/20 text-accent'}`}
                >
                  {CONFIDENCE[g.confidence]}
                </span>
                <button
                  onClick={() => void dismiss(g.key)}
                  className="text-sm font-bold text-text-subdued hover:text-text"
                >
                  Not duplicates
                </button>
              </div>
              <ul>
                {g.tracks.map((t) => (
                  <Row key={t.id} track={t} onUnliked={load} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
