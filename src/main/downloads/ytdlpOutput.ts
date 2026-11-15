// Parsing yt-dlp output: progress lines, the final path, and readable errors.

/** Line prefix from `--progress-template "download:CP ..."`. */
export const PROGRESS_PREFIX = 'CP '
/** Line prefix from `--print "after_move:CPFILE %(filepath)s"`. */
export const FILE_PREFIX = 'CPFILE '

export const DRM_ERROR = "This track is DRM-protected and can't be downloaded."
export const PREVIEW_ERROR =
  'Only a 30-second preview is available. Log in to SoundCloud with Go+ to download it.'

function num(s: string | undefined): number | undefined {
  if (s === undefined || s === 'NA' || s === 'None') return undefined
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * `CP <downloaded> <total> <estimate>` (any may be NA) -> 0..0.99, or undefined when the
 * line isn't a progress line or has no usable total.
 */
export function parseProgressLine(line: string): number | undefined {
  if (!line.startsWith(PROGRESS_PREFIX)) return undefined
  const [downloaded, total, estimate] = line.slice(PROGRESS_PREFIX.length).trim().split(/\s+/)
  const got = num(downloaded)
  const of = num(total) || num(estimate)
  if (got === undefined || !of) return undefined
  return Math.min(0.99, Math.max(0, got / of))
}

/** `CPFILE <path>` -> path. */
export function parseFileLine(line: string): string | undefined {
  if (!line.startsWith(FILE_PREFIX)) return undefined
  const path = line.slice(FILE_PREFIX.length).trim()
  return path || undefined
}

/**
 * Remove anything that looks like a SoundCloud oauth token (and the given literal tokens)
 * from text before it's logged or stored.
 */
export function redact(text: string, secrets: readonly (string | undefined)[] = []): string {
  let out = text
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[redacted]')
  return out
    .replace(/\b\d-\d{4,}-\d{4,}-[A-Za-z0-9]{6,}\b/g, '[redacted]')
    .replace(
      /(oauth_token|OAuth|Authorization|access_token)([=:\s"']+)[^\s"'&;,]+/gi,
      '$1$2[redacted]'
    )
}

const MAX_ERROR = 300

/** Map yt-dlp stderr (already redacted) and exit code to a short readable message. */
export function ytdlpError(stderr: string, code: number | null): string {
  const text = stderr.toLowerCase()
  if (/\bdrm\b/.test(text)) return DRM_ERROR
  if (/ffmpeg.*not found|ffmpeg not found|ffprobe and ffmpeg not found/.test(text))
    return 'ffmpeg is missing. Restart the app to reinstall it.'
  if (/http error 404|404: not found/.test(text))
    return "SoundCloud couldn't find this track. It may have been removed or made private."
  if (/http error 401/.test(text))
    return 'SoundCloud rejected the login. Log in again in Settings and retry.'
  if (/http error 403|geo.?restrict|not available in your (country|location)/.test(text))
    return 'SoundCloud refused the download (blocked or region-locked).'
  if (/http error 429/.test(text)) return 'SoundCloud is rate-limiting downloads. Retry in a while.'
  if (
    /getaddrinfo|timed out|connection (reset|refused|aborted)|network is unreachable|urlopen error/.test(
      text
    )
  )
    return 'Network error. Check your connection and retry.'
  if (/no space left|errno 28/.test(text)) return 'The download folder is out of disk space.'
  if (/permission denied|errno 13|access is denied/.test(text))
    return "Couldn't write to the download folder (permission denied)."

  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const last = [...lines].reverse().find((l) => l.startsWith('ERROR:'))
  if (last) {
    const msg = last
      .replace(/^ERROR:\s*/, '')
      .replace(/^\[[^\]]+\]\s*[^:\s]+:\s*/, '')
      .trim()
    if (msg) return msg.length > MAX_ERROR ? `${msg.slice(0, MAX_ERROR - 1)}…` : msg
  }
  return code === null ? 'yt-dlp stopped unexpectedly.' : `yt-dlp failed (exit code ${code}).`
}
