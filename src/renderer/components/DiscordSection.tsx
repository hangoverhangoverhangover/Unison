import { useEffect, useState } from 'react'
import type { DiscordStatus } from '@shared/discord'
import { ipcMessage } from '@renderer/state/services'
import Switch from './Switch'

/** A short status line under the description, only when something needs saying. */
function statusLine(s: DiscordStatus | null): string | undefined {
  if (!s) return 'Checking…'
  if (!s.hasKey) return s.error ?? 'Needs DISCORD_APP_ID in .env to work.'
  if (!s.enabled) return undefined
  switch (s.connection) {
    case 'connected':
      return undefined
    case 'connecting':
      return 'Connecting to Discord…'
    case 'unavailable':
      return s.error
        ? `${s.error} It reconnects on its own when Discord is running.`
        : 'Waiting for Discord to open. It connects on its own.'
    default:
      return 'Shows up once music starts.'
  }
}

/**
 * Settings → General: Discord Rich Presence on/off, laid out like the other General
 * rows (title, description, switch), with its connection status underneath.
 */
export default function DiscordRow(): React.JSX.Element {
  const [status, setStatus] = useState<DiscordStatus | null>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void window.api.invoke('discord:getStatus').then(setStatus)
    return window.api.on('discord:status', setStatus)
  }, [])

  const toggle = async (next: boolean): Promise<void> => {
    setError(undefined)
    try {
      setStatus(await window.api.invoke('discord:setEnabled', next))
    } catch (err) {
      setError(ipcMessage(err))
    }
  }

  const line = statusLine(status)
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div>
        <p className="font-bold">Show on Discord</p>
        <p className="text-sm text-text-subdued">
          Shows the song you’re playing on your Discord profile, with its artwork and a progress
          bar.
        </p>
        {line && (
          <p className="mt-1 text-xs text-text-muted" aria-live="polite">
            {line}
          </p>
        )}
        {error && <p className="mt-1 text-sm text-danger">{error}</p>}
      </div>
      <Switch
        label="Show what I’m playing on Discord"
        checked={!!status?.enabled}
        disabled={!status || !status.hasKey}
        onChange={(v) => void toggle(v)}
      />
    </div>
  )
}
