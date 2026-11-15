import * as Slider from '@radix-ui/react-slider'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_AUDIO, EQ_BANDS_HZ, type AudioSettings } from '@shared/playback'
import { publishAudioSettings } from '@renderer/playback/audioSettingsBus'
import { ipcMessage } from '@renderer/state/services'
import Switch from './Switch'

const PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-2, -2, -1, 1, 3, 3, 2, 1, 0, -1],
  Loudness: [5, 4, 2, 0, -1, 0, 1, 2, 4, 5]
}

const label = (hz: number): string => (hz >= 1000 ? `${hz / 1000}k` : String(hz))

function Band({
  hz,
  value,
  disabled,
  onChange
}: {
  hz: number
  value: number
  disabled: boolean
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs text-text-subdued tabular-nums">
        {value > 0 ? `+${value}` : value}
      </span>
      <Slider.Root
        orientation="vertical"
        min={-12}
        max={12}
        step={1}
        value={[value]}
        disabled={disabled}
        onValueChange={([v]) => onChange(v ?? 0)}
        className="relative flex h-32 w-5 touch-none flex-col items-center select-none data-[disabled]:opacity-40"
        aria-label={`${label(hz)} Hz`}
      >
        <Slider.Track className="relative w-1 grow rounded-full bg-progress-track">
          <Slider.Range className="absolute w-full rounded-full bg-accent" />
        </Slider.Track>
        <Slider.Thumb className="block size-3.5 rounded-full bg-text shadow focus-visible:outline-2 focus-visible:outline-accent" />
      </Slider.Root>
      <span className="text-xs text-text-subdued">{label(hz)}</span>
    </div>
  )
}

/**
 * Settings: volume levelling, crossfade and the equalizer. They apply to SoundCloud
 * and local files; Spotify and protected SoundCloud tracks play outside the app's
 * audio processing.
 */
export default function SoundSection(): React.JSX.Element {
  const [audio, setAudio] = useState<AudioSettings | null>(null)
  const [error, setError] = useState<string>()
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    void window.api.invoke('audio:get').then(setAudio, () => setAudio(DEFAULT_AUDIO))
    return () => clearTimeout(saveTimer.current)
  }, [])

  // Apply at once; save after the slider settles.
  const update = (next: AudioSettings): void => {
    setAudio(next)
    publishAudioSettings(next)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.api.invoke('audio:set', next).then(
        () => setError(undefined),
        (err: unknown) => setError(ipcMessage(err))
      )
    }, 400)
  }

  const a = audio ?? DEFAULT_AUDIO
  const seconds = Math.round(a.crossfadeMs / 1000)
  return (
    <section className="settings-card">
      <h2 className="pb-1 text-lg font-bold">Sound</h2>
      <p className="mt-3 text-sm text-text-subdued">
        For SoundCloud and local files. Spotify, and SoundCloud tracks that only come as protected
        streams, play outside the app&apos;s audio processing.
      </p>
      <div className="flex items-center justify-between gap-6 py-3">
        <div>
          <p className="font-bold">Volume levelling</p>
          <p className="text-sm text-text-subdued">Evens out loud and quiet tracks as they play.</p>
        </div>
        <Switch
          label="Volume levelling"
          checked={a.levelling}
          disabled={!audio}
          onChange={(v) => update({ ...a, levelling: v })}
        />
      </div>
      <div className="py-3">
        <div className="flex items-center justify-between">
          <p className="font-bold">Crossfade</p>
          <span className="text-sm text-text-subdued tabular-nums">
            {seconds === 0 ? 'Off' : `${seconds} s`}
          </span>
        </div>
        <Slider.Root
          min={0}
          max={12}
          step={1}
          value={[seconds]}
          disabled={!audio}
          onValueChange={([v]) => update({ ...a, crossfadeMs: (v ?? 0) * 1000 })}
          className="relative mt-3 flex h-5 w-full touch-none items-center select-none"
          aria-label="Crossfade seconds"
        >
          <Slider.Track className="relative h-1 grow rounded-full bg-progress-track">
            <Slider.Range className="absolute h-full rounded-full bg-accent" />
          </Slider.Track>
          <Slider.Thumb className="block size-3.5 rounded-full bg-text shadow focus-visible:outline-2 focus-visible:outline-accent" />
        </Slider.Root>
      </div>
      <div className="py-3">
        <div className="flex items-center justify-between gap-6">
          <p className="font-bold">Equalizer</p>
          <Switch
            label="Equalizer"
            checked={a.eq.enabled}
            disabled={!audio}
            onChange={(v) => update({ ...a, eq: { ...a.eq, enabled: v } })}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(PRESETS).map(([name, gains]) => (
            <button
              key={name}
              disabled={!a.eq.enabled}
              onClick={() => update({ ...a, eq: { ...a.eq, gains } })}
              className="rounded-full bg-raised px-3 py-1 text-sm font-bold text-text-subdued transition-colors duration-[140ms] hover:text-text disabled:opacity-40"
            >
              {name}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-between rounded-lg bg-raised/40 px-4 py-4">
          {EQ_BANDS_HZ.map((hz, i) => (
            <Band
              key={hz}
              hz={hz}
              value={a.eq.gains[i] ?? 0}
              disabled={!a.eq.enabled}
              onChange={(v) => {
                const gains = [...a.eq.gains]
                gains[i] = v
                update({ ...a, eq: { ...a.eq, gains } })
              }}
            />
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  )
}
