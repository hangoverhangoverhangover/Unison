// The Player page visualizer's contracts: what the engine measures each frame, and
// what a style needs to draw it. Styles live in ./styles (2D canvas) and ./shader.ts
// (WebGL); the engine (./engine.ts) and the host canvas (VizCanvas.tsx) feed them.
import type { VizSettings } from '@renderer/state/playerPage'

/** One frame of measured sound. Arrays are reused between frames: don't keep them. */
export interface VizFrame {
  /** Per bar (settings.bars long), 0..1: scaled (log or linear), sensitivity and easing applied. */
  levels: Float32Array
  /** Per bar, 0..1: the falling peak caps. */
  peaks: Float32Array
  /** The whole spectrum, low to high (SPECTRUM_BINS long), 0..1, sensitivity applied. */
  bins: Float32Array
  /** The waveform (time domain), -1..1 (WAVE_SAMPLES long). Flat when silent. */
  wave: Float32Array
  /** 0..1 smoothed band energies. */
  bass: number
  mid: number
  treble: number
  /** 0..1 overall loudness. */
  energy: number
  /** True on the frame a beat lands (only when beat detection is on). */
  beat: boolean
  /** 1 on a beat, decaying to 0 (about a quarter second). 0 when beat detection is off. */
  pulse: number
  /** Seconds since the engine started. */
  time: number
  /** Seconds since the last frame (capped at 0.1). */
  dt: number
  /** False when paused or nothing can be read: levels fall to 0. */
  playing: boolean
}

/** The resolved colours: the main one and the gradient's second one. */
export interface VizColors {
  main: string
  second: string
}

export interface DrawArgs {
  ctx: CanvasRenderingContext2D
  /** Canvas size in device pixels. */
  w: number
  h: number
  dpr: number
  frame: VizFrame
  settings: VizSettings
  colors: VizColors
  /**
   * The fill/stroke for a shape spanning (x0,y0) to (x1,y1): a linear gradient from the
   * main to the second colour when settings.gradient is on, else the main colour.
   */
  paint(x0: number, y0: number, x1: number, y1: number): string | CanvasGradient
}

/**
 * A 2D style. The host clears the canvas (or fades it, for trails), sets globalAlpha to
 * settings.opacity and the glow (shadowBlur/shadowColor) before calling draw. Styles keep
 * their own state (particles, history) between frames.
 */
export interface VizRenderer {
  draw(args: DrawArgs): void
  dispose?(): void
}
