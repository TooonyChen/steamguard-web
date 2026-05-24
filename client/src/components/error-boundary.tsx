import { Component, type ErrorInfo, type ReactNode } from "react"

type State = { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error:", error, info)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-svh bg-background p-6 text-foreground">
        <div className="mx-auto max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h1 className="text-lg font-medium text-destructive">Something broke in the UI</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This is usually a frontend bug — refreshing the page should recover. If it keeps
            happening, share the error below so it can be fixed.
          </p>
          <pre className="mt-4 max-h-64 overflow-auto rounded-md bg-background p-3 font-mono text-xs whitespace-pre-wrap">
            {this.state.error.name}: {this.state.error.message}
            {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-md border bg-background px-3 text-sm hover:bg-muted"
              onClick={this.reset}
            >
              Try again
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-md border bg-background px-3 text-sm hover:bg-muted"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}
