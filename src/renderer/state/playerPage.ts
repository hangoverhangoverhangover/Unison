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

export type VizStyle = 'bars' | 'mirror' | 'wave'
export type VizColor = 'accent' | 'white' | 'custom'

/** How the Player page's level bars look (Settings → Player). */
export interface VizSettings {
  style: VizStyle
  /** Number of bars (or wave points). */
  bars: number
  /** Height in px. */
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
}

export const DEFAULT_VIZ: VizSettings = {
  style: 'bars',
  bars: 64,
  height: 64,
  sensitivity: 1,
  color: 'accent',
  customColor: '#ffffff',
  opacity: 1,
  systemSound: false
}
export const VIZ_LIMITS = {
  bars: [16, 128],
  height: [32, 200],
  sensitivity: [0.5, 2.5],
  opacity: [0.2, 1]
} as const

const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d

/** Saved settings, made safe: unknown keys dropped, numbers kept in range. */
export function cleanViz(raw: unknown): VizSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    style: r.style === 'mirror' || r.style === 'wave' ? r.style : 'bars',
    bars: Math.round(clamp(r.bars, VIZ_LIMITS.bars, DEFAULT_VIZ.bars)),
    height: Math.round(clamp(r.height, VIZ_LIMITS.height, DEFAULT_VIZ.height)),
    sensitivity: clamp(r.sensitivity, VIZ_LIMITS.sensitivity, DEFAULT_VIZ.sensitivity),
    color: r.color === 'white' || r.color === 'custom' ? r.color : 'accent',
    customColor:
      typeof r.customColor === 'string' && /^#[0-9a-f]{6}$/i.test(r.customColor)
        ? r.customColor
        : DEFAULT_VIZ.customColor,
    opacity: clamp(r.opacity, VIZ_LIMITS.opacity, DEFAULT_VIZ.opacity),
    systemSound: r.systemSound === true
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

interface PlayerPageState {
  media: PlayerMedia[]
  error?: string
  parts: PlayerParts
  setPart(part: keyof PlayerParts, on: boolean): void
  viz: VizSettings
  setViz(patch: Partial<VizSettings>): void
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
