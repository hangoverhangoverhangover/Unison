import EqBars from './EqBars'
import { usePlayingFrom } from '@renderer/state/playContext'
import type { View } from '@renderer/state/ui'

/** Small "playing from here" mark for a list in the sidebar / Library. */
export default function PlayingMark({ view }: { view: View }): React.JSX.Element | null {
  const playing = usePlayingFrom(view)
  if (!playing) return null
  return <EqBars className="size-3 flex-none text-accent" />
}
