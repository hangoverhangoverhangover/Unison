import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'

interface Props {
  /** Which part of the app this guards, for the console. */
  name: string
  children: ReactNode
  /**
   * What to show after a crash. 'panel' (default): a small message with Try again.
   * 'hidden': nothing (for overlays like the lyric bar). 'page': the whole window.
   */
  fallback?: 'panel' | 'hidden' | 'page'
  /** When this changes (say, the page you open), a crashed part tries again. */
  resetKey?: unknown
}

interface State {
  error: Error | null
  resetKey: unknown
}

/**
 * Keeps a crash inside one part of the app. Without it, one component throwing while
 * drawing blanks the whole window (React unmounts everything), while music plays on.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] crashed:`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const { fallback = 'panel', name } = this.props
    if (fallback === 'hidden') return null
    const retry = (): void =>
      fallback === 'page' ? window.location.reload() : this.setState({ error: null })
    return (
      <div
        role="alert"
        className={`flex flex-col items-center justify-center gap-3 p-6 text-center ${
          fallback === 'page' ? 'h-full bg-base text-text' : 'h-full'
        }`}
      >
        <p className="font-bold">
          {fallback === 'page' ? 'Unison hit a problem' : 'This part hit a problem'}
        </p>
        <p className="max-w-sm text-sm text-text-subdued">
          {fallback === 'page'
            ? 'Music keeps playing. Reload to bring the window back.'
            : 'The rest of the app still works.'}{' '}
          <span className="text-text-muted">({name})</span>
        </p>
        <button
          onClick={retry}
          className="flex items-center gap-2 rounded-full bg-raised px-4 py-1.5 text-sm font-semibold transition-colors duration-[140ms] hover:bg-raised-hover"
        >
          <RotateCcw size={14} /> {fallback === 'page' ? 'Reload' : 'Try again'}
        </button>
      </div>
    )
  }
}
