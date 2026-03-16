import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // React handles displaying fallback state via getDerivedStateFromError.
  }

  public render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-state" role="alert">
          <h3>Something went wrong</h3>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={(): void => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
