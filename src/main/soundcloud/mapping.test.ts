import { describe, expect, it } from 'vitest'
import {
  classifyAvailability,
  isPreviewUrl,
  mapComment,
  mapLike,
  mapPlaylist,
  mapSet,
  mapTrack,
  mapUser,
  normalizeWaveform,
  pickTranscoding,
  signedUrlExpiry,
  upsizeArtwork,
  type ScTrack,
  type ScTranscoding
} from './mapping'
import { extractPlaylists } from './provider'

const tc = (
  preset: string,
  protocol: string,
  mime: string,
  extra: Partial<ScTranscoding> = {}
): ScTranscoding => ({
  url: `https://api-v2.soundcloud.com/media/soundcloud:tracks:1/${preset}-${protocol}/stream/${protocol}`,
  preset,
  snipped: false,
  format: { protocol, mime_type: mime },
  ...extra
})

const AAC160 = tc('aac_160k', 'hls', 'audio/mp4; codecs="mp4a.40.2"', { quality: 'sq' })
const AAC96 = tc('aac_96k', 'hls', 'audio/mp4; codecs="mp4a.40.2"', { quality: 'lq' })
const ABR = tc('abr_sq', 'hls', 'audio/mpegurl')
const MP3_HLS = tc('mp3_1_0', 'hls', 'audio/mpeg')
const MP3_PROG = tc('mp3_1_0', 'progressive', 'audio/mpeg')
const SNIP_HLS = tc('mp3_1_0', 'hls', 'audio/mpeg', { snipped: true, duration: 30000 })
const SNIP_PROG = tc('mp3_1_0', 'progressive', 'audio/mpeg', { snipped: true, duration: 30000 })
const CTR = tc('aac_160k', 'ctr-encrypted-hls', 'audio/mp4; codecs="mp4a.40.2"')
const CBC = tc('aac_160k', 'cbc-encrypted-hls', 'audio/mp4; codecs="mp4a.40.2"')

function raw(over: Partial<ScTrack> = {}): ScTrack {
  return {
    id: 2408461857,
    kind: 'track',
    title: 'Song',
    duration: 244108,
    full_duration: 244108,
    artwork_url: 'https://i1.sndcdn.com/artworks-abc-X2W-cfzNYA-large.jpg',
    user: { id: 9, username: 'uploader', avatar_url: 'https://i1.sndcdn.com/avatars-x-large.jpg' },
    publisher_metadata: { artist: 'Real Artist', isrc: 'USX123' },
    policy: 'MONETIZE',
    streamable: true,
    media: { transcodings: [AAC160, AAC96, ABR] },
    ...over
  }
}

describe('classifyAvailability', () => {
  it('full when a clear full-length transcoding exists', () => {
    expect(classifyAvailability(raw())).toBeUndefined()
    expect(classifyAvailability(raw({ media: { transcodings: [MP3_PROG] } }))).toBeUndefined()
    // Clear HLS next to DRM ones still plays.
    expect(classifyAvailability(raw({ media: { transcodings: [CTR, CBC, AAC96] } }))).toBe(
      undefined
    )
  })

  it('preview for SNIP policy or only snipped transcodings', () => {
    expect(
      classifyAvailability(raw({ policy: 'SNIP', media: { transcodings: [SNIP_HLS, SNIP_PROG] } }))
    ).toBe('preview')
    expect(classifyAvailability(raw({ media: { transcodings: [SNIP_HLS, SNIP_PROG] } }))).toBe(
      'preview'
    )
    expect(classifyAvailability(raw({ policy: 'SNIP' }))).toBe('preview')
  })

  it('blocked for BLOCK, not streamable, or no transcodings', () => {
    expect(classifyAvailability(raw({ policy: 'BLOCK' }))).toBe('blocked')
    expect(classifyAvailability(raw({ streamable: false }))).toBe('blocked')
    expect(classifyAvailability(raw({ media: { transcodings: [] } }))).toBe('blocked')
    expect(classifyAvailability(raw({ media: null }))).toBe('blocked')
  })

  it('drm when only encrypted transcodings exist (AD_SUPPORTED shape)', () => {
    expect(classifyAvailability(raw({ media: { transcodings: [CTR, CBC] } }))).toBe('drm')
    // A clear 30 s preview next to DRM full streams is still DRM, not preview.
    expect(classifyAvailability(raw({ media: { transcodings: [CTR, CBC, SNIP_PROG] } }))).toBe(
      'drm'
    )
  })
})

describe('pickTranscoding', () => {
  it('prefers AAC 160 > AAC 96 > HLS MP3 > progressive > abr', () => {
    expect(pickTranscoding(raw({ media: { transcodings: [ABR, AAC96, AAC160] } }))).toBe(AAC160)
    expect(pickTranscoding(raw({ media: { transcodings: [ABR, MP3_HLS, AAC96] } }))).toBe(AAC96)
    expect(pickTranscoding(raw({ media: { transcodings: [MP3_PROG, ABR, MP3_HLS] } }))).toBe(
      MP3_HLS
    )
    expect(pickTranscoding(raw({ media: { transcodings: [ABR, MP3_PROG] } }))).toBe(MP3_PROG)
    expect(pickTranscoding(raw({ media: { transcodings: [ABR] } }))).toBe(ABR)
  })

  it('never picks snipped or encrypted transcodings', () => {
    expect(pickTranscoding(raw({ media: { transcodings: [CTR, CBC, SNIP_HLS] } }))).toBeUndefined()
    expect(pickTranscoding(raw({ media: { transcodings: [CTR, SNIP_PROG, MP3_PROG] } }))).toBe(
      MP3_PROG
    )
  })
})

describe('upsizeArtwork', () => {
  it('swaps the size suffix for t500x500', () => {
    expect(upsizeArtwork('https://i1.sndcdn.com/artworks-abc-X2W-cfzNYA-large.jpg')).toBe(
      'https://i1.sndcdn.com/artworks-abc-X2W-cfzNYA-t500x500.jpg'
    )
    expect(upsizeArtwork('https://i1.sndcdn.com/avatars-x-small.png')).toBe(
      'https://i1.sndcdn.com/avatars-x-t500x500.png'
    )
    expect(upsizeArtwork('https://i1.sndcdn.com/artworks-a-original.png')).toBe(
      'https://i1.sndcdn.com/artworks-a-original.png'
    )
    expect(upsizeArtwork(null)).toBeUndefined()
  })
})

describe('mapTrack', () => {
  it('maps the shared fields', () => {
    expect(mapTrack(raw())).toEqual({
      id: 'soundcloud:2408461857',
      provider: 'soundcloud',
      nativeId: '2408461857',
      title: 'Song',
      artists: ['Real Artist'],
      durationMs: 244108,
      artworkUrl: 'https://i1.sndcdn.com/artworks-abc-X2W-cfzNYA-t500x500.jpg',
      isrc: 'USX123',
      artistRefs: [{ id: 'soundcloud:9', name: 'Real Artist' }],
      uploader: 'uploader'
    })
  })

  it('links the uploader profile and the track page', () => {
    const t = mapTrack(
      raw({
        permalink_url: 'https://soundcloud.com/u/song',
        user: { id: 9, username: 'uploader', permalink_url: 'https://soundcloud.com/u' }
      })
    )
    expect(t?.url).toBe('https://soundcloud.com/u/song')
    // Display name stays the publisher artist; the link goes to the uploader.
    expect(t?.artistRefs).toEqual([
      { id: 'soundcloud:9', name: 'Real Artist', url: 'https://soundcloud.com/u' }
    ])
    expect(mapTrack(raw({ user: null, user_id: undefined }))?.artistRefs).toBeUndefined()
  })

  it('falls back to the uploader and avatar, and sets availability', () => {
    const t = mapTrack(
      raw({
        publisher_metadata: null,
        artwork_url: null,
        full_duration: undefined,
        duration: 1000,
        media: { transcodings: [CTR] }
      })
    )
    expect(t).toMatchObject({
      artists: ['uploader'],
      artworkUrl: 'https://i1.sndcdn.com/avatars-x-t500x500.jpg',
      durationMs: 1000,
      availability: 'drm'
    })
    expect(t?.isrc).toBeUndefined()
  })

  it('skips non-tracks and id-less objects', () => {
    expect(mapTrack(null)).toBeNull()
    expect(mapTrack(raw({ kind: 'playlist' }))).toBeNull()
    expect(mapTrack(raw({ id: 'abc' }))).toBeNull()
  })

  it('maps likes and skips non-track likes', () => {
    expect(
      mapLike({ created_at: '2025-08-19T02:01:58Z', kind: 'like', track: raw() })
    ).toMatchObject({ likedAt: '2025-08-19T02:01:58Z', track: { nativeId: '2408461857' } })
    expect(mapLike({ created_at: 'x', kind: 'like', track: null })).toBeNull()
  })
})

describe('mapPlaylist', () => {
  it('maps ownership, counts and artwork', () => {
    expect(
      mapPlaylist(
        {
          id: 77,
          kind: 'playlist',
          title: 'Mine',
          user_id: 9,
          user: { id: 9, username: 'me' },
          track_count: 6,
          artwork_url: null,
          tracks: [{ id: 1 }, raw()]
        },
        '9'
      )
    ).toEqual({
      id: 'soundcloud:77',
      source: 'soundcloud',
      nativeId: '77',
      name: 'Mine',
      canEdit: true,
      ownerName: 'me',
      trackCount: 6,
      artworkUrl: 'https://i1.sndcdn.com/artworks-abc-X2W-cfzNYA-t500x500.jpg'
    })
    expect(mapPlaylist({ id: 78, kind: 'playlist', user: { id: 5 } }, '9')?.canEdit).toBe(false)
    expect(mapPlaylist({ id: 'soundcloud:system-playlists:x', kind: 'playlist' }, '9')).toBeNull()
  })

  it('pulls playlists out of library wrappers', () => {
    const list = extractPlaylists([
      { type: 'playlist', playlist: { id: 1, kind: 'playlist', title: 'a' } },
      { type: 'playlist-like', playlist: { id: 2, kind: 'playlist', title: 'b' } },
      { type: 'system-playlist-like', system_playlist: { id: 'x', kind: 'system-playlist' } },
      { id: 3, kind: 'playlist', title: 'c' },
      null
    ])
    expect(list.map((p) => p.id)).toEqual([1, 2, 3])
  })
})

describe('mapComment', () => {
  it('maps timed comments and skips untimed ones', () => {
    expect(
      mapComment({
        id: 5,
        body: 'nice',
        timestamp: 361468,
        created_at: '2026-01-01T00:00:00Z',
        user: { id: 3, username: 'u', avatar_url: 'a' }
      })
    ).toEqual({
      id: '5',
      body: 'nice',
      timestampMs: 361468,
      createdAt: '2026-01-01T00:00:00Z',
      author: { id: '3', username: 'u', avatarUrl: 'a' }
    })
    expect(mapComment({ id: 6, body: 'x', timestamp: null })).toBeNull()
  })
})

describe('normalizeWaveform', () => {
  it('divides by height and clamps to 0..1', () => {
    expect(normalizeWaveform({ width: 4, height: 140, samples: [0, 70, 140, 200] })).toEqual([
      0, 0.5, 1, 1
    ])
    expect(normalizeWaveform({ samples: [5, 10] })).toEqual([0.5, 1])
    expect(normalizeWaveform(null)).toEqual([])
    expect(normalizeWaveform({ height: 10, samples: 'x' })).toEqual([])
  })
})

describe('stream URL helpers', () => {
  it('reads expires= and CloudFront Policy expiry', () => {
    expect(
      signedUrlExpiry(
        'https://playback.media-streaming.soundcloud.cloud/x/playlist.m3u8?expires=1794304014&Signature=s'
      )
    ).toBe(1794304014000)
    const policy = Buffer.from(
      JSON.stringify({
        Statement: [{ Condition: { DateLessThan: { 'AWS:EpochTime': 1700000000 } } }]
      })
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/=/g, '_')
      .replace(/\//g, '~')
    expect(signedUrlExpiry(`https://cf-preview-media.sndcdn.com/a.mp3?Policy=${policy}`)).toBe(
      1700000000000
    )
    expect(signedUrlExpiry('https://x/y')).toBeUndefined()
  })

  it('detects preview clip URLs', () => {
    expect(isPreviewUrl('https://cf-preview-media.sndcdn.com/preview/0/30/abc.128.mp3')).toBe(true)
    expect(isPreviewUrl('https://playback.media-streaming.soundcloud.cloud/a/aac_160k/b')).toBe(
      false
    )
  })
})

describe('mapSet', () => {
  const base = {
    id: 18,
    kind: 'playlist',
    title: 'Soulhack',
    track_count: 11,
    user: {
      id: 183,
      username: 'Forss',
      avatar_url: 'https://i1.sndcdn.com/avatars-a-large.jpg',
      permalink_url: 'https://soundcloud.com/forss'
    }
  }

  it('maps set_type, falling back to album only for is_album sets', () => {
    for (const t of ['album', 'ep', 'single', 'compilation'] as const)
      expect(mapSet({ ...base, set_type: t, is_album: true })?.type).toBe(t)
    expect(mapSet({ ...base, set_type: '', is_album: true })?.type).toBe('album')
    expect(mapSet({ ...base, set_type: '', is_album: false })?.type).toBe('playlist')
    expect(mapSet({ ...base })?.type).toBe('playlist')
  })

  it('takes the release date, then published_at, then display_date (date part)', () => {
    expect(mapSet({ ...base, release_date: '2003-06-02T00:00:00Z' })?.releaseDate).toBe(
      '2003-06-02'
    )
    expect(
      mapSet({ ...base, release_date: null, published_at: '2020-01-01T10:00:00Z' })?.releaseDate
    ).toBe('2020-01-01')
    expect(mapSet({ ...base, display_date: '2008-04-30T01:21:15Z' })?.releaseDate).toBe(
      '2008-04-30'
    )
    expect(mapSet({ ...base })?.releaseDate).toBeUndefined()
  })

  it('falls back from set art to the first track art to the avatar', () => {
    expect(
      mapSet({ ...base, artwork_url: 'https://i1.sndcdn.com/artworks-s-large.jpg' })
    ).toMatchObject({
      artworkUrl: 'https://i1.sndcdn.com/artworks-s-t500x500.jpg',
      artists: [{ id: 'soundcloud:183', name: 'Forss', url: 'https://soundcloud.com/forss' }],
      trackCount: 11
    })
    expect(
      mapSet({
        ...base,
        tracks: [{ id: 1, artwork_url: 'https://i1.sndcdn.com/artworks-t-large.jpg' }]
      })?.artworkUrl
    ).toBe('https://i1.sndcdn.com/artworks-t-t500x500.jpg')
    expect(mapSet({ ...base })?.artworkUrl).toBe('https://i1.sndcdn.com/avatars-a-t500x500.jpg')
    expect(mapSet({ ...base, kind: 'track' })).toBeNull()
  })
})

describe('mapUser', () => {
  it('upsizes the avatar and takes the first visual as the banner', () => {
    expect(
      mapUser({
        id: 183,
        username: 'Forss',
        avatar_url: 'https://i1.sndcdn.com/avatars-000012778523-59quu3-large.jpg',
        visuals: {
          visuals: [null, { visual_url: 'https://i1.sndcdn.com/visuals-1-original.jpg' }]
        },
        followers_count: 5,
        verified: false,
        permalink_url: 'https://soundcloud.com/forss'
      })
    ).toEqual({
      id: 'soundcloud:183',
      provider: 'soundcloud',
      nativeId: '183',
      name: 'Forss',
      imageUrl: 'https://i1.sndcdn.com/avatars-000012778523-59quu3-t500x500.jpg',
      bannerUrl: 'https://i1.sndcdn.com/visuals-1-original.jpg',
      followers: 5,
      verified: false,
      url: 'https://soundcloud.com/forss'
    })
    expect(mapUser({ id: 'x' })).toBeNull()
  })
})
