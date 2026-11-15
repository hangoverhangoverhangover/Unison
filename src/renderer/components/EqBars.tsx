/** Three bouncing bars: "this is playing". Static when the OS asks for reduced motion. */
export default function EqBars({
  className = 'size-3.5'
}: {
  className?: string
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 14 14"
      className={`eq-bars ${className}`}
      fill="currentColor"
      aria-label="Playing"
    >
      <rect x="1" y="1" width="3" height="12" rx="1" />
      <rect x="5.5" y="1" width="3" height="12" rx="1" />
      <rect x="10" y="1" width="3" height="12" rx="1" />
    </svg>
  )
}
