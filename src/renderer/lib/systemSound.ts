// The PC's own sound output (Windows loopback), for level bars on Spotify songs, which
// the app can't read directly. Started while something needs it, stopped when nothing
// does, so Windows only shows the capture while the Player page is showing a Spotify
// song with the setting on.
import { SPECTRUM_BINS, WAVE_SAMPLES } from '@renderer/playback/audioGraph'

let users = 0
let starting: Promise<boolean> | null = null
let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let smoothing = 0.8

async function open(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    // Chromium needs a video source to share sound; drop it straight away.
    for (const t of s.getVideoTracks()) t.stop()
    if (s.getAudioTracks().length === 0) {
      s.getTracks().forEach((t) => t.stop())
      return false
    }
    if (users === 0) {
      s.getTracks().forEach((t) => t.stop())
      return false
    }
    const c = new AudioContext()
    const a = c.createAnalyser()
    a.fftSize = WAVE_SAMPLES
    a.smoothingTimeConstant = smoothing
    // Into the analyser only: never to the speakers (that would echo).
    c.createMediaStreamSource(s).connect(a)
    stream = s
    ctx = c
    analyser = a
    return true
  } catch (err) {
    console.warn('[system sound] capture failed:', err instanceof Error ? err.message : err)
    return false
  }
}

function close(): void {
  stream?.getTracks().forEach((t) => t.stop())
  void ctx?.close().catch(() => undefined)
  stream = null
  ctx = null
  analyser = null
}

/** Start listening (counted: each start needs a stop). Resolves whether it works. */
export function startSystemSound(): Promise<boolean> {
  users++
  if (analyser) return Promise.resolve(true)
  starting ??= open().finally(() => {
    starting = null
  })
  return starting
}

export function stopSystemSound(): void {
  users = Math.max(0, users - 1)
  if (users === 0) close()
}

/** Fill `out` (SPECTRUM_BINS bytes) with the system sound's levels; false when off. */
export function readSystemSpectrum(out: Uint8Array<ArrayBuffer>): boolean {
  if (!analyser) return false
  analyser.getByteFrequencyData(out)
  return true
}

/** Fill `out` (WAVE_SAMPLES bytes, 128 = silence) with the system sound's waveform. */
export function readSystemWaveform(out: Uint8Array<ArrayBuffer>): boolean {
  if (!analyser) return false
  analyser.getByteTimeDomainData(out)
  return true
}

export function setSystemSmoothing(v: number): void {
  smoothing = Math.min(0.95, Math.max(0, v))
  if (analyser) analyser.smoothingTimeConstant = smoothing
}

export function systemSampleRate(): number {
  return ctx?.sampleRate ?? 48000
}

/** Bins readSystemSpectrum fills. */
export { SPECTRUM_BINS }
