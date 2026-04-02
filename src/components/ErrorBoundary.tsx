import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
  /** Render a compact inline fallback instead of a fullscreen overlay */
  inline?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  handleTryAgain = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const label = this.props.fallbackLabel ?? 'Something went wrong';

    if (this.props.inline) {
      return (
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(255, 95, 87, 0.15)',
            border: '1px solid rgba(255, 95, 87, 0.4)',
            borderRadius: 6,
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>{label}</span>
          <button
            onClick={this.handleTryAgain}
            style={{
              padding: '2px 10px',
              borderRadius: 4,
              border: 'none',
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.85)',
          color: '#fff',
          fontFamily: 'monospace',
          zIndex: 9999,
          padding: 32,
          textAlign: 'center',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 'bold' }}>{label}</div>
        {this.state.error && (
          <div
            style={{
              fontSize: 13,
              opacity: 0.7,
              maxWidth: 480,
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.message}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            onClick={this.handleTryAgain}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: '#3b82f6',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.3)',
              background: 'transparent',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
