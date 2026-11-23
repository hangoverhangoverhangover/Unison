// Discography (discography.stream) contracts. Reference: docs/research/discography-stream.md

/** Electron session partition holding the discography.stream login (an HttpOnly cookie). */
export const DISCOGRAPHY_PARTITION = 'persist:discography'
export const DISCOGRAPHY_ORIGIN = 'https://discography.stream'

export type DiscographyStatus =
  | { state: 'disconnected' }
  /** The saved login stopped working: log in again. */
  | { state: 'expired' }
  | { state: 'connected'; username: string; userId: string; premium: boolean }

/** Discography tracks play through the app's media protocol (see main/discography). */
export function discographyStreamUrl(nativeId: string): string {
  return `media://discography/${encodeURIComponent(nativeId)}`
}
