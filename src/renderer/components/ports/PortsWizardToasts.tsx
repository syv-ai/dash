import { useState } from 'react';
import { Check, Loader2, Plug, TriangleAlert } from 'lucide-react';
import type { PortsShow, PortsTuiToMain } from '../../../shared/portsTuiProtocol';
import { Button } from '../ui/Button';
import { toastBody } from '../ui/styles';

/**
 * Renders the ports wizard as a persistent toast. Main drives the flow (a state
 * machine over IPC) and pushes a screen at a time via `wizard:show`; the
 * `useWizardToasts` hook (its own module, so this file's only export stays a
 * component for Fast Refresh) turns each screen into a sonner toast via
 * `<WizardScreen>` and sends the user's choices back. Replaces the old side-car
 * terminal entirely.
 */

export type Send = (msg: PortsTuiToMain) => void;

/** The wizard's content; the Toaster puts every toast on `toastSurface`. */
function Card({ children }: { children: React.ReactNode }) {
  return <div className={toastBody}>{children}</div>;
}

/** An icon beside a status line, laid out like a `ToastView` row. */
function Status({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-5 shrink-0 items-center">{icon}</span>
      <div className="type-body min-w-0 flex-1 leading-5">{children}</div>
    </div>
  );
}

const spinner = (
  <Loader2 size={14} strokeWidth={1.8} className="text-icon motion-safe:animate-spin" />
);

function plural(n: number): string {
  return `${n} port${n === 1 ? '' : 's'}`;
}

/**
 * Two ways out of an in-progress setup:
 *   • Dismiss — hide the toast; the port-setup task + agent keep running.
 *   • Cancel setup task — remove the whole port-setup task (worktree + agent),
 *     guarded by an inline confirm since it's destructive.
 */
function CancelFooter({ send, onCancelTask }: { send: Send; onCancelTask: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="mt-2.5 flex items-center justify-end gap-1.5">
        <span className="type-body mr-auto">Remove the port-setup task?</span>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep
        </Button>
        <Button variant="destructive" size="sm" onClick={onCancelTask}>
          Remove task
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-2.5 flex items-center justify-end gap-1.5">
      <Button variant="ghost" size="sm" onClick={() => send({ type: 'exit', reason: 'user' })}>
        Dismiss
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Cancel setup task
      </Button>
    </div>
  );
}

/** A spinner status line over the Dismiss / Cancel-setup-task footer. */
function Working({
  send,
  onCancelTask,
  children,
}: {
  send: Send;
  onCancelTask: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <Status icon={spinner}>{children}</Status>
      <CancelFooter send={send} onCancelTask={onCancelTask} />
    </Card>
  );
}

function renderScreen(
  show: PortsShow,
  send: Send,
  onCancelTask: () => void,
): React.ReactElement | null {
  switch (show.screen) {
    case 'onboarding':
      return (
        <Card>
          <Status icon={<Plug size={14} strokeWidth={1.8} className="text-icon" />}>
            <div className="type-heading">Set up per-worktree ports?</div>
            <div>
              Dash detected port-using services. “Set it up” starts a port-setup task where an agent
              configures them, so Dash can run them from the UI, collision-free.
            </div>
          </Status>
          <div className="mt-2.5 flex items-center gap-1.5">
            {/* The permanent, project-wide dismiss is the least-likely choice, so
                it sits left and quiet, apart from the two likely actions. */}
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={() => send({ type: 'choice', screen: 'onboarding', value: 'not-relevant' })}
            >
              Never for this project
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => send({ type: 'choice', screen: 'onboarding', value: 'not-now' })}
            >
              Not now
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => send({ type: 'choice', screen: 'onboarding', value: 'setup' })}
            >
              Set it up
            </Button>
          </div>
        </Card>
      );

    case 'migrating':
      // The port-setup task doesn't exist yet (this runs in the source task),
      // so there's nothing to cancel — just a transient status.
      return (
        <Card>
          <Status icon={spinner}>Creating the port-setup task…</Status>
        </Card>
      );

    case 'waiting-ports-json':
      return (
        <Working send={send} onCancelTask={onCancelTask}>
          Setting up ports — the agent is working in the new task. Follow along in its terminal.
        </Working>
      );

    case 'config-invalid':
      return (
        <Card>
          <Status icon={<TriangleAlert size={14} strokeWidth={1.8} className="text-state-fail" />}>
            <div className="type-heading">ports.json is invalid</div>
            <ul className="mt-0.5 space-y-0.5">
              {show.props.errors.slice(0, 4).map((e, i) => (
                <li key={i} className="truncate">
                  • {e}
                </li>
              ))}
            </ul>
          </Status>
          <CancelFooter send={send} onCancelTask={onCancelTask} />
        </Card>
      );

    case 'done':
      return (
        <Card>
          <Status icon={<Check size={14} strokeWidth={1.8} className="text-icon" />}>
            <div className="type-heading">{plural(show.props.count)} allocated</div>
            <div>
              The agent is finishing any remaining work and will report back. Restart the session to
              apply the new env vars once it&apos;s done.
            </div>
          </Status>
          <div className="mt-2.5 flex items-center gap-1.5 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => send({ type: 'choice', screen: 'done', value: 'later' })}
            >
              Later
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => send({ type: 'choice', screen: 'done', value: 'restart' })}
            >
              Restart
            </Button>
          </div>
        </Card>
      );

    case 'restarting':
      return (
        <Card>
          <Status icon={spinner}>Restarting…</Status>
        </Card>
      );

    case 'exit':
      return null;
  }
}

/**
 * The wizard screen for a given `show`, rendered into a sonner toast by
 * `useWizardToasts`. Wraps the internal `renderScreen` switch so this module's
 * only export is a React component (keeps Fast Refresh happy).
 */
export function WizardScreen({
  show,
  send,
  onCancelTask,
}: {
  show: PortsShow;
  send: Send;
  onCancelTask: () => void;
}): React.ReactElement {
  return renderScreen(show, send, onCancelTask) ?? <span />;
}
