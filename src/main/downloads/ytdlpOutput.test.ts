import { describe, expect, it } from 'vitest'
import { officialExtension, officialFileName, sanitizeFilename, uniquePath } from './naming'
import { buildArgs, cookiesFileContent, isPartialName, trackUrl } from './ytdlp'
import { DRM_ERROR, parseFileLine, parseProgressLine, redact, ytdlpError } from './ytdlpOutput'
import { join } from 'path'

describe('yt-dlp progress lines', () => {
  it('uses the total, or the estimate when the total is NA (HLS)', () => {
    expect(parseProgressLine('CP 1785 NA 2236663.0')).toBeCloseTo(1785 / 2236663)
    expect(parseProgressLine('CP 500 1000 NA')).toBe(0.5)
    expect(parseProgressLine('CP 500.0 1000.0 2000')).toBe(0.5)
  })

  it('clamps to 0.99 until the file is done', () => {
    expect(parseProgressLine('CP 4320403 4320403 NA')).toBe(0.99)
    expect(parseProgressLine('CP 5000 4000 NA')).toBe(0.99)
  })

  it('ignores lines without a usable total and other output', () => {
    expect(parseProgressLine('CP 100 NA NA')).toBeUndefined()
    expect(parseProgressLine('CP NA NA 100')).toBeUndefined()
    expect(parseProgressLine('CP 100 0 0')).toBeUndefined()
    expect(parseProgressLine('[download] 50%')).toBeUndefined()
    expect(parseProgressLine('CPFILE C:\\x.m4a')).toBeUndefined()
  })

  it('reads the final path', () => {
    expect(parseFileLine('CPFILE C:\\Music\\Forss - Flickermood ★ [293].m4a')).toBe(
      'C:\\Music\\Forss - Flickermood ★ [293].m4a'
    )
    expect(parseFileLine('CP 1 2 3')).toBeUndefined()
  })
})

describe('yt-dlp errors', () => {
  it('maps DRM to a readable message', () => {
    expect(ytdlpError('ERROR: [soundcloud] 123: This video is DRM protected\n', 1)).toBe(DRM_ERROR)
  })

  it('maps common HTTP failures', () => {
    expect(
      ytdlpError(
        'ERROR: [soundcloud] 1: Unable to download JSON metadata: HTTP Error 404: Not Found',
        1
      )
    ).toMatch(/couldn't find/)
    expect(ytdlpError('ERROR: HTTP Error 403: Forbidden', 1)).toMatch(/refused/)
    expect(ytdlpError('ERROR: <urlopen error [Errno 11001] getaddrinfo failed>', 1)).toMatch(
      /Network error/
    )
  })

  it('keeps the last ERROR line otherwise, without the extractor prefix', () => {
    expect(
      ytdlpError('WARNING: x\nERROR: first\nERROR: [soundcloud] 55: Something odd happened\n', 1)
    ).toBe('Something odd happened')
    expect(ytdlpError('', 2)).toBe('yt-dlp failed (exit code 2).')
  })

  it('redacts tokens', () => {
    const token = '2-123456-7654321-AbCdEfGhIj'
    expect(redact(`cookie oauth_token=${token}; x`)).not.toContain(token)
    expect(redact(`Authorization: OAuth ${token}`)).not.toContain(token)
    expect(redact('secret-value-xyz here', ['secret-value-xyz'])).toBe('[redacted] here')
  })
})

describe('yt-dlp args', () => {
  it('uses the API track URL, absolute ffmpeg, cookies file, never a token', () => {
    const args = buildArgs({
      ffmpegPath: 'C:\\ud\\bin\\ffmpeg.exe',
      folder: 'D:\\Music',
      scId: '293',
      cookiesFile: 'C:\\ud\\tmp\\sc-abc.txt'
    })
    expect(args.at(-1)).toBe(trackUrl('293'))
    expect(trackUrl('293')).toBe('https://api.soundcloud.com/tracks/293')
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe('C:\\ud\\bin\\ffmpeg.exe')
    expect(args[args.indexOf('--cookies') + 1]).toBe('C:\\ud\\tmp\\sc-abc.txt')
    expect(args).toContain('--progress')
    expect(args).not.toContain('--no-color')
  })

  it('writes a Netscape cookie line', () => {
    expect(cookiesFileContent('tok')).toBe(
      '# Netscape HTTP Cookie File\n.soundcloud.com\tTRUE\t/\tTRUE\t0\toauth_token\ttok\n'
    )
  })

  it('knows partial file names', () => {
    expect(isPartialName('A - B [1].m4a.part')).toBe(true)
    expect(isPartialName('A - B [1].part-Frag3')).toBe(true)
    expect(isPartialName('A - B [1].temp.m4a')).toBe(true)
    expect(isPartialName('A - B [1].webp')).toBe(true)
    expect(isPartialName('A - B [1].m4a')).toBe(false)
  })
})

describe('file names', () => {
  it('strips characters Windows rejects and trailing dots/spaces', () => {
    expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j\u0001k')).toBe('abcdefghijk')
    expect(sanitizeFilename('name. . ')).toBe('name')
    expect(sanitizeFilename('  spaced   out  ')).toBe('spaced out')
    expect(sanitizeFilename('CON')).toBe('_CON')
    expect(sanitizeFilename('???')).toBe('download')
  })

  it('caps the length without splitting emoji', () => {
    const long = '😀'.repeat(300)
    const out = sanitizeFilename(long)
    expect(Array.from(out)).toHaveLength(180)
    expect(out).toBe('😀'.repeat(180))
  })

  it('builds official names', () => {
    expect(officialFileName(['Forss'], 'Flicker/mood?', '293', 'wav')).toBe(
      'Forss - Flickermood [293].wav'
    )
    expect(officialFileName([], 'Untitled', '1', 'mp3')).toBe('Untitled [1].mp3')
    expect(officialExtension('Original.WAV')).toBe('wav')
    expect(officialExtension(undefined, 'audio/flac; x=y')).toBe('flac')
    expect(officialExtension(undefined, null)).toBe('mp3')
  })

  it('does not overwrite: appends (2), (3)', () => {
    const taken = new Set([join('F', 'a [1].mp3'), join('F', 'a [1] (2).mp3')])
    expect(uniquePath('F', 'a [1].mp3', (p) => taken.has(p))).toBe(join('F', 'a [1] (3).mp3'))
    expect(uniquePath('F', 'b.mp3', () => false)).toBe(join('F', 'b.mp3'))
  })
})
