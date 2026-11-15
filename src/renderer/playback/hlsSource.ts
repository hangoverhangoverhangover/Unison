// The slice of hls.js the audio backend uses, plus the lazy loader and the error
// helpers. hls.js is imported dynamically so local-only playback never loads it,
// and tests inject a fake constructor instead.

/** hls.js event names (Hls.Events values) used here. */
export const HLS_EVENTS = {
  MANIFEST_PARSED: 'hlsManifestParsed',
  ERROR: 'hlsError'
} as const

/** hls.js error types (Hls.ErrorTypes values) used here. */
export const HLS_ERROR_TYPES = {
  NETWORK: 'networkError',
  MEDIA: 'mediaError',
  KEY_SYSTEM: 'keySystemError'
} as const

/** The fields of hls.js ErrorData the backend reads. */
export interface HlsErrorData {
  type: string
  details: string
  fatal: boolean
  /** Set for loader errors; `code` is the HTTP status. */
  response?: { code?: number; text?: string }
  networkDetails?: unknown
}

export interface HlsConfigLike {
  /** Seconds; -1 lets hls.js pick (start of a VOD). */
  startPosition: number
  /** A blob: worker would need `worker-src blob:` in the CSP; audio-only fMP4 doesn't need it. */
  enableWorker: boolean
  /** EME for encrypted (Widevine) streams. */
  emeEnabled?: boolean
  drmSystems?: Record<string, { licenseUrl: string }>
  drmSystemOptions?: { audioRobustness?: string }
}

export interface HlsInstance {
  attachMedia(media: HTMLMediaElement): void
  loadSource(url: string): void
  on(event: string, listener: (event: string, data: HlsErrorData) => void): void
  recoverMediaError(): void
  destroy(): void
}

export interface HlsConstructor {
  new (config: HlsConfigLike): HlsInstance
  isSupported(): boolean
}

export type HlsLoader = () => Promise<HlsConstructor>

export const loadHlsJs: HlsLoader = async () => {
  const mod = await import('hls.js')
  return mod.default as unknown as HlsConstructor
}

/** HTTP statuses that mean the signed stream URL expired or was revoked. */
const EXPIRED_STATUSES = new Set([401, 403, 404, 410])

export function httpStatusOf(data: HlsErrorData): number | undefined {
  const code = data.response?.code
  if (typeof code === 'number' && code > 0) return code
  const details = data.networkDetails as { status?: unknown } | null | undefined
  return typeof details?.status === 'number' ? details.status : undefined
}

/** A network error whose HTTP status says the signed URL is no longer valid. */
export function isExpiredUrlError(data: HlsErrorData): boolean {
  if (data.type !== HLS_ERROR_TYPES.NETWORK) return false
  const status = httpStatusOf(data)
  return status !== undefined && EXPIRED_STATUSES.has(status)
}

export function hlsErrorMessage(data: HlsErrorData): string {
  // Fatal errors are rare and hard to diagnose from the message alone; keep the detail.
  const d = data as HlsErrorData & { details?: string; url?: string; error?: { message?: string } }
  console.warn(
    '[hls]',
    data.type,
    d.details,
    httpStatusOf(data) ?? '',
    d.error?.message ?? '',
    (d.url ?? '').split('?')[0]
  )
  switch (data.type) {
    case HLS_ERROR_TYPES.NETWORK: {
      const status = httpStatusOf(data)
      return status
        ? `Couldn't load the SoundCloud stream (HTTP ${status}). Try again.`
        : "Couldn't load the SoundCloud stream. Check your connection and try again."
    }
    case HLS_ERROR_TYPES.MEDIA:
      return "The SoundCloud stream couldn't be decoded."
    case HLS_ERROR_TYPES.KEY_SYSTEM:
      return "This track is DRM-protected and can't be played here."
    default:
      return `SoundCloud playback failed (${data.details || data.type}).`
  }
}
