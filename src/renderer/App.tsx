import { AnimatePresence } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { bindMediaSession } from './playback/mediaSession'
import { bindPresence } from './playback/presence'
import { bindMiniBridge } from './playback/miniBridge'
import { bindSession } from './playback/session'
import { bindShortcuts } from './playback/shortcuts'
import { bindTray } from './playback/trayBridge'
import { playback } from './playback/controller'
import { bindLibraryEvents } from './state/library'
import { bindServiceEvents } from './state/services'
import { useUi } from './state/ui'
import { bindAppearance, useAppearance } from './state/appearance'
import { clampRightPanelWidth, clampSidebarWidth, SIDEBAR } from '@shared/layout'
import { fitPanels } from './lib/fitPanels'
import { useElementWidth } from './lib/useElementWidth'
import ResizeHandle from './components/ResizeHandle'
import PlayBar from './components/PlayBar'
import { startJam } from './playback/jamBridge'
import RightPanel from './components/RightPanel'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import Ambient from './components/Ambient'
import FindDialog from './components/FindDialog'
import QuickSearch from './components/QuickSearch'
import ZoomToast from './components/ZoomToast'
import TagEditorDialog from './components/TagEditorDialog'
import TransferDialog from './components/TransferDialog'
import DuplicatesView from './views/DuplicatesView'
import FeedView from './views/FeedView'
import FollowingView from './views/FollowingView'
import LocalFilesView from './views/LocalFilesView'
import SearchView from './views/SearchView'
import SettingsView from './views/SettingsView'
import DownloadsView from './views/DownloadsView'
import ArtistView from './views/ArtistView'
import AlbumView from './views/AlbumView'
import TrackView from './views/TrackView'
import LibraryView from './views/LibraryView'
import SmartView from './views/SmartView'
import StatsView from './views/StatsView'
import LyricsView from './views/LyricsView'
import PlayerView from './views/PlayerView'
import { bindPlayerPage } from './state/playerPage'
import { useFullscreen } from './lib/useFullscreen'
import LyricsBar from './components/LyricsBar'
import LyricsEditor from './components/LyricsEditor'
import ErrorBoundary from './components/ErrorBoundary'
import TitleFixDialog from './components/TitleFixDialog'
import AddCheckDialog from './components/AddCheckDialog'
import { bindLyrics } from './state/lyrics'
import { bindHistory } from './playback/historyBridge'
import { bindLastfm } from './playback/lastfmBridge'
import { bindHistoryEvents } from './state/history'
import { bindDownloadsEvents } from './state/downloads'
import { LikedView, PlaylistView } from './views/ServiceViews'
import { bindLikesEvents } from './state/likes'
import { bindPlaylistEvents } from './state/playlists'

export default function App(): React.JSX.Element {
  const view = useUi((s) => s.view)
  const panelOpen = useUi((s) => s.panelOpen)
  const rootRef = useRef<HTMLDivElement>(null)
  const rootWidth = useElementWidth(rootRef)
  const savedSidebar = useAppearance((s) => s.sidebarWidth)
  const rightWidth = useAppearance((s) => s.rightPanelWidth)
  const setAppearance = useAppearance((s) => s.set)
  const zoom = useAppearance((s) => s.zoom)
  // Live width while dragging the sidebar edge; saved on release.
  const [dragSidebar, setDragSidebar] = useState<number | null>(null)
  const [dragRight, setDragRight] = useState<number | null>(null)
  const shownRight = dragRight ?? rightWidth
  const fit = fitPanels(rootWidth || 10_000, dragSidebar ?? savedSidebar, shownRight, panelOpen)

  // The right panel reopens on the tab used last time (saved in prefs).
  const savedTab = useAppearance((s) => s.rightPanelTab)
  useEffect(() => {
    if (!useUi.getState().panelOpen) useUi.setState({ panelTab: savedTab })
  }, [savedTab])

  useEffect(() => bindAppearance(), [])
  useEffect(() => bindLibraryEvents(), [])
  useEffect(() => bindServiceEvents(), [])
  useEffect(() => startJam(playback), [])
  useEffect(() => bindLikesEvents(), [])
  useEffect(() => bindPlaylistEvents(), [])
  useEffect(() => bindMediaSession(playback), [])
  useEffect(() => bindPresence(playback), [])
  useEffect(() => bindSession(playback), [])
  useEffect(() => bindShortcuts(playback), [])
  useEffect(() => bindTray(playback), [])
  useEffect(() => bindHistory(playback), [])
  useEffect(() => bindLastfm(playback), [])
  useEffect(() => bindLyrics(playback), [])
  useEffect(() => bindPlayerPage(), [])
  // Full screen on the Player page: just the page and the play bar.
  const fullscreen = useFullscreen()
  const theatre = fullscreen && view === 'player'
  useEffect(() => bindHistoryEvents(), [])
  useEffect(() => bindMiniBridge(playback, (open) => useUi.getState().setMiniOpen(open)), [])
  useEffect(() => bindDownloadsEvents(), [])

  return (
    <div className="flex h-full flex-col">
      <ErrorBoundary name="background" fallback="hidden">
        <Ambient />
      </ErrorBoundary>
      {!theatre && <TitleBar />}
      <div
        ref={rootRef}
        id="zoom-root"
        className="relative flex min-h-0 flex-1 gap-2 px-2 pb-2"
        // Whole-app zoom below the title bar (the title bar must stay 40 px to line up
        // with the Windows caption buttons, which never scale).
        style={{ zoom }}
      >
        <ErrorBoundary name="sidebar">
          {!theatre && (
            <Sidebar
              width={fit.sidebar}
              handle={
                <ResizeHandle
                  side="right"
                  label="Resize sidebar"
                  value={fit.sidebar}
                  scale={zoom}
                  onChange={(px) => setDragSidebar(clampSidebarWidth(px))}
                  onCommit={(px) => {
                    setDragSidebar(null)
                    setAppearance({ sidebarWidth: clampSidebarWidth(px) })
                  }}
                  onDoubleClick={() =>
                    setAppearance({
                      sidebarWidth: fit.sidebar <= SIDEBAR.rail ? SIDEBAR.default : SIDEBAR.rail
                    })
                  }
                />
              }
            />
          )}
        </ErrorBoundary>
        <main className="glass relative min-w-0 flex-1 overflow-hidden rounded-panel">
          <div className="h-full">
            {/* Opening another page retries a page that crashed. */}
            <ErrorBoundary name={`page ${view}`} resetKey={view}>
              {view === 'local' ? (
                <LocalFilesView />
              ) : view === 'settings' ? (
                <SettingsView />
              ) : view === 'likes' ? (
                <LikedView />
              ) : view === 'search' ? (
                <SearchView />
              ) : view === 'feed' ? (
                <FeedView />
              ) : view === 'following' ? (
                <FollowingView />
              ) : view === 'duplicates' ? (
                <DuplicatesView />
              ) : view === 'player' ? (
                <PlayerView />
              ) : view === 'lyrics' ? (
                <LyricsView />
              ) : view === 'stats' ? (
                <StatsView />
              ) : view.startsWith('smart:') ? (
                <SmartView
                  kind={view.slice('smart:'.length) as 'recent' | 'on-repeat' | 'forgotten'}
                />
              ) : view === 'library' ? (
                <LibraryView />
              ) : view === 'downloads' ? (
                <DownloadsView />
              ) : view.startsWith('artist:') ? (
                <ArtistView id={view.slice('artist:'.length)} />
              ) : view.startsWith('track:') ? (
                <TrackView id={view.slice('track:'.length)} />
              ) : view.startsWith('album:') ? (
                <AlbumView id={view.slice('album:'.length)} />
              ) : (
                <PlaylistView id={view.slice('playlist:'.length)} />
              )}
            </ErrorBoundary>
          </div>
        </main>
        <AnimatePresence>
          {fit.rightOpen && !theatre && (
            <RightPanel
              key="right"
              width={shownRight}
              handle={
                <ResizeHandle
                  side="left"
                  label="Resize panel"
                  value={shownRight}
                  scale={zoom}
                  onChange={(px) => setDragRight(clampRightPanelWidth(px))}
                  onCommit={(px) => {
                    setDragRight(null)
                    setAppearance({ rightPanelWidth: clampRightPanelWidth(px) })
                  }}
                />
              }
            />
          )}
        </AnimatePresence>
        {/* Floats over the bottom of every panel; each panel's list scrolls under it. */}
        <ErrorBoundary name="lyric bar" fallback="hidden">
          <LyricsBar />
        </ErrorBoundary>
        <ErrorBoundary name="play bar" fallback="hidden">
          <PlayBar />
        </ErrorBoundary>
      </div>
      <ZoomToast />
      <FindDialog />
      <TagEditorDialog />
      <TransferDialog />
      <TitleFixDialog />
      <AddCheckDialog />
      <ErrorBoundary name="lyrics editor" fallback="hidden">
        <LyricsEditor />
      </ErrorBoundary>
      {/* Last, so quick search opened from inside a dialog shows on top of it. */}
      <QuickSearch />
    </div>
  )
}
