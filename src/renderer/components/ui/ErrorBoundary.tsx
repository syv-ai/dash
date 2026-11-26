import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

/**
 * Catches a render error below it and shows a calm fallback in its place, so
 * one area failing leaves the rest of the window usable (a root one keeps the
 * window from going blank). Reporting is the root's `onCaughtError`
 * (main.tsx), React 19's callback for every error a boundary catches, so
 * nothing reports twice. `area` names what failed and offers "Try again"
 * (remount); without it the fallback fills the window and offers "Reload".
 * A change of `resetKey` (the task shown) clears the error.
 */
export class ErrorBoundary extends React.Component<
  {
    /** What failed, for the fallback's line ("The task sidebar"); none for the whole window. */
    area?: string;
    resetKey?: string | null;
    children: React.ReactNode;
  },
  { failed: boolean; resetKey: string | null | undefined }
> {
  state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<{ failed: boolean }> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: { resetKey?: string | null },
    state: { failed: boolean; resetKey: string | null | undefined },
  ) {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { area } = this.props;
    return (
      <div className={cn('flex h-full min-h-0 flex-col', !area && 'h-screen bg-ground')}>
        <EmptyState
          icon={<AlertTriangle size={14} strokeWidth={1.8} className="text-icon" />}
          title={area ? `${area} hit a problem` : 'Dash hit a problem'}
          description={
            area
              ? 'The rest of Dash keeps working.'
              : 'Your sessions keep running. Reload to go on.'
          }
          action={
            area ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => this.setState({ failed: false })}
              >
                Try again
              </Button>
            ) : (
              <Button size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            )
          }
        />
      </div>
    );
  }
}
