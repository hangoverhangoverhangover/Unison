// music:* IPC handlers, routed by provider (see router.ts).
import { ipcMain } from 'electron'
import type { InvokeChannel } from '@shared/ipc'
import { handle } from '../ipc'
import { createMusicRouter, type ProviderRegistry, type RouterHooks } from './router'

export {
  createMusicRouter,
  notConnectedMessage,
  type LikeChecker,
  type RouterHooks
} from './router'

const CHANNELS: InvokeChannel[] = [
  'music:search',
  'music:getLikes',
  'music:like',
  'music:unlike',
  'music:isLiked',
  'music:getPlaylists',
  'music:getPlaylistTracks',
  'music:getArtist',
  'music:getArtistInfo',
  'music:getAlbum',
  'music:getArtistTracks',
  'music:searchArtists',
  'music:findOn'
]

/** Registers every music:* handler. Missing providers answer "<Service> isn't connected". */
export function registerMusic(
  providers: ProviderRegistry,
  hooks: RouterHooks = {}
): { dispose(): void } {
  const router = createMusicRouter(providers, hooks)
  handle('music:search', (provider, query, page) => router.search(provider, query, page))
  handle('music:getLikes', (provider) => router.getLikes(provider))
  handle('music:like', (track) => router.like(track))
  handle('music:unlike', (track) => router.unlike(track))
  handle('music:isLiked', (trackIds) => router.isLiked(trackIds))
  handle('music:getPlaylists', (provider) => router.getPlaylists(provider))
  handle('music:getPlaylistTracks', (playlistId) => router.getPlaylistTracks(playlistId))
  handle('music:getArtist', (artistId) => router.getArtist(artistId))
  handle('music:getArtistInfo', (artistId) => router.getArtistInfo(artistId))
  handle('music:getAlbum', (albumId) => router.getAlbum(albumId))
  handle('music:getArtistTracks', (artistId) => router.getArtistTracks(artistId))
  handle('music:searchArtists', (provider, query) => router.searchArtists(provider, query))
  handle('music:findOn', (track, service) => router.findOn(track, service))
  return {
    dispose() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel)
    }
  }
}
