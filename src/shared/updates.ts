// App updates (QoL 3): new versions come from the GitHub Releases of the public repo.

export type UpdateState =
  /** Running from source (npm run dev / start): updates only work in the installed app. */
  | 'unsupported'
  | 'idle'
  | 'checking'
  /** Checked: this is the newest version. */
  | 'current'
  | 'downloading'
  /** Downloaded; installs on restart (or when the app quits). */
  | 'ready'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** The version running now. */
  currentVersion: string
  /** The new version, while downloading or ready. */
  version?: string
  /** Download progress, 0-100. */
  percent?: number
  error?: string
  /** Last finished check (epoch ms). */
  checkedAt?: number
}

export const RELEASES_URL = 'https://github.com/hangoverhangoverhangover/Unison/releases'
