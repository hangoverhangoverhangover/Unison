import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/figtree'
import './styles/app.css'

// The mini player window loads `#mini`: a light entry that never creates a playback
// controller (playback lives in the main window), so it's imported separately.
const isMini = window.location.hash === '#mini'
const root = createRoot(document.getElementById('root')!)

void (isMini ? import('./mini/MiniApp') : import('./App')).then(({ default: Entry }) =>
  root.render(
    <StrictMode>
      <Entry />
    </StrictMode>
  )
)
