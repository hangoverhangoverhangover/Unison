import { describe, expect, it } from 'vitest'
import type { Playlist } from '@shared/types'
import { orderPlaylists, reorder } from './playlistOrder'

const pl = (id: string): Playlist => ({
  id,
  source: id.split(':')[0] as Playlist['source'],
  nativeId: id.split(':')[1]!,
  name: id,
  canEdit: true
})

describe('orderPlaylists', () => {
  it('puts unsaved playlists first (app ones on top), then the saved order', () => {
    const all = [pl('spotify:a'), pl('app:new'), pl('soundcloud:b'), pl('spotify:c')]
    const order = orderPlaylists(all, { order: ['spotify:c', 'gone:x', 'spotify:a'], hidden: [] })
    expect(order.map((p) => p.id)).toEqual(['app:new', 'soundcloud:b', 'spotify:c', 'spotify:a'])
  })
})

describe('reorder', () => {
  it('moves visible playlists and keeps hidden ones in place', () => {
    const current = [pl('app:1'), pl('spotify:h'), pl('app:2'), pl('app:3')]
    const next = reorder(
      current,
      new Set(['spotify:h']),
      ['app:3', 'app:1', 'app:2'],
      ['soundcloud:off']
    )
    expect(next).toEqual(['app:3', 'spotify:h', 'app:1', 'app:2', 'soundcloud:off'])
  })
})
