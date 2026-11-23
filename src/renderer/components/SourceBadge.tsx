import type { Provider } from '@shared/types'

const LABEL: Record<Provider, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  discography: 'Discography',
  local: 'Local file'
}

const COLOR: Record<Provider, string> = {
  spotify: 'text-spotify',
  soundcloud: 'text-soundcloud',
  discography: 'text-discography',
  local: 'text-local'
}

/** Small, consistent marker for where a track comes from. Only the glyph is colored. */
export default function SourceBadge({
  provider,
  className = ''
}: {
  provider: Provider
  className?: string
}): React.JSX.Element {
  return (
    <span
      title={LABEL[provider]}
      aria-label={LABEL[provider]}
      className={`inline-flex size-4 flex-none items-center justify-center rounded-sm bg-raised ${COLOR[provider]} ${className}`}
    >
      <svg viewBox="0 0 16 16" className="size-3" fill="currentColor" aria-hidden>
        {provider === 'spotify' && (
          <path d="M3.2 5.6c3-.9 6.8-.6 9.6 1a.7.7 0 1 0 .7-1.2C10.4 3.6 6.2 3.3 2.8 4.3a.7.7 0 1 0 .4 1.3Zm.5 2.6c2.4-.7 5.4-.4 7.6.9a.6.6 0 1 0 .6-1c-2.5-1.5-5.8-1.8-8.6-1a.6.6 0 1 0 .4 1.1Zm.4 2.4c2-.5 4.2-.3 5.9.7a.5.5 0 1 0 .5-.9c-2-1.1-4.4-1.4-6.6-.8a.5.5 0 1 0 .2 1Z" />
        )}
        {provider === 'soundcloud' && (
          <path d="M9.6 5a3.3 3.3 0 0 1 3.2 2.6 2.2 2.2 0 1 1 .4 4.4H9.1V5.4c.2-.2.3-.4.5-.4ZM8.1 6v6H7.2V6.4c.3-.2.6-.3.9-.4ZM6.2 7v5h-.9V7.3Zm-1.9 1v4h-.9V8Zm-1.9 1.1V12h-.9V9.1Z" />
        )}
        {provider === 'discography' && (
          // A record: the disc with its centre hole.
          <path
            fillRule="evenodd"
            d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 4.6a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Zm0 1.3a.6.6 0 1 1 0 1.2.6.6 0 0 1 0-1.2Z"
          />
        )}
        {provider === 'local' && (
          <path d="M3 2.5A1.5 1.5 0 0 1 4.5 1h4.9L13 4.6v8.9a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-11Zm6 0V5a.5.5 0 0 0 .5.5h2.4L9 2.5ZM8.5 7.2v3.6a1.4 1.4 0 1 0 1 1.3V8.6l1.6-.4v-1Z" />
        )}
      </svg>
    </span>
  )
}
