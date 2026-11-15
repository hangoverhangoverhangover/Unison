import { ArrowLeft, ArrowRight, Download, PictureInPicture2, Search, Settings } from 'lucide-react'
import { useDownloads } from '@renderer/state/downloads'
import { useUi } from '@renderer/state/ui'

function BarButton({
  label,
  onClick,
  disabled,
  active,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`no-drag relative flex size-8 items-center justify-center rounded-full transition-colors duration-[140ms] disabled:opacity-35 ${
        active ? 'text-accent' : 'text-text enabled:hover:bg-raised'
      }`}
    >
      {children}
    </button>
  )
}

/** Download icon with a progress ring and count while downloads are running. */
function DownloadsButton(): React.JSX.Element {
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const active = useDownloads(
    (s) => s.items.filter((i) => i.status === 'running' || i.status === 'queued').length
  )
  const progress = useDownloads((s) => {
    const running = s.items.filter((i) => i.status === 'running')
    if (running.length === 0) return 0
    return running.reduce((sum, i) => sum + (s.progress[i.id] ?? 0), 0) / running.length
  })
  const r = 13
  const circ = 2 * Math.PI * r
  return (
    <BarButton
      label={active ? `Downloads (${active} active)` : 'Downloads'}
      active={view === 'downloads'}
      onClick={() => setView('downloads')}
    >
      {active > 0 && (
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 32 32" aria-hidden>
          <circle
            cx="16"
            cy="16"
            r={r}
            fill="none"
            strokeWidth="2"
            className="stroke-progress-track"
          />
          <circle
            cx="16"
            cy="16"
            r={r}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            className="stroke-accent transition-[stroke-dashoffset] duration-300"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - Math.max(0.04, progress))}
          />
        </svg>
      )}
      <Download size={16} />
      {active > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent">
          {active}
        </span>
      )}
    </BarButton>
  )
}

/**
 * Custom title bar: back/forward, the quick-search pill and app utilities. The strip
 * is a drag region; Windows draws the caption buttons on the right through
 * titleBarOverlay, so the strip stops at env(titlebar-area-width) to stay clear of them.
 * It sits outside the zoom root, so it always lines up with those buttons.
 */
export default function TitleBar(): React.JSX.Element {
  const canBack = useUi((s) => s.history.length > 0)
  const canForward = useUi((s) => s.forward.length > 0)
  const back = useUi((s) => s.back)
  const goForward = useUi((s) => s.goForward)
  const openQuickSearch = useUi((s) => s.openQuickSearch)
  const showSearch = useUi((s) => s.showSearch)
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const miniOpen = useUi((s) => s.miniOpen)

  return (
    <header
      className="drag relative z-30 grid h-10 flex-none grid-cols-[1fr_minmax(0,440px)_1fr] items-center gap-3 px-2"
      style={{ width: 'env(titlebar-area-width, 100%)' }}
    >
      <div className="flex items-center gap-1">
        <BarButton label="Back" disabled={!canBack} onClick={back}>
          <ArrowLeft size={17} />
        </BarButton>
        <BarButton label="Forward" disabled={!canForward} onClick={goForward}>
          <ArrowRight size={17} />
        </BarButton>
      </div>

      {/* The magnifier opens the full Search page; the rest of the pill opens quick search. */}
      <div className="glass no-drag flex h-8 w-full items-center rounded-full">
        <button
          aria-label="Search"
          title="Open the Search page"
          aria-current={view === 'search' ? 'page' : undefined}
          onClick={() => showSearch('')}
          className={`flex h-full flex-none items-center rounded-l-full pr-1.5 pl-3 transition-colors duration-[140ms] ${
            view === 'search' ? 'text-accent' : 'text-text-subdued hover:text-text'
          }`}
        >
          <Search size={15} />
        </button>
        <button
          onClick={openQuickSearch}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-r-full pr-3 pl-1 text-left text-sm text-text-muted transition-colors duration-[140ms] hover:text-text-subdued"
        >
          <span className="min-w-0 flex-1 truncate">Search Spotify, SoundCloud, your files</span>
          <kbd className="flex-none rounded-md border border-divider px-1.5 py-px font-sans text-[10px] tracking-wide text-text-muted">
            Ctrl K
          </kbd>
        </button>
      </div>

      <div className="flex items-center justify-end gap-1">
        <DownloadsButton />
        <BarButton
          label={miniOpen ? 'Close mini player' : 'Mini player'}
          active={miniOpen}
          onClick={() => void window.api.invoke('mini:toggle')}
        >
          <PictureInPicture2 size={16} />
        </BarButton>
        <BarButton
          label="Settings"
          active={view === 'settings'}
          onClick={() => setView('settings')}
        >
          <Settings size={16} />
        </BarButton>
      </div>
    </header>
  )
}
