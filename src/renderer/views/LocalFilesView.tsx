import { Folder } from 'lucide-react'
import { useMemo, useState } from 'react'
import { LOCAL_SORTS, sortLocal, type LocalSort } from '@renderer/lib/localSort'
import { useLibrary } from '@renderer/state/library'
import { useUi } from '@renderer/state/ui'
import { useTagEditor } from '@renderer/state/tagEditor'
import ActivePill from '@renderer/components/ActivePill'
import CollectionView, {
  GhostButton,
  Message,
  PrimaryButton
} from '@renderer/components/CollectionView'

const SORT_KEY = 'local.sort'

function readSort(): LocalSort {
  try {
    const v = localStorage.getItem(SORT_KEY)
    return v === 'artist' || v === 'album' || v === 'unsorted' ? v : 'artist'
  } catch {
    return 'artist'
  }
}

export default function LocalFilesView(): React.JSX.Element {
  const tracks = useLibrary((s) => s.tracks)
  const loaded = useLibrary((s) => s.loaded)
  const scan = useLibrary((s) => s.scan)
  const addFolder = useLibrary((s) => s.addFolder)
  const setView = useUi((s) => s.setView)
  const scanning = scan.state === 'scanning'
  const [sort, setSort] = useState<LocalSort>(readSort)
  const sorted = useMemo(() => sortLocal(tracks, sort), [tracks, sort])
  // Files with no artist tag: candidates for "Artist - Title" file names.
  const untagged = useMemo(
    () => tracks.filter((t) => t.artists.length === 0 || t.artists.every((a) => !a.trim())),
    [tracks]
  )
  const chooseSort = (next: LocalSort): void => {
    setSort(next)
    try {
      localStorage.setItem(SORT_KEY, next)
    } catch {
      // storage unavailable: the choice lasts for this session only
    }
  }

  return (
    <CollectionView
      kicker="Library"
      filterLabel="Search in Local Files"
      title="Local Files"
      cover={
        <div className="flex size-full items-center justify-center bg-gradient-to-br from-accent to-[#3b4a8a]">
          <Folder size={72} strokeWidth={1.5} className="text-white" />
        </div>
      }
      tracks={sorted}
      toolbar={
        tracks.length > 0 ? (
          <>
            <div
              role="radiogroup"
              aria-label="Sort local files"
              className="flex items-center gap-1"
            >
              {LOCAL_SORTS.map((o) => (
                <button
                  key={o.key}
                  role="radio"
                  aria-checked={sort === o.key}
                  onClick={() => chooseSort(o.key)}
                  className={`relative isolate rounded-full px-3 py-1.5 text-sm font-bold transition-colors duration-[140ms] ${
                    sort === o.key ? 'text-base' : 'bg-raised text-text-subdued hover:text-text'
                  }`}
                >
                  {sort === o.key && <ActivePill layoutId="local-sort" />}
                  {o.label}
                </button>
              ))}
            </div>
            {untagged.length > 0 && (
              <button
                onClick={() => useTagEditor.getState().fillFromFilenames(untagged)}
                title="Read artist and title from file names like 'Artist - Title.mp3'"
                className="rounded-full px-3 py-1.5 text-sm font-bold text-text-subdued ring-1 ring-text-muted transition-colors duration-[140ms] hover:text-text hover:ring-text"
              >
                Fill tags from file names ({untagged.length})
              </button>
            )}
          </>
        ) : undefined
      }
      loading={!loaded || (scanning && tracks.length === 0)}
      subtitle={scanning ? `Scanning ${scan.scanned} of ${scan.total} files…` : undefined}
      empty={
        <Message
          title="No local music yet"
          body="Add a folder with your music files. New files in it show up here automatically."
        >
          <PrimaryButton onClick={() => void addFolder()}>Add a music folder</PrimaryButton>
          <GhostButton onClick={() => setView('settings')}>Open Settings</GhostButton>
        </Message>
      }
    />
  )
}
