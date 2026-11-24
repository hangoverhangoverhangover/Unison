// Player page (QoL 4): your pictures and videos, and which parts of the page show.
import { create } from 'zustand'
import type { PlayerMedia, PlayerMediaScope } from '@shared/player'
import { ipcMessage } from './services'

export interface PlayerParts {
  artist: boolean
  lyrics: boolean
  queue: boolean
  visualizer: boolean
}

export type VizStyle =
  'bars' | 'mirror' | 'wave' | 'radial' | 'particles' | 'circle' | 'spectrogram' | 'shader'
export const VIZ_STYLES: readonly VizStyle[] = [
  'bars',
  'mirror',
  'wave',
  'radial',
  'particles',
  'circle',
  'spectrogram',
  'shader'
]
export type VizColor = 'accent' | 'white' | 'custom'
/** Where the visualizer sits on the Player page. */
export type VizPlacement = 'bottom' | 'cover' | 'background' | 'lyrics'
export const VIZ_PLACEMENTS: readonly VizPlacement[] = ['bottom', 'cover', 'background', 'lyrics']
export type ShaderPreset = 'liquid' | 'kaleidoscope' | 'warp'
export const SHADER_PRESETS: readonly ShaderPreset[] = ['liquid', 'kaleidoscope', 'warp']

/** One visualizer style drawn somewhere on the Player page. */
export interface VizLayer {
  style: VizStyle
  placement: VizPlacement
  /** 0.2 to 1. */
  opacity: number
}

/** Styles drawn on top of the first one (style, placement, opacity below). */
export const MAX_EXTRA_LAYERS = 2

/** How the Player page's visualizer looks and reacts (Settings → Player). */
export interface VizSettings {
  style: VizStyle
  /** Number of bars (or wave points, ring spokes). */
  bars: number
  /** Height in px when placed at the bottom. */
  height: number
  /** Multiplies the levels; 1 is as heard. */
  sensitivity: number
  color: VizColor
  /** #rrggbb, used when color is 'custom'. */
  customColor: string
  /** 0.2 to 1. */
  opacity: number
  /**
   * Spotify songs: listen to the PC's own sound (Windows loopback), since Spotify's audio
   * can't be read. Picks up every sound the PC plays. Off by default.
   */
  systemSound: boolean

  /** Fade from the main colour to a second one (the cover's second colour, or your own). */
  gradient: boolean
  /** #rrggbb, the gradient's second colour when color is 'custom'. */
  customColor2: string
  /** Spread bars evenly over octaves (bass gets more bars) instead of over Hz. */
  logScale: boolean
  /** 0 snappy to 0.95 fluid. */
  smoothing: number
  /** Small caps that sit on the bars' peaks and fall slowly. */
  peaks: boolean
  /** How fast the caps fall, in heights per second. */
  peakFall: number
  /** 0 off; higher leaves longer motion trails. */
  trails: number
  /** 0 off to 1 strong glow. */
  glow: number
  placement: VizPlacement
  /** Frame rate cap. */
  fps: 30 | 60

  /** Detect beats (bass kicks); the effects below follow them. */
  beat: boolean
  /** 0.5 (only big kicks) to 2 (every small one). */
  beatSensitivity: number
  /** The cover bumps on each beat. */
  beatCover: boolean
  /** The background flashes and zooms a little on each beat. */
  beatFlash: boolean
  /** The bars kick up on each beat. */
  beatKick: boolean
  /** The background breathes with the bass. */
  bassBackground: boolean
  /** 0.1 to 1: how much it breathes. */
  bassAmount: number

  /** Particles: how many at most. */
  particleCount: number
  /** Particles: speed multiplier. */
  particleSpeed: number
  /** Spectrogram: px it scrolls per frame. */
  spectrogramSpeed: number
  /** Circular waveform: number of rings. */
  circleRings: number
  shaderPreset: ShaderPreset
  /** 0 calm to 1 wild. */
  shaderIntensity: number
  /** More styles at once (say, a shader behind everything and bars at the bottom). */
  extraLayers: VizLayer[]
  /** Make the cover round while a style sits around it, so a ring can hug it. */
  roundCover: boolean
}

/** Every style to draw: the first one, then the extra layers. */
export function vizLayers(v: VizSettings): VizLayer[] {
  return [{ style: v.style, placement: v.placement, opacity: v.opacity }, ...v.extraLayers]
}

export const DEFAULT_VIZ: VizSettings = {
  style: 'bars',
  bars: 64,
  height: 64,
  sensitivity: 1,
  color: 'accent',
  customColor: '#ffffff',
  opacity: 1,
  systemSound: false,
  gradient: false,
  customColor2: '#ff4fa3',
  logScale: true,
  smoothing: 0.8,
  peaks: false,
  peakFall: 1,
  trails: 0,
  glow: 0,
  placement: 'bottom',
  fps: 60,
  beat: false,
  beatSensitivity: 1,
  beatCover: true,
  beatFlash: false,
  beatKick: false,
  bassBackground: false,
  bassAmount: 0.5,
  particleCount: 160,
  particleSpeed: 1,
  spectrogramSpeed: 2,
  circleRings: 2,
  shaderPreset: 'liquid',
  shaderIntensity: 0.5,
  extraLayers: [],
  roundCover: true
}
export const VIZ_LIMITS = {
  bars: [16, 128],
  height: [32, 200],
  sensitivity: [0.5, 2.5],
  opacity: [0.2, 1],
  smoothing: [0, 0.95],
  peakFall: [0.2, 3],
  trails: [0, 0.9],
  glow: [0, 1],
  beatSensitivity: [0.5, 2],
  bassAmount: [0.1, 1],
  particleCount: [20, 400],
  particleSpeed: [0.25, 3],
  spectrogramSpeed: [1, 6],
  circleRings: [1, 4],
  shaderIntensity: [0, 1]
} as const

const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d

const HEX = /^#[0-9a-f]{6}$/i
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T =>
  list.includes(v as T) ? (v as T) : d

/** Saved settings, made safe: unknown keys dropped, numbers kept in range. */
export function cleanViz(raw: unknown): VizSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const D = DEFAULT_VIZ
  const num = (k: keyof typeof VIZ_LIMITS, round = false): number => {
    const v = clamp(r[k], VIZ_LIMITS[k], D[k])
    return round ? Math.round(v) : v
  }
  const bool = (k: keyof VizSettings): boolean =>
    typeof r[k] === 'boolean' ? (r[k] as boolean) : (D[k] as boolean)
  return {
    style: oneOf(r.style, VIZ_STYLES, D.style),
    bars: num('bars', true),
    height: num('height', true),
    sensitivity: num('sensitivity'),
    color: oneOf(r.color, ['accent', 'white', 'custom'] as const, D.color),
    customColor:
      typeof r.customColor === 'string' && HEX.test(r.customColor) ? r.customColor : D.customColor,
    opacity: num('opacity'),
    systemSound: r.systemSound === true,
    gradient: bool('gradient'),
    customColor2:
      typeof r.customColor2 === 'string' && HEX.test(r.customColor2)
        ? r.customColor2
        : D.customColor2,
    logScale: bool('logScale'),
    smoothing: num('smoothing'),
    peaks: bool('peaks'),
    peakFall: num('peakFall'),
    trails: num('trails'),
    glow: num('glow'),
    placement: oneOf(r.placement, VIZ_PLACEMENTS, D.placement),
    fps: r.fps === 30 ? 30 : 60,
    beat: bool('beat'),
    beatSensitivity: num('beatSensitivity'),
    beatCover: bool('beatCover'),
    beatFlash: bool('beatFlash'),
    beatKick: bool('beatKick'),
    bassBackground: bool('bassBackground'),
    bassAmount: num('bassAmount'),
    particleCount: num('particleCount', true),
    particleSpeed: num('particleSpeed'),
    spectrogramSpeed: num('spectrogramSpeed', true),
    circleRings: num('circleRings', true),
    shaderPreset: oneOf(r.shaderPreset, SHADER_PRESETS, D.shaderPreset),
    shaderIntensity: num('shaderIntensity'),
    extraLayers: (Array.isArray(r.extraLayers) ? r.extraLayers : [])
      .slice(0, MAX_EXTRA_LAYERS)
      .map((l: unknown) => {
        const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>
        return {
          style: oneOf(o.style, VIZ_STYLES, D.style),
          placement: oneOf(o.placement, VIZ_PLACEMENTS, D.placement),
          opacity: clamp(o.opacity, VIZ_LIMITS.opacity, D.opacity)
        }
      }),
    roundCover: bool('roundCover')
  }
}

/** A saved look: everything but "Bars for Spotify songs" (that one's about privacy). */
export interface VizPreset {
  name: string
  settings: Partial<VizSettings>
}

/** Ready-made looks. They keep your colour choice unless they set their own. */
export const BUILTIN_PRESETS: readonly VizPreset[] = [
  {
    name: 'Chill',
    settings: {
      style: 'wave',
      bars: 48,
      smoothing: 0.9,
      glow: 0.35,
      gradient: true,
      bassBackground: true,
      bassAmount: 0.3
    }
  },
  {
    name: 'Club',
    settings: {
      style: 'radial',
      placement: 'cover',
      bars: 64,
      sensitivity: 1.4,
      smoothing: 0.5,
      peaks: true,
      glow: 0.6,
      gradient: true,
      beat: true,
      beatCover: true,
      beatFlash: true,
      beatKick: true,
      bassBackground: true,
      bassAmount: 0.7
    }
  },
  {
    name: 'Retro',
    settings: {
      style: 'bars',
      bars: 32,
      height: 96,
      peaks: true,
      peakFall: 0.8,
      smoothing: 0.6,
      color: 'custom',
      customColor: '#39ff88',
      customColor2: '#ffe14d',
      gradient: true,
      glow: 0.2
    }
  },
  { name: 'Minimal', settings: { style: 'bars', bars: 48, height: 48, opacity: 0.6 } },
  {
    name: 'Dreamy',
    settings: {
      style: 'shader',
      placement: 'background',
      shaderPreset: 'liquid',
      shaderIntensity: 0.4,
      opacity: 0.55,
      beat: true,
      beatCover: true,
      bassBackground: true,
      bassAmount: 0.4
    }
  },
  {
    name: 'Dreamy + bars',
    settings: {
      style: 'shader',
      placement: 'background',
      shaderPreset: 'liquid',
      shaderIntensity: 0.4,
      opacity: 0.55,
      extraLayers: [{ style: 'bars', placement: 'bottom', opacity: 0.9 }],
      peaks: true,
      gradient: true,
      beat: true,
      beatCover: true,
      bassBackground: true,
      bassAmount: 0.4
    }
  },
  {
    name: 'Galaxy',
    settings: {
      style: 'particles',
      placement: 'background',
      particleCount: 260,
      trails: 0.6,
      glow: 0.5,
      gradient: true,
      beat: true,
      beatCover: true
    }
  }
]

/**
 * Settings after choosing a preset: the defaults, your colours and the Spotify switch,
 * then the preset on top.
 */
export function applyPreset(current: VizSettings, preset: VizPreset): VizSettings {
  const rest: Partial<VizSettings> = { ...preset.settings }
  delete rest.systemSound
  return cleanViz({
    ...DEFAULT_VIZ,
    color: current.color,
    customColor: current.customColor,
    customColor2: current.customColor2,
    ...rest,
    systemSound: current.systemSound
  })
}

/** Your saved presets, made safe. */
export function cleanPresets(raw: unknown): VizPreset[] {
  if (!Array.isArray(raw)) return []
  const out: VizPreset[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const name = (p as { name?: unknown }).name
    if (typeof name !== 'string' || !name.trim() || out.some((o) => o.name === name.trim()))
      continue
    const settings: Partial<VizSettings> = cleanViz((p as { settings?: unknown }).settings)
    delete settings.systemSound
    out.push({ name: name.trim().slice(0, 40), settings })
    if (out.length >= 30) break
  }
  return out
}

const PRESETS_KEY = 'cp.vizPresets'
function readPresets(): VizPreset[] {
  try {
    return cleanPresets(JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]'))
  } catch {
    return []
  }
}

const VIZ_KEY = 'cp.playerViz'
function readViz(): VizSettings {
  try {
    return cleanViz(JSON.parse(localStorage.getItem(VIZ_KEY) ?? '{}'))
  } catch {
    return DEFAULT_VIZ
  }
}

/** Swapping between backgrounds when more than one fits the song. */
export interface SwapSettings {
  on: boolean
  /** How long a picture stays, in seconds. */
  imageSeconds: number
  /** How many times a video or GIF plays before the next background. */
  plays: number
}
export const DEFAULT_SWAP: SwapSettings = { on: false, imageSeconds: 20, plays: 1 }
export const SWAP_LIMITS = { imageSeconds: [3, 300], plays: [1, 10] } as const

export function cleanSwap(raw: unknown): SwapSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    on: r.on === true,
    imageSeconds: Math.round(
      clamp(r.imageSeconds, SWAP_LIMITS.imageSeconds, DEFAULT_SWAP.imageSeconds)
    ),
    plays: Math.round(clamp(r.plays, SWAP_LIMITS.plays, DEFAULT_SWAP.plays))
  }
}

const SWAP_KEY = 'cp.playerSwap'
function readSwap(): SwapSettings {
  try {
    return cleanSwap(JSON.parse(localStorage.getItem(SWAP_KEY) ?? '{}'))
  } catch {
    return DEFAULT_SWAP
  }
}

const PARTS_KEY = 'cp.playerParts'
const DEFAULT_PARTS: PlayerParts = { artist: true, lyrics: true, queue: true, visualizer: true }

function readParts(): PlayerParts {
  try {
    return { ...DEFAULT_PARTS, ...(JSON.parse(localStorage.getItem(PARTS_KEY) ?? '{}') as object) }
  } catch {
    return DEFAULT_PARTS
  }
}

function writePresets(presets: VizPreset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
  } catch {
    // per-device convenience only
  }
}

interface PlayerPageState {
  media: PlayerMedia[]
  error?: string
  parts: PlayerParts
  setPart(part: keyof PlayerParts, on: boolean): void
  viz: VizSettings
  setViz(patch: Partial<VizSettings>): void
  /** Your saved looks (Settings → Player → Presets). */
  presets: VizPreset[]
  choosePreset(preset: VizPreset): void
  /** Save the current look under a name (replaces one with the same name). */
  savePreset(name: string): void
  deletePreset(name: string): void
  swap: SwapSettings
  setSwap(patch: Partial<SwapSettings>): void
  add(scope: PlayerMediaScope): Promise<void>
  remove(id: string): Promise<void>
  setScope(id: string, scope: PlayerMediaScope): Promise<void>
}

export const usePlayerPage = create<PlayerPageState>((set, get) => {
  const run = async (fn: () => Promise<PlayerMedia[]>): Promise<void> => {
    try {
      set({ media: await fn(), error: undefined })
    } catch (err) {
      set({ error: ipcMessage(err) })
    }
  }
  return {
    media: [],
    parts: readParts(),
    viz: readViz(),
    swap: readSwap(),
    setSwap(patch) {
      const swap = cleanSwap({ ...get().swap, ...patch })
      try {
        localStorage.setItem(SWAP_KEY, JSON.stringify(swap))
      } catch {
        // per-device convenience only
      }
      set({ swap })
    },
    presets: readPresets(),
    choosePreset(preset) {
      get().setViz(applyPreset(get().viz, preset))
    },
    savePreset(name) {
      const n = name.trim().slice(0, 40)
      if (!n) return
      const settings: Partial<VizSettings> = { ...get().viz }
      delete settings.systemSound
      const presets = [...get().presets.filter((p) => p.name !== n), { name: n, settings }]
      writePresets(presets)
      set({ presets })
    },
    deletePreset(name) {
      const presets = get().presets.filter((p) => p.name !== name)
      writePresets(presets)
      set({ presets })
    },
    setViz(patch) {
      const viz = cleanViz({ ...get().viz, ...patch })
      try {
        localStorage.setItem(VIZ_KEY, JSON.stringify(viz))
      } catch {
        // per-device convenience only
      }
      set({ viz })
    },
    setPart(part, on) {
      const parts = { ...get().parts, [part]: on }
      try {
        localStorage.setItem(PARTS_KEY, JSON.stringify(parts))
      } catch {
        // per-device convenience only
      }
      set({ parts })
    },
    add: (scope) => run(() => window.api.invoke('player:add', scope)),
    remove: (id) => run(() => window.api.invoke('player:remove', id)),
    setScope: (id, scope) => run(() => window.api.invoke('player:setScope', id, scope))
  }
})

/** Load the media list and follow changes. Call once at startup. */
export function bindPlayerPage(): () => void {
  void window.api
    .invoke('player:list')
    .then((media) => usePlayerPage.setState({ media }))
    .catch(() => {})
  return window.api.on('player:changed', (media) => usePlayerPage.setState({ media }))
}
