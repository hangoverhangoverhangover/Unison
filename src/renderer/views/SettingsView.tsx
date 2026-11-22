import { Folder, Plus, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLibrary } from '@renderer/state/library'
import type { ServiceProvider } from '@shared/ipc'
import { ipcMessage, serviceStore } from '@renderer/state/services'
import { SERVICE_NAME } from '@renderer/lib/services'
import SourceBadge from '@renderer/components/SourceBadge'
import SoundCloudTokenForm from '@renderer/components/SoundCloudTokenForm'
import SpotifyClientIdForm from '@renderer/components/SpotifyClientIdForm'
import { BehaviourSection, ShortcutsSection } from '@renderer/components/BehaviourSection'
import SoundSection from '@renderer/components/SoundSection'
import AppearanceSection from '@renderer/components/AppearanceSection'
import LastfmSection from '@renderer/components/LastfmSection'
import UpdatesSection from '@renderer/components/UpdatesSection'
import PlayerMediaSection from '@renderer/components/PlayerMediaSection'
import { useElementWidth } from '@renderer/lib/useElementWidth'
import JamSection from '@renderer/components/JamSection'
import ActivePill from '@renderer/components/ActivePill'

function ServiceSection({ provider }: { provider: ServiceProvider }): React.JSX.Element {
  const useStore = serviceStore(provider)
  const status = useStore((s) => s.status)
  const login = useStore((s) => s.login)
  const logout = useStore((s) => s.logout)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const name = SERVICE_NAME[provider]

  const run = (fn: () => Promise<void>) => async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
    } catch (err) {
      setError(ipcMessage(err))
    } finally {
      setBusy(false)
    }
  }

  let body: string
  if (!status) body = 'Checking…'
  else if (status.state === 'connected')
    body = `Connected as ${'displayName' in status ? status.displayName : status.username}.`
  else if (status.state === 'expired')
    body =
      'reason' in status && status.reason === 'permissions'
        ? 'The app needs one more Spotify permission to play music here. Log in again to grant it.'
        : provider === 'spotify'
          ? 'Your login expired (Spotify logins last six months). Log in again.'
          : 'Your SoundCloud login stopped working. Log in again.'
  else if ('hasKey' in status && !status.hasKey)
    body = 'Spotify needs a Client ID. Add your own below; it takes about five minutes.'
  else if (busy)
    body =
      provider === 'spotify'
        ? 'Finish logging in in your browser, then come back here.'
        : 'Log in to SoundCloud in the window that opened.'
  else
    body =
      provider === 'spotify'
        ? 'Not connected. Playing Spotify here needs a Premium account.'
        : 'Not connected. Log in with your SoundCloud account; no API key needed.'

  const canLogin =
    status &&
    status.state !== 'connected' &&
    !(status.state === 'disconnected' && 'hasKey' in status && !status.hasKey)

  return (
    <section className="settings-card">
      <div className="flex items-center justify-between pb-1">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <SourceBadge provider={provider} />
          {name}
        </h2>
        {status?.state === 'connected' ? (
          <button
            onClick={run(logout)}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm font-bold text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text disabled:opacity-40"
          >
            Log out
          </button>
        ) : (
          canLogin && (
            <button
              onClick={run(login)}
              disabled={busy}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-bold text-on-accent transition-colors duration-[140ms] hover:bg-accent-hover disabled:opacity-40"
            >
              {status?.state === 'expired' ? 'Log in again' : 'Connect'}
            </button>
          )
        )}
      </div>
      <p className="mt-3 text-sm text-text-subdued" aria-live="polite">
        {body}
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {provider === 'spotify' && <SpotifyClientIdForm />}
    </section>
  )
}

const GROUPS = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'sound', label: 'Sound' },
  { id: 'general', label: 'General' },
  { id: 'player', label: 'Player' },
  { id: 'jam', label: 'Jam' },
  { id: 'folders', label: 'Music folders' },
  { id: 'shortcuts', label: 'Shortcuts' }
] as const
type GroupId = (typeof GROUPS)[number]['id']

/** One Settings group: an anchor the section list scrolls to. */
function Group({ id, children }: { id: GroupId; children: React.ReactNode }): React.JSX.Element {
  return (
    <div id={`settings-${id}`} data-group={id} className="flex scroll-mt-6 flex-col gap-3">
      {children}
    </div>
  )
}

export default function SettingsView(): React.JSX.Element {
  const folders = useLibrary((s) => s.folders)
  const scan = useLibrary((s) => s.scan)
  const addFolder = useLibrary((s) => s.addFolder)
  const removeFolder = useLibrary((s) => s.removeFolder)
  const rescan = useLibrary((s) => s.rescan)
  const scanning = scan.state === 'scanning'
  const scrollRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(scrollRef)
  const narrow = width > 0 && width < 720
  const [active, setActive] = useState<GroupId>('accounts')

  // The section list follows the scroll: the group nearest the top is active.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0]
        const id = (top?.target as HTMLElement | undefined)?.dataset.group as GroupId | undefined
        if (id) setActive(id)
      },
      { root, rootMargin: '0px 0px -70% 0px' }
    )
    root.querySelectorAll('[data-group]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  const go = (id: GroupId): void => {
    setActive(id)
    document
      .getElementById(`settings-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const nav = (
    <nav
      aria-label="Settings sections"
      className={
        narrow
          ? 'flex gap-1.5 overflow-x-auto pb-1'
          : 'sticky top-6 flex w-44 flex-none flex-col gap-0.5 self-start'
      }
    >
      {GROUPS.map((g) => (
        <button
          key={g.id}
          onClick={() => go(g.id)}
          aria-current={active === g.id ? 'true' : undefined}
          className={`relative isolate flex-none rounded-lg px-3 py-1.5 text-left text-sm font-semibold transition-colors duration-[140ms] ${
            active === g.id ? 'text-text' : 'text-text-subdued hover:bg-raised hover:text-text'
          } ${narrow ? 'rounded-full' : ''}`}
        >
          {active === g.id && (
            <ActivePill layoutId="settings-nav" className="rounded-lg bg-raised-hover" />
          )}
          {g.label}
        </button>
      ))}
    </nav>
  )

  return (
    <div className="flex h-full flex-col">
      {/* Narrow windows: the section chips get their own row above the scroll area, so
          cards never slide under them. */}
      {narrow && <div className="flex-none px-8 pt-6 pb-2">{nav}</div>}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto page-fade pb-page px-8 pt-8">
        <h1 className="mb-6 text-[32px] leading-tight font-black tracking-[-0.02em]">Settings</h1>
        <div className={narrow ? '' : 'flex gap-8'}>
          {!narrow && nav}
          <div className="flex max-w-2xl min-w-0 flex-1 flex-col gap-8">
            <Group id="accounts">
              <ServiceSection provider="spotify" />
              <ServiceSection provider="soundcloud" />
              <SoundCloudTokenForm />
              <LastfmSection />
            </Group>
            <Group id="appearance">
              <AppearanceSection />
            </Group>
            <Group id="sound">
              <SoundSection />
            </Group>
            <Group id="general">
              <BehaviourSection />
              <UpdatesSection />
            </Group>
            <Group id="player">
              <PlayerMediaSection />
            </Group>
            <Group id="jam">
              <JamSection />
            </Group>
            <Group id="folders">
              <section className="settings-card">
                <div className="flex items-center justify-between pb-1">
                  <h2 className="text-lg font-bold">Music folders</h2>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void rescan()}
                      disabled={scanning || folders.length === 0}
                      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-bold text-text-subdued transition-colors duration-[140ms] hover:bg-raised hover:text-text disabled:opacity-40"
                    >
                      <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
                      Rescan
                    </button>
                    <button
                      onClick={() => void addFolder()}
                      className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-bold text-on-accent transition-colors duration-[140ms] hover:bg-accent-hover"
                    >
                      <Plus size={14} />
                      Add folder
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-sm text-text-subdued" aria-live="polite">
                  {scanning
                    ? `Scanning ${scan.scanned} of ${scan.total} files…`
                    : `${scan.trackCount} tracks in your library. New and changed files are picked up automatically.`}
                </p>

                {folders.length === 0 ? (
                  <p className="mt-6 rounded-lg bg-raised/50 px-4 py-6 text-center text-text-subdued">
                    No folders yet. Choose Add folder to point at your music.
                  </p>
                ) : (
                  <ul className="mt-4 flex flex-col gap-1">
                    {folders.map((f) => (
                      <li
                        key={f}
                        className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-[140ms] hover:bg-raised"
                      >
                        <Folder size={18} className="flex-none text-accent" />
                        <span className="min-w-0 flex-1 truncate" title={f}>
                          {f}
                        </span>
                        <button
                          aria-label={`Remove ${f}`}
                          onClick={() => void removeFolder(f)}
                          className="rounded-md p-1 text-text-muted opacity-0 transition-opacity duration-[140ms] group-hover:opacity-100 hover:text-text focus-visible:opacity-100"
                        >
                          <X size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </Group>
            <Group id="shortcuts">
              <ShortcutsSection />
            </Group>
          </div>
        </div>
      </div>
    </div>
  )
}
