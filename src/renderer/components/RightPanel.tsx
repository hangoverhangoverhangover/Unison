import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useJam } from '@renderer/state/jam'
import { useUi, type PanelTab } from '@renderer/state/ui'
import { useAppearance } from '@renderer/state/appearance'
import { motion as m } from '@renderer/styles/tokens'
import QueuePanel from './QueuePanel'
import DetailsPanel from './CommentsPanel'
import ErrorBoundary from './ErrorBoundary'
import JamPanel from './JamPanel'
import ActivePill from '@renderer/components/ActivePill'

const TABS: { tab: PanelTab; label: string }[] = [
  { tab: 'details', label: 'Details' },
  { tab: 'queue', label: 'Queue' },
  { tab: 'jam', label: 'Jam' }
]

/**
 * The one right-hand panel: Queue / Details / Jam tabs. Slides in with a transform
 * only: animating opacity would make it a backdrop root and drop its blur mid-slide.
 */
export default function RightPanel({
  width,
  handle
}: {
  width: number
  handle?: React.ReactNode
}): React.JSX.Element {
  const tab = useUi((s) => s.panelTab)
  const openPanel = useUi((s) => s.openPanel)
  const closePanel = useUi((s) => s.closePanel)
  const jamCount = useJam((s) =>
    s.status.state === 'off' ? 0 : (s.status.room?.participants.length ?? 0)
  )
  const saveTab = useAppearance((s) => s.set)
  const savedTab = useAppearance((s) => s.rightPanelTab)
  useEffect(() => {
    if (tab !== savedTab) saveTab({ rightPanelTab: tab })
  }, [tab, savedTab, saveTab])

  return (
    <motion.aside
      initial={{ x: 32 }}
      animate={{ x: 0 }}
      exit={{ x: 32 }}
      transition={m.spring}
      className="glass relative flex flex-none flex-col rounded-panel"
      style={{ width }}
    >
      {handle}
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div
          role="tablist"
          aria-label="Panel"
          className="flex flex-1 gap-1 rounded-full bg-raised p-1"
        >
          {TABS.map(({ tab: t, label }) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => openPanel(t)}
              className={`relative isolate flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1 text-sm font-semibold transition-colors duration-[140ms] ${
                tab === t ? 'text-base' : 'text-text-subdued hover:text-text'
              }`}
            >
              {tab === t && <ActivePill layoutId="panel-tab" />}
              {label}
              {t === 'jam' && jamCount > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[10px] leading-4 text-on-accent">
                  {jamCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          aria-label="Close panel"
          title="Close panel"
          onClick={closePanel}
          className="flex size-7 flex-none items-center justify-center rounded-full text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text"
        >
          <X size={16} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-panel">
        <ErrorBoundary name={`panel ${tab}`} resetKey={tab}>
          {tab === 'queue' ? <QueuePanel /> : tab === 'details' ? <DetailsPanel /> : <JamPanel />}
        </ErrorBoundary>
      </div>
    </motion.aside>
  )
}
