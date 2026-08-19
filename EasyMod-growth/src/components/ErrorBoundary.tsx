import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Growth OS] render failure', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="center-screen">
          <section className="message-panel" aria-labelledby="error-title">
            <p className="eyebrow">Growth OS</p>
            <h1 id="error-title">Something went wrong</h1>
            <p>Reload the page. If this repeats, check the Growth OS frontend logs before continuing work.</p>
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
