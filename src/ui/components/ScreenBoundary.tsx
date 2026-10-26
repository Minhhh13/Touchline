import { Component, type ErrorInfo, type ReactNode } from 'react'
import { House, RotateCcw, TriangleAlert } from 'lucide-react'

interface Props {
  children: ReactNode
  /** The screen on show: a new key (another screen or phase) clears a caught error. */
  resetKey: string
  onHome: () => void
}

interface State {
  error: Error | null
  key: string
}

/**
 * Catches a render error in the screen below it and shows a way out (home, or a reload) instead of the white page React
 * leaves when nothing catches it. The save is untouched: the store's state is not part of the render, so home and the
 * game are still there. Navigating to another screen or phase resets it.
 */
export class ScreenBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Screen error', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="page">
        <div className="panel col" role="alert" data-testid="screen-error">
          <h2 className="row">
            <TriangleAlert size={20} aria-hidden="true" /> This screen hit a problem
          </h2>
          <p className="muted">Your game and your record are saved. Go back to the home screen, or reload the page to try this screen again.</p>
          <p className="muted small mono">{this.state.error.message}</p>
          <div className="row wrap">
            <button type="button" className="btn primary" onClick={this.props.onHome} data-testid="screen-error-home">
              <House size={16} aria-hidden="true" /> Back to home
            </button>
            <button type="button" className="btn" onClick={() => location.reload()} data-testid="screen-error-reload">
              <RotateCcw size={16} aria-hidden="true" /> Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
