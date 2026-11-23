import { useEffect, useState } from 'react'
import type { AppPrefs, MiniLayout, MiniParts } from '@shared/config'
import ActivePill from './ActivePill'
import Switch from './Switch'

const LAYOUTS: { id: MiniLayout; label: string }[] = [
  { id: 'player', label: 'Player' },
  { id: 'lyrics', label: 'Lyrics bar' }
]

const PARTS: { key: keyof MiniParts; label: string }[] = [
  { key: 'art', label: 'Artwork' },
  { key: 'lyric', label: 'Lyric line' },
  { key: 'controls', label: 'Controls' },
  { key: 'progress', label: 'Progress' }
]

/** Settings → Appearance → Mini player (QoL 4): its layout and what it shows. */
export default function MiniPlayerSection(): React.JSX.Element {
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)
  useEffect(() => {
    void window.api.invoke('prefs:get').then(setPrefs)
    return window.api.on('prefs:changed', setPrefs)
  }, [])
  const set = async (patch: Partial<AppPrefs>): Promise<void> => {
    setPrefs(await window.api.invoke('prefs:set', patch))
  }
  const layout = prefs?.miniLayout ?? 'player'
  const parts = prefs?.miniParts
  return (
    <div className="mt-6">
      <p className="text-sm font-semibold text-text-subdued">Mini player</p>
      <p className="text-xs text-text-muted">
        The full player, or just a lyric bar (the current line, with controls on hover).
      </p>
      <div role="radiogroup" aria-label="Mini player layout" className="mt-3 flex gap-1.5">
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            role="radio"
            aria-checked={layout === l.id}
            disabled={!prefs}
            onClick={() => void set({ miniLayout: l.id })}
            className={`relative isolate rounded-full px-3 py-1 text-sm font-semibold transition-colors duration-[140ms] ${
              layout === l.id
                ? 'text-base'
                : 'bg-raised text-text-subdued hover:bg-raised-hover hover:text-text'
            }`}
          >
            {layout === l.id && <ActivePill layoutId="mini-layout" />}
            {l.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {PARTS.map((p) => (
          <label
            key={p.key}
            className="flex items-center justify-between rounded-lg bg-raised px-3 py-2 text-sm"
          >
            {p.label}
            <Switch
              label={`Mini player: ${p.label}`}
              checked={!!parts?.[p.key]}
              disabled={!parts}
              onChange={(on) => parts && void set({ miniParts: { ...parts, [p.key]: on } })}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
