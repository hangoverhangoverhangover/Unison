import * as Slider from '@radix-ui/react-slider'
import { Check } from 'lucide-react'
import { useState } from 'react'
import type { Theme } from '@shared/config'
import { ZOOM, clampZoom } from '@shared/layout'
import { useAppearance } from '@renderer/state/appearance'

const THEMES: { theme: Theme; label: string; note: string; swatch: string }[] = [
  {
    theme: 'artwork',
    label: 'Artwork',
    note: 'Colours from what’s playing',
    swatch:
      'radial-gradient(70% 70% at 20% 20%, #ea580c, transparent 70%), radial-gradient(70% 70% at 90% 80%, #7e22ce, transparent 70%), #1d1b3a'
  },
  {
    theme: 'dark',
    label: 'Dark',
    note: 'Calm dark glass',
    swatch: 'radial-gradient(80% 80% at 20% 0%, rgba(114,137,218,0.35), transparent 70%), #101119'
  },
  {
    theme: 'light',
    label: 'Light',
    note: 'Bright white glass',
    swatch:
      'radial-gradient(70% 70% at 10% 0%, #b0beff, transparent 70%), radial-gradient(70% 70% at 95% 90%, #ffc4d6, transparent 70%), #eceff6'
  }
]

/** Settings → Appearance: theme and whole-app zoom. */
export default function AppearanceSection(): React.JSX.Element {
  const theme = useAppearance((s) => s.theme)
  const zoom = useAppearance((s) => s.zoom)
  const set = useAppearance((s) => s.set)
  // While dragging, show the value but apply it on release.
  const [draft, setDraft] = useState<number | null>(null)
  const shownZoom = draft ?? zoom
  const percent = Math.round(shownZoom * 100)

  return (
    <section className="settings-card">
      <h2 className="text-lg font-bold">Appearance</h2>

      <p className="mt-4 text-sm font-semibold text-text-subdued">Theme</p>
      <div role="radiogroup" aria-label="Theme" className="mt-2 grid grid-cols-3 gap-2">
        {THEMES.map((t) => {
          const on = theme === t.theme
          return (
            <button
              key={t.theme}
              role="radio"
              aria-checked={on}
              onClick={() => set({ theme: t.theme })}
              className={`group rounded-xl p-2 text-left ring-1 transition-colors duration-[140ms] ${
                on ? 'bg-raised-hover ring-accent' : 'ring-divider hover:bg-raised'
              }`}
            >
              <span
                className="relative block h-16 overflow-hidden rounded-lg ring-1 ring-black/10"
                style={{ background: t.swatch }}
              >
                {/* A tiny frosted panel so each swatch reads as glass. */}
                <span
                  className={`absolute right-2 bottom-2 left-2 h-5 rounded-md ${
                    t.theme === 'light' ? 'bg-white/60' : 'bg-black/30'
                  }`}
                />
                {on && (
                  <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-on-accent">
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className="mt-2 block px-1 font-semibold">{t.label}</span>
              <span className="block px-1 text-xs text-text-subdued">{t.note}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-sm font-semibold text-text-subdued">Zoom</p>
        <span className="text-sm tabular-nums">{percent}%</span>
      </div>
      <div className="mt-2 flex items-center gap-4">
        <Slider.Root
          aria-label="Zoom"
          className="group relative flex h-5 flex-1 touch-none items-center"
          min={ZOOM.min}
          max={ZOOM.max}
          step={ZOOM.sliderStep}
          value={[shownZoom]}
          onValueChange={([v]) => v !== undefined && setDraft(clampZoom(v))}
          onValueCommit={([v]) => {
            setDraft(null)
            if (v !== undefined) set({ zoom: clampZoom(v) })
          }}
        >
          <Slider.Track className="relative h-1 grow overflow-hidden rounded-full bg-progress-track">
            <Slider.Range className="absolute h-full rounded-full bg-accent" />
          </Slider.Track>
          <Slider.Thumb className="block size-4 rounded-full bg-text shadow" />
        </Slider.Root>
        <button
          onClick={() => set({ zoom: 1 })}
          disabled={zoom === 1}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text disabled:opacity-40"
        >
          Reset
        </button>
      </div>
      <p className="mt-2 text-xs text-text-muted">Ctrl + and Ctrl − zoom too; Ctrl 0 resets.</p>
    </section>
  )
}
