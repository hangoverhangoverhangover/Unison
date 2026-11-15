import type { EntityRef } from '@shared/types'
import { useUi } from '@renderer/state/ui'

/**
 * Comma-separated names; each one with a ref opens its artist page. Names without
 * refs (local files, old cached rows) render as plain text.
 */
export default function EntityLinks({
  names,
  refs,
  kind = 'artist',
  className = ''
}: {
  names: string[]
  refs?: EntityRef[]
  kind?: 'artist' | 'album' | 'track'
  className?: string
}): React.JSX.Element {
  const setView = useUi((s) => s.setView)
  if (names.length === 0) return <span className={className}>Unknown artist</span>
  return (
    <span className={className}>
      {names.map((name, i) => {
        const ref = refs?.[i]
        return (
          <span key={`${i}:${name}`}>
            {i > 0 && ', '}
            {ref ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setView(`${kind}:${ref.id}`)
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                className="hover:text-text hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {name}
              </button>
            ) : (
              name
            )}
          </span>
        )
      })}
    </span>
  )
}
