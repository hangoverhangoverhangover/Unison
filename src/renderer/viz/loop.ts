// The Player page's one animation loop: reads the sound (the audio graph, or the PC's
// own sound for Spotify songs), steps the engine at the chosen frame rate, hands the
// frame to every visualizer canvas, and sets CSS variables on the page for the beat
// and bass effects (--viz-cover, --viz-flash, --viz-bass). Stops while the window is
// hidden.
import { useEffect, useRef } from 'react'
import { playback } from '@renderer/playback/controller'
import {
  readSpectrum,
  readWaveform,
  setSpectrumSmoothing,
  SPECTRUM_BINS,
  spectrumSampleRate,
  WAVE_SAMPLES
} from '@renderer/playback/audioGraph'
import {
  readSystemSpectrum,
  readSystemWaveform,
  setSystemSmoothing,
  startSystemSound,
  stopSystemSound,
  systemSampleRate
} from '@renderer/lib/systemSound'
import type { VizSettings } from '@renderer/state/playerPage'
import { createVizEngine } from './engine'
import type { VizFrame } from './types'

type Listener = (frame: VizFrame) => void
const listeners = new Set<Listener>()

/** Get each new frame; returns the unsubscribe. */
export function onVizFrame(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const VARS = ['--viz-cover', '--viz-flash', '--viz-bass'] as const

/**
 * Run the loop while `active`. `system`: read the PC's sound (Spotify songs with the
 * setting on). The page's beat/bass CSS variables are written on `root`.
 */
export function useVizLoop(
  root: React.RefObject<HTMLElement | null>,
  settings: VizSettings,
  active: boolean,
  system: boolean
): void {
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
    setSpectrumSmoothing(settings.smoothing)
    setSystemSmoothing(settings.smoothing)
  }, [settings])

  useEffect(() => {
    if (!active || !system) return
    void startSystemSound()
    return () => stopSystemSound()
  }, [active, system])

  useEffect(() => {
    const el = root.current
    if (!active) {
      for (const v of VARS) el?.style.setProperty(v, '0')
      return
    }
    const engine = createVizEngine()
    const spectrum = new Uint8Array(SPECTRUM_BINS)
    const wave = new Uint8Array(WAVE_SAMPLES)
    let raf = 0
    let last = 0
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      const s = settingsRef.current
      // Frame rate cap (a little slack so 60 Hz screens don't drop to 30).
      if (now - last < 1000 / s.fps - 2) return
      last = now
      if (document.hidden) return
      const ok = system ? readSystemSpectrum(spectrum) : readSpectrum(spectrum)
      const waveOk = ok && (system ? readSystemWaveform(wave) : readWaveform(wave))
      const frame = engine.step({
        spectrum: ok ? spectrum : null,
        wave: waveOk ? wave : null,
        sampleRate: system ? systemSampleRate() : spectrumSampleRate(),
        settings: s,
        now,
        playing: playback.getState().status === 'playing'
      })
      if (el) {
        el.style.setProperty('--viz-cover', s.beatCover ? frame.pulse.toFixed(3) : '0')
        el.style.setProperty('--viz-flash', s.beatFlash ? frame.pulse.toFixed(3) : '0')
        el.style.setProperty(
          '--viz-bass',
          s.bassBackground ? (frame.bass * s.bassAmount).toFixed(3) : '0'
        )
      }
      for (const fn of listeners) fn(frame)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      for (const v of VARS) el?.style.setProperty(v, '0')
    }
  }, [root, active, system])
}
