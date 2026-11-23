import { ExternalLink, FileText, RefreshCw, Rocket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { RELEASES_URL, type UpdateStatus } from '@shared/updates'

function line(s: UpdateStatus): string {
  switch (s.state) {
    case 'unsupported':
      return 'Updates work in the installed app. This copy runs from source.'
    case 'idle':
      return 'Checks for new versions by itself.'
    case 'checking':
      return 'Checking for updates…'
    case 'current':
      return 'You have the newest version.'
    case 'downloading':
      return `Downloading version ${s.version}… ${s.percent ?? 0}%`
    case 'ready':
      return `Version ${s.version} is ready. It installs when you restart, or next time you quit.`
    case 'error':
      return s.error ?? "Couldn't check for updates."
  }
}

/** Settings → General → Updates: the version, update progress, check now, restart. */
export default function UpdatesSection(): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void window.api.invoke('updates:getStatus').then(setStatus)
    return window.api.on('updates:status', setStatus)
  }, [])

  const busy = status?.state === 'checking' || status?.state === 'downloading'
  return (
    <section className="settings-card">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">Updates</h2>
          <p className="text-sm text-text-subdued">Unison {status?.currentVersion ?? ''}</p>
        </div>
        {status?.state === 'ready' ? (
          <button
            onClick={() => void window.api.invoke('updates:install')}
            className="flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm font-bold text-on-accent transition-colors duration-[140ms] hover:bg-accent-hover"
          >
            <Rocket size={14} /> Restart to update
          </button>
        ) : (
          status?.state !== 'unsupported' && (
            <button
              onClick={() => void window.api.invoke('updates:check').then(setStatus)}
              disabled={!status || busy}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text disabled:opacity-40"
            >
              <RefreshCw size={14} className={status?.state === 'checking' ? 'animate-spin' : ''} />
              Check now
            </button>
          )
        )}
      </div>
      {status && (
        <p
          role="status"
          className={`mt-3 text-sm ${status.state === 'error' ? 'text-danger' : 'text-text-subdued'}`}
        >
          {line(status)}
        </p>
      )}
      {status?.state === 'downloading' && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-progress-track">
          <div
            className="h-full origin-left rounded-full bg-accent transition-transform duration-300"
            style={{ transform: `scaleX(${(status.percent ?? 0) / 100})` }}
          />
        </div>
      )}
      <a
        href={RELEASES_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-text-subdued hover:text-text hover:underline"
      >
        What’s new <ExternalLink size={12} />
      </a>
      {/* The app log (freezes, crashes, errors; never keys or tokens) for bug reports. */}
      <button
        onClick={() => void window.api.invoke('app:openLogs')}
        className="mt-3 ml-4 inline-flex items-center gap-1 text-sm font-semibold text-text-subdued hover:text-text hover:underline"
      >
        <FileText size={12} /> Open log folder
      </button>
    </section>
  )
}
