// Discography (discography.stream) login state for the UI. Search and playback only for
// now; it has no likes or playlists in the app yet.
import { create } from 'zustand'
import type { DiscographyStatus } from '@shared/discography'
import { ipcMessage } from './services'

interface DiscographyState {
  status: DiscographyStatus | null
  busy: boolean
  error: string | null
  login(): Promise<void>
  logout(): Promise<void>
}

export const useDiscography = create<DiscographyState>((set) => {
  const run = async (fn: () => Promise<DiscographyStatus>): Promise<void> => {
    set({ busy: true, error: null })
    try {
      set({ status: await fn(), busy: false })
    } catch (err) {
      set({ busy: false, error: ipcMessage(err) })
    }
  }
  return {
    status: null,
    busy: false,
    error: null,
    login: () => run(() => window.api.invoke('discography:login')),
    logout: () => run(() => window.api.invoke('discography:logout'))
  }
})

/** Load the status and follow discography:status. Call once at startup. */
export function bindDiscography(): () => void {
  const apply = (status: DiscographyStatus): void => useDiscography.setState({ status })
  void window.api
    .invoke('discography:getStatus')
    .then(apply)
    .catch(() => undefined)
  return window.api.on('discography:status', apply)
}
