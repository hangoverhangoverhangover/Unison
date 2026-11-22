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
