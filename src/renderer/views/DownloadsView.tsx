import { FolderOpen, Play, RotateCcw, X } from 'lucide-react'
import type { DownloadItem } from '@shared/downloads'
import { useDownloads, itemProgress } from '@renderer/state/downloads'
import { useLibrary } from '@renderer/state/library'
import Artwork from '@renderer/components/Artwork'
import { Message } from '@renderer/components/CollectionView'
import { playFrom } from '@renderer/state/playContext'

const ROW = 'grid grid-cols-[40px_minmax(0,1fr)_minmax(0,14rem)_auto] items-center gap-4 px-4'

function statusText(item: DownloadItem, progress: number): string {
  switch (item.status) {
    case 'queued':
      return 'Waiting'
    case 'running':
      return progress > 0 ? `${Math.round(progress * 100)}%` : 'Starting'
    case 'done':
      return item.method === 'official' ? 'Original file' : 'Saved from stream'
    case 'failed':
      return item.error ?? 'Failed'
  }
}

function IconButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  )
}

function Row({ item }: { item: DownloadItem }): React.JSX.Element {
  const live = useDownloads((s) => s.progress[item.id])
  const progress = itemProgress(item, live === undefined ? {} : { [item.id]: live })
  const cancel = useDownloads((s) => s.cancel)
  const retry = useDownloads((s) => s.retry)
  const reveal = useDownloads((s) => s.reveal)
  const local = useLibrary((s) =>
    item.localTrackId ? s.tracks.find((t) => t.id === item.localTrackId) : undefined
  )
  const active = item.status === 'running' || item.status === 'queued'
  const failed = item.status === 'failed'

  return (
    <li
      className="relative overflow-hidden rounded-lg"
      aria-label={`${item.track.title}: ${statusText(item, progress)}`}
    >
      {item.status === 'running' && (
        // The row itself is the progress bar: an accent wash that fills left to right.
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-accent/15 transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${progress * 100}%` }}
        />
      )}
      <div className={`${ROW} relative h-14`}>
        <Artwork src={item.track.artworkUrl} size={40} />
        <span className="min-w-0">
          <span className="block truncate text-text">{item.track.title}</span>
          <span className="block truncate text-sm text-text-subdued">
            {item.track.artists.join(', ') || 'Unknown artist'}
          </span>
        </span>
        <span
          className={`truncate text-sm tabular-nums ${failed ? 'text-danger' : active ? 'text-text' : 'text-text-subdued'}`}
          title={failed ? item.error : undefined}
        >
          {statusText(item, progress)}
        </span>
        <span className="flex items-center gap-1">
          {active && (
            <IconButton label="Cancel download" onClick={() => void cancel(item.id)}>
              <X size={16} />
            </IconButton>
          )}
          {failed && (
            <IconButton label="Retry download" onClick={() => void retry(item.id)}>
              <RotateCcw size={16} />
            </IconButton>
          )}
          {item.status === 'done' && (
            <>
              {local && (
                <IconButton
                  label={`Play ${item.track.title}`}
                  onClick={() => void playFrom([local], 0)}
                >
                  <Play size={16} fill="currentColor" />
                </IconButton>
              )}
              <IconButton label="Show in folder" onClick={() => void reveal(item.id)}>
                <FolderOpen size={16} />
              </IconButton>
            </>
          )}
        </span>
      </div>
    </li>
  )
}

function Section({
  title,
  items,
  action
}: {
  title: string
  items: DownloadItem[]
  action?: React.ReactNode
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between px-4 pb-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {action}
      </div>
      <ul>
        {items.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </ul>
    </section>
  )
}

function toolsLine(status: ReturnType<typeof useDownloads.getState>['status']): string | null {
  if (!status) return null
  switch (status.tools) {
    case 'copying':
      return 'Setting up yt-dlp and ffmpeg. Downloads start when that’s done.'
    case 'updating':
      return 'Updating yt-dlp. Downloads start when that’s done.'
    case 'missing':
      return 'yt-dlp.exe or ffmpeg.exe is missing from the app’s bin folder.'
    case 'error':
      return status.error ?? 'yt-dlp or ffmpeg couldn’t be set up.'
    default:
      return null
  }
}

export default function DownloadsView(): React.JSX.Element {
  const status = useDownloads((s) => s.status)
  const items = useDownloads((s) => s.items)
  const error = useDownloads((s) => s.error)
  const chooseFolder = useDownloads((s) => s.chooseFolder)
  const clearHistory = useDownloads((s) => s.clearHistory)
  const active = items.filter((i) => i.status === 'running' || i.status === 'queued')
  const history = items.filter((i) => i.status === 'done' || i.status === 'failed')
  const tools = toolsLine(status)

  return (
    <div className="h-full overflow-y-auto page-fade pb-page px-4 pt-8">
      <header className="px-4">
        <h1 className="text-[32px] leading-10 font-black">Downloads</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-text-subdued">
          <span className="truncate">Saving to {status?.folder ?? '…'}</span>
          <button
            onClick={() => void chooseFolder()}
            className="font-bold text-text-subdued underline-offset-2 hover:text-text hover:underline"
          >
            Change folder
          </button>
        </p>
        {tools && (
          <p
            className={`mt-2 text-sm ${status?.tools === 'error' || status?.tools === 'missing' ? 'text-danger' : 'text-text-subdued'}`}
            aria-live="polite"
          >
            {tools}
          </p>
        )}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </header>

      {items.length === 0 ? (
        <Message
          title="Nothing downloaded yet"
          body="Hover a SoundCloud track and click the download button, or right-click it and choose Download. Files are added to Local Files when they finish."
        />
      ) : (
        <>
          <Section title="Downloading" items={active} />
          <Section
            title="History"
            items={history}
            action={
              <button
                onClick={() => void clearHistory()}
                className="text-sm font-bold text-text-subdued hover:text-text"
              >
                Clear history
              </button>
            }
          />
        </>
      )}
    </div>
  )
}
