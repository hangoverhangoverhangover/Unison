import type { SmartPlaylistKind } from '@shared/history'

export const SMART_KINDS: SmartPlaylistKind[] = ['recent', 'on-repeat', 'forgotten']

export const SMART_META: Record<
  SmartPlaylistKind,
  { name: string; gradient: string; empty: string }
> = {
  recent: {
    name: 'Recently played',
    gradient: 'from-[#3b4a8a] to-[#23283d]',
    empty: 'Tracks show up here once you have listened to them for 30 seconds.'
  },
  'on-repeat': {
    name: 'On repeat',
    gradient: 'from-accent to-[#5a3b8a]',
    empty: 'Play a track three times in a month and it shows up here.'
  },
  forgotten: {
    name: 'Forgotten favourites',
    gradient: 'from-[#8a5a3b] to-[#3b2a4a]',
    empty: 'Tracks you played a lot but not for two months show up here. Give it time.'
  }
}
