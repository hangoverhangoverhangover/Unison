import * as Slider from '@radix-ui/react-slider'
import { Download, ImagePlus, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  DEFAULT_CUSTOM_THEME,
  FONTS,
  FONT_IDS,
  THEME_LIMITS,
  contrastRatio,
  parseThemeFile,
  themeFile,
  type Backdrop,
  type CustomTheme
} from '@shared/theme'
import { useAppearance } from '@renderer/state/appearance'
import ActivePill from './ActivePill'
import { ipcMessage } from '@renderer/state/services'

/** Background pictures are downsized to this many px on the long side before saving. */
const MAX_IMAGE_SIDE = 2560

const pill = (on: boolean): string =>
  `relative isolate rounded-full px-3 py-1 text-sm font-semibold transition-colors duration-[140ms] ${
    on ? 'text-base' : 'bg-raised text-text-subdued hover:bg-raised-hover hover:text-text'
  }`
const ghost =
  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text disabled:opacity-40'

function ColorField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (hex: string) => void
}): React.JSX.Element {
  return (
    <label className="flex cursor-default items-center gap-2 rounded-xl bg-raised py-1.5 pr-3 pl-1.5 transition-colors duration-[140ms] hover:bg-raised-hover">
      <span
        className="relative size-7 overflow-hidden rounded-lg ring-1 ring-divider"
        style={{ background: value }}
      >
        <input
          type="color"
          aria-label={`${label} colour`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 size-full cursor-default opacity-0"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-text-muted uppercase tabular-nums">{value}</span>
      </span>
    </label>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-text-subdued">{label}</span>
        <span className="tabular-nums">{format(value)}</span>
      </div>
      <Slider.Root
        aria-label={label}
        className="relative mt-1.5 flex h-5 touch-none items-center"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => v !== undefined && onChange(v)}
      >
        <Slider.Track className="relative h-1 grow overflow-hidden rounded-full bg-progress-track">
          <Slider.Range className="absolute h-full rounded-full bg-accent" />
        </Slider.Track>
        <Slider.Thumb aria-label={label} className="block size-4 rounded-full bg-text shadow" />
      </Slider.Root>
    </div>
  )
}

/** Read a picture and shrink it to a JPEG data URL the app can keep. */
function loadPicture(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not a picture we can show.'))
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

const BACKDROP_LABELS: Record<Backdrop, string> = {
  solid: 'Solid',
  gradient: 'Gradient',
  image: 'Picture',
  artwork: 'Artwork'
}

/** Settings → Appearance → Custom: colours, background, glass, font, theme files. */
export default function CustomThemeEditor(): React.JSX.Element {
  const theme = useAppearance((s) => s.customTheme)
  const image = useAppearance((s) => s.customImage)
  const setAppearance = useAppearance((s) => s.set)
  const setImage = useAppearance((s) => s.setCustomImage)
  const fileRef = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  const update = (patch: Partial<CustomTheme>): void =>
    setAppearance({ customTheme: { ...theme, ...patch } })
  const fail = (err: unknown): void => setNote({ text: ipcMessage(err), bad: true })

  const pickPicture = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      await setImage(await loadPicture(file))
      update({ backdrop: 'image' })
      setNote(null)
    } catch (err) {
      fail(err)
    }
  }
  const exportTheme = async (): Promise<void> => {
    try {
      const saved = await window.api.invoke(
        'theme:exportFile',
        themeFile(theme, theme.backdrop === 'image' ? image : null)
      )
      if (saved) setNote({ text: 'Theme saved.' })
    } catch (err) {
      fail(err)
    }
  }
  const importTheme = async (): Promise<void> => {
    try {
      const text = await window.api.invoke('theme:importFile')
      if (text === null) return
      const file = parseThemeFile(text)
      if (file.image) await setImage(file.image)
      setAppearance({ customTheme: file.theme })
      setNote({ text: 'Theme loaded.' })
    } catch (err) {
      fail(err)
    }
  }

  const readable = contrastRatio(theme.text, theme.background) >= 4.5

  return (
    <div className="mt-4 rounded-xl bg-raised p-4 ring-1 ring-divider">
      <p className="text-sm font-semibold text-text-subdued">Colours</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ColorField label="Accent" value={theme.accent} onChange={(accent) => update({ accent })} />
        <ColorField
          label="Background"
          value={theme.background}
          onChange={(background) => update({ background })}
        />
        <ColorField label="Text" value={theme.text} onChange={(text) => update({ text })} />
      </div>
      {!readable && (
        <p className="mt-2 text-xs text-danger">
          Text may be hard to read on this background. Try a lighter or darker text colour.
        </p>
      )}

      <p className="mt-5 text-sm font-semibold text-text-subdued">Background</p>
      <div role="radiogroup" aria-label="Background" className="mt-2 flex flex-wrap gap-1.5">
        {(Object.keys(BACKDROP_LABELS) as Backdrop[]).map((b) => (
          <button
            key={b}
            role="radio"
            aria-checked={theme.backdrop === b}
            onClick={() =>
              b === 'image' && !image ? fileRef.current?.click() : update({ backdrop: b })
            }
            className={pill(theme.backdrop === b)}
          >
            {theme.backdrop === b && <ActivePill layoutId="theme-backdrop" />}
            {BACKDROP_LABELS[b]}
          </button>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          void pickPicture(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {theme.backdrop === 'gradient' && (
        <div className="mt-3 grid grid-cols-[auto_1fr] items-end gap-4">
          <ColorField
            label="Fades to"
            value={theme.background2}
            onChange={(background2) => update({ background2 })}
          />
          <RangeField
            label="Direction"
            value={theme.gradientAngle}
            {...THEME_LIMITS.gradientAngle}
            step={5}
            format={(v) => `${v}°`}
            onChange={(gradientAngle) => update({ gradientAngle })}
          />
        </div>
      )}
      {theme.backdrop === 'artwork' && (
        <div className="mt-3 grid grid-cols-[1fr_1fr] items-center gap-4">
          <p className="text-sm text-text-subdued">
            The playing song&apos;s cover, blurred, changing with each song.
          </p>
          <RangeField
            label="Shade"
            value={theme.imageDim}
            {...THEME_LIMITS.imageDim}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(imageDim) => update({ imageDim })}
          />
        </div>
      )}
      {theme.backdrop === 'image' && (
        <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-4">
          <div className="flex items-center gap-2">
            {image && (
              <img
                src={image}
                alt=""
                className="h-12 w-20 rounded-lg object-cover ring-1 ring-divider"
              />
            )}
            <button className={ghost} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={14} /> {image ? 'Change' : 'Choose picture'}
            </button>
            {image && (
              <button
                className={ghost}
                aria-label="Remove picture"
                title="Remove picture"
                onClick={() => {
                  void setImage(null).catch(fail)
                  update({ backdrop: 'gradient' })
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <RangeField
            label="Shade"
            value={theme.imageDim}
            {...THEME_LIMITS.imageDim}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(imageDim) => update({ imageDim })}
          />
        </div>
      )}

      <p className="mt-5 text-sm font-semibold text-text-subdued">Glass</p>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <RangeField
          label="Blur"
          value={theme.blur}
          {...THEME_LIMITS.blur}
          step={2}
          format={(v) => `${v}px`}
          onChange={(blur) => update({ blur })}
        />
        <RangeField
          label="Frost"
          value={theme.opacity}
          {...THEME_LIMITS.opacity}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(opacity) => update({ opacity })}
        />
        <RangeField
          label="Corners"
          value={theme.radius}
          {...THEME_LIMITS.radius}
          step={1}
          format={(v) => `${v}px`}
          onChange={(radius) => update({ radius })}
        />
      </div>

      <p className="mt-5 text-sm font-semibold text-text-subdued">Font</p>
      <div role="radiogroup" aria-label="Font" className="mt-2 flex flex-wrap gap-1.5">
        {FONT_IDS.map((f) => (
          <button
            key={f}
            role="radio"
            aria-checked={theme.font === f}
            onClick={() => update({ font: f })}
            className={pill(theme.font === f)}
            style={{ fontFamily: FONTS[f].stack }}
          >
            {theme.font === f && <ActivePill layoutId="theme-font" />}
            {FONTS[f].label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-1 border-t border-divider pt-3">
        <button className={ghost} onClick={() => void importTheme()}>
          <Upload size={14} /> Import theme
        </button>
        <button className={ghost} onClick={() => void exportTheme()}>
          <Download size={14} /> Export theme
        </button>
        <button
          className={`${ghost} ml-auto`}
          onClick={() => {
            setAppearance({ customTheme: DEFAULT_CUSTOM_THEME })
            setNote(null)
          }}
        >
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      {note && (
        <p
          role="status"
          className={`mt-2 text-xs ${note.bad ? 'text-danger' : 'text-text-subdued'}`}
        >
          {note.text}
        </p>
      )}
    </div>
  )
}
