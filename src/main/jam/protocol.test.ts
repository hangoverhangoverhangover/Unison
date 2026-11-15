import { describe, expect, it } from 'vitest'
import { addSample, bestOffset, clockSample } from './clock'
import {
  cleanCommand,
  cleanJamTrack,
  normalizeCode,
  parseCreated,
  parseServerMessage,
  roomsUrl,
  socketUrl
} from './protocol'

describe('room codes and URLs', () => {
  it('normalizes codes', () => {
    expect(normalizeCode('k7q 2mx')).toBe('K7Q2MX')
    expect(normalizeCode('K7Q-2MX')).toBe('K7Q2MX')
    expect(normalizeCode('K7Q2M')).toBeNull()
    expect(normalizeCode('K7Q2M1')).toBeNull() // 1 is not in the alphabet
    expect(normalizeCode(42)).toBeNull()
  })

  it('builds relay URLs', () => {
    expect(roomsUrl('https://r.example/')).toBe('https://r.example/rooms')
    expect(socketUrl('https://r.example/base', 'ABCDEF')).toBe(
      'wss://r.example/base/rooms/ABCDEF/ws'
    )
    expect(socketUrl('http://127.0.0.1:8787', 'ABCDEF', 'a b')).toBe(
      'ws://127.0.0.1:8787/rooms/ABCDEF/ws?secret=a%20b'
    )
  })

  it('parses the create reply', () => {
    expect(parseCreated({ code: 'abcdef', hostSecret: 's' })).toEqual({
      code: 'ABCDEF',
      hostSecret: 's'
    })
    expect(parseCreated({ code: 'abcdef' })).toBeNull()
    expect(parseCreated(null)).toBeNull()
  })
})

describe('frames', () => {
  it('accepts known frames and drops the rest', () => {
    expect(parseServerMessage('{"type":"pong","t":1,"serverTime":2}')).toEqual({
      type: 'pong',
      t: 1,
      serverTime: 2
    })
    expect(parseServerMessage('{"type":"closed"}')).toEqual({ type: 'closed', reason: '' })
    expect(parseServerMessage('{"type":"pong","t":"1","serverTime":2}')).toBeNull()
    expect(parseServerMessage('{"type":"other"}')).toBeNull()
    expect(parseServerMessage('[]')).toBeNull()
    expect(parseServerMessage(new Uint8Array(2))).toBeNull()
  })
})

describe('commands', () => {
  const track = {
    id: 'spotify:x',
    provider: 'spotify',
    nativeId: 'x',
    title: 'T',
    artists: ['A'],
    durationMs: 1,
    artworkUrl: 'file:///C:/art.jpg',
    album: 'dropped'
  }

  it('copies only JamTrack fields', () => {
    expect(cleanJamTrack(track)).toEqual({
      id: 'spotify:x',
      provider: 'spotify',
      nativeId: 'x',
      title: 'T',
      artists: ['A'],
      durationMs: 1
    })
    expect(() => cleanJamTrack({ ...track, provider: 'local' })).toThrow("Local files can't")
    expect(() => cleanJamTrack({ ...track, localPath: 'C:\\x.mp3' })).toThrow("Local files can't")
  })

  it('rebuilds commands and rejects bad ones', () => {
    expect(cleanCommand({ type: 'seek', positionMs: 1234.6, junk: 1 })).toEqual({
      type: 'seek',
      positionMs: 1235
    })
    expect(cleanCommand({ type: 'next' })).toEqual({ type: 'next' })
    expect(cleanCommand({ type: 'play', index: 2 })).toEqual({ type: 'play', index: 2 })
    expect(() => cleanCommand({ type: 'seek', positionMs: -1 })).toThrow()
    expect(() => cleanCommand({ type: 'ended' })).toThrow()
    expect(() => cleanCommand({ type: 'nuke' })).toThrow()
    expect(() => cleanCommand({ type: 'add', tracks: [] })).toThrow()
  })
})

describe('clock math', () => {
  it('offset = serverTime - (t + rtt/2), best of the last 5 by RTT', () => {
    expect(clockSample(1000, 10_000, 1100)).toEqual({ rttMs: 100, offsetMs: 8950 })
    let samples = [clockSample(0, 500, 10)] // rtt 10 offset 495
    for (let i = 1; i <= 5; i++) samples = addSample(samples, clockSample(0, 900, 50))
    // The rtt-10 sample has aged out of the last 5.
    expect(samples).toHaveLength(5)
    expect(bestOffset(samples)).toBe(875)
    expect(bestOffset([])).toBe(0)
  })
})
