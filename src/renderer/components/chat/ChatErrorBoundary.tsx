import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Terminal } from 'lucide-react';

interface Props {
  children: ReactNode;
  onSwitchToTerminal?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ChatErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ChatErrorBoundary] Caught error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-6">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={20} strokeWidth={1.8} className="text-destructive" />
          </div>
          <h3 className="text-[14px] font-semibold text-foreground mb-2">Chat UI error</h3>
          <p className="text-[12px] text-muted-foreground mb-4">
            Something went wrong rendering the chat view. You can switch to terminal mode to
            continue working without interruption.
          </p>
          {this.state.error && (
            <pre className="text-[10px] font-mono text-destructive/70 bg-surface-0 rounded-md p-3 mb-4 text-left overflow-auto max-h-[100px]">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex items-center justify-center gap-2">
            {this.props.onSwitchToTerminal && (
              <button
                onClick={this.props.onSwitchToTerminal}
                className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors"
              >
                <Terminal size={14} strokeWidth={1.8} />
                Switch to terminal
              </button>
            )}
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 rounded-md border border-border text-[12px] font-medium text-foreground hover:bg-accent/60 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
