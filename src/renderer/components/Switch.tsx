/** On/off switch in the app's style (same look as the Discord toggle). */
export default function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** Accessible name. */
  label: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-none rounded-full transition-colors duration-[140ms] focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${
        checked ? 'bg-accent' : 'bg-raised'
      }`}
    >
      <span
        className="absolute top-0.5 left-0.5 size-5 rounded-full bg-text shadow transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)]"
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  )
}
