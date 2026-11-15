import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { listShape } from './trackListShape'

const t = (provider: Track['provider'], album?: string): Track =>
  ({
    id: `${provider}:x`,
    provider,
    nativeId: 'x',
    title: 'x',
    artists: [],
    album,
    durationMs: 1
  }) as Track

describe('listShape', () => {
  it('single service with albums', () => {
    expect(listShape([t('spotify', 'A'), t('spotify')])).toEqual({ mixed: false, hasAlbums: true })
  })

  it('mixed services', () => {
    expect(listShape([t('spotify', 'A'), t('soundcloud')])).toEqual({
      mixed: true,
      hasAlbums: true
    })
  })

  it('no albums anywhere (blank counts as none)', () => {
    expect(listShape([t('soundcloud'), t('soundcloud', '')])).toEqual({
      mixed: false,
      hasAlbums: false
    })
  })

  it('empty list', () => {
    expect(listShape([])).toEqual({ mixed: false, hasAlbums: false })
  })
})
