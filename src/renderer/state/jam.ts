// Jam (shared listening) state for the UI: mirrors main's JamStatus, plus what the sync
// engine (playback/jamSync.ts) reports about the current entry.
import { create } from 'zustand'
import { toJamTrack, type JamCommand, type JamStatus } from '@shared/jam'
import type { Track } from '@shared/types'
import type { JamSyncReport } from '@renderer/playback/jamSync'
import { ipcMessage } from './services'

export interface JamState extends JamSyncReport {
  status: JamStatus
  /** A start/join/leave call is in flight. */
  busy: boolean
  /** The last failed start/join/leave/send, readable; cleared by the next attempt. */
  actionError: string | null
  /** Create a room and join it as host. Resolves false (and sets actionError) on failure. */
  start(): Promise<boolean>
  /** Join a room by code (any case, spaces and dashes are fine). */
  join(code: string): Promise<boolean>
  leave(): Promise<void>
  /** Send a raw command. Resolves false (and sets actionError) on failure. */
  send(command: JamCommand): Promise<boolean>
  /** Add tracks to the Jam queue; local files are dropped with a notice. */
  add(tracks: Track[]): Promise<boolean>
  clearNotice(): void
}

const OFF: JamStatus = { state: 'off', clockOffsetMs: 0 }

export const useJam = create<JamState>((set, get) => {
  const run = async (fn: () => Promise<JamStatus>): Promise<boolean> => {
    set({ busy: true, actionError: null })
    try {
      set({ status: await fn(), busy: false })
      return true
    } catch (err) {
      set({ busy: false, actionError: ipcMessage(err) })
      return false
    }
  }
  return {
    status: OFF,
    busy: false,
    actionError: null,
    substitute: null,
    skipped: null,
    notice: null,

    start: () => run(() => window.api.invoke('jam:start')),
    join: (code) => run(() => window.api.invoke('jam:join', code)),
    leave: async () => {
      await run(() => window.api.invoke('jam:leave'))
    },
    send: async (command) => {
      set({ actionError: null })
      try {
        await window.api.invoke('jam:send', command)
        return true
      } catch (err) {
        set({ actionError: ipcMessage(err) })
        return false
      }
    },
    add: async (tracks) => {
      const jam = tracks.map(toJamTrack).filter((t) => t !== null)
      if (jam.length < tracks.length) set({ notice: "Local files can't be added to a Jam." })
      if (jam.length === 0) return false
      return get().send({ type: 'add', tracks: jam })
    },
    clearNotice: () => set({ notice: null })
  }
})

/** Load the current status and follow jam:status. Call once at startup. */
export function bindJamEvents(): () => void {
  const apply = (status: JamStatus): void => useJam.setState({ status })
  void window.api
    .invoke('jam:getStatus')
    .then(apply)
    .catch(() => undefined)
  return window.api.on('jam:status', apply)
}
