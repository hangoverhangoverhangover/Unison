import { useDiscography } from '@renderer/state/discography'
import SourceBadge from './SourceBadge'

/**
 * Settings → Accounts → Discography: log in to discography.stream in an app window
 * (Discord or Google), log out. Search and playback only for now.
 */
export default function DiscographySection(): React.JSX.Element {
  const status = useDiscography((s) => s.status)
  const busy = useDiscography((s) => s.busy)
  const error = useDiscography((s) => s.error)
  const login = useDiscography((s) => s.login)
  const logout = useDiscography((s) => s.logout)

  let body: string
  if (!status) body = 'Checking…'
  else if (status.state === 'connected')
    body = `Connected as ${status.username}${status.premium ? ' (Premium)' : ''}. Its songs show up in Search.`
  else if (status.state === 'expired')
    body = 'Your Discography login stopped working. Log in again.'
  else if (busy)
    body =
      'Log in in the window that opened. Discord works best; Google may refuse to sign in inside an app.'
  else
    body =
      'Not connected. Log in with your discography.stream account to search and play its songs.'

  return (
    <section className="settings-card">
      <div className="flex items-center justify-between pb-1">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <SourceBadge provider="discography" />
          Discography
        </h2>
        {status?.state === 'connected' ? (
          <button
            onClick={() => void logout()}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm font-bold text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text disabled:opacity-40"
          >
            Log out
          </button>
        ) : (
          status && (
            <button
              onClick={() => void login()}
              disabled={busy}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-bold text-on-accent transition-colors duration-[140ms] hover:bg-accent-hover disabled:opacity-40"
            >
              {status.state === 'expired' ? 'Log in again' : 'Connect'}
            </button>
          )
        )}
      </div>
      <p className="mt-3 text-sm text-text-subdued" aria-live="polite">
        {body}
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  )
}
