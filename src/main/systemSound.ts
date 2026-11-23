// System sound for the Player page's level bars on Spotify songs (QoL 4). Spotify plays
// encrypted audio the app can't read, so the bars can listen to what Windows is playing
// instead ("loopback"). Only the main window may ask, and only for sound: the screen
// source Chromium insists on is stopped by the renderer at once.
import { desktopCapturer, session, webContents, type WebContents } from 'electron'

export function allowSystemSound(getMain: () => WebContents | undefined): () => void {
  const ses = session.defaultSession
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      const main = getMain()
      const from = request.frame ? webContents.fromFrame(request.frame) : undefined
      if (!main || !from || from.id !== main.id || !request.audioRequested) {
        console.warn('[system sound] refused a screen/sound capture request')
        callback(null)
        return
      }
      void desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const screen = sources[0]
          if (!screen) return callback(null)
          console.log('[system sound] capture started for the level bars')
          callback({ video: screen, audio: 'loopback' })
        })
        .catch((err) => {
          console.warn('[system sound] no screen source:', err)
          callback(null)
        })
    },
    { useSystemPicker: false }
  )
  return () => ses.setDisplayMediaRequestHandler(null)
}
