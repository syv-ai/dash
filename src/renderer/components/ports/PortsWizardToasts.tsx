import { useState } from 'react';
import { Loader2, Plug, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { PortsShow, PortsTuiToMain } from '../../../shared/portsTuiProtocol';

/**
 * Renders the ports wizard as a persistent toast. Main drives the flow (a state
 * machine over IPC) and pushes a screen at a time via `wizard:show`; the
 * `useWizardToasts` hook (its own module, so this file's only export stays a
 * component for Fast Refresh) turns each screen into a sonner toast via
 * `<WizardScreen>` and sends the user's choices back. Replaces the old side-car
 * terminal entirely.
 */

export type Send = (msg: PortsTuiToMain) => void;

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[300px] rounded-lg border border-border bg-[hsl(var(--surface-2))] shadow-lg px-3.5 py-3">
      {children}
    </div>
  );
}

function Button({
  onClick,
  variant = 'ghost',
  children,
}: {
  onClick: () => void;
  variant?: 'primary' | 'ghost' | 'destructive';
  children: React.ReactNode;
}) {
  const base =
    'px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors duration-150 disabled:opacity-50';
  const styles =
    variant === 'primary'
      ? 'bg-primary text-primary-foreground hover:brightness-110'
      : variant === 'destructive'
        ? 'bg-destructive text-destructive-foreground hover:brightness-110'
        : 'text-muted-foreground hover:text-foreground hover:bg-accent/60';
  return (
    <button type="button" onClick={onClick} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

function Status({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="text-[13px] text-foreground/90 leading-snug">{children}</div>
    </div>
  );
}

const spinner = (
  <Loader2 size={14} className="animate-spin text-muted-foreground" strokeWidth={2} />
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
        <span className="mr-auto text-[12px] text-muted-foreground">
          Remove the port-setup task?
        </span>
        <Button onClick={() => setConfirming(false)}>Keep</Button>
        <Button variant="destructive" onClick={onCancelTask}>
          Remove task
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-2.5 flex items-center justify-end gap-1.5">
      <Button onClick={() => send({ type: 'exit', reason: 'user' })}>Dismiss</Button>
      <Button onClick={() => setConfirming(true)}>Cancel setup task</Button>
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
          <Status icon={<Plug size={14} className="text-primary" strokeWidth={2} />}>
            <div className="font-medium text-foreground">Set up per-worktree ports?</div>
            <div className="mt-0.5 text-muted-foreground">
              Dash detected port-using services. “Set it up” starts a port-setup task where an agent
              configures them, so Dash can run them from the UI, collision-free.
            </div>
          </Status>
          <div className="mt-2.5 flex items-center gap-1.5">
            {/* The permanent, project-wide dismiss is the least-likely choice, so
                it sits left and quiet (a bare text link, no button chrome) — that
                keeps the long label from crowding the two primary actions. */}
            <button
              type="button"
              onClick={() => send({ type: 'choice', screen: 'onboarding', value: 'not-relevant' })}
              className="mr-auto whitespace-nowrap text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
            >
              Never for this project
            </button>
            <Button
              onClick={() => send({ type: 'choice', screen: 'onboarding', value: 'not-now' })}
            >
              Not now
            </Button>
            <Button
              variant="primary"
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
          <Status icon={<AlertTriangle size={14} className="text-destructive" strokeWidth={2} />}>
            <div className="font-medium text-foreground">ports.json is invalid</div>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
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
          <Status
            icon={
              <CheckCircle2 size={14} className="text-[hsl(var(--git-added))]" strokeWidth={2} />
            }
          >
            <div className="font-medium text-foreground">{plural(show.props.count)} allocated</div>
            <div className="mt-0.5 text-muted-foreground">
              The agent is finishing any remaining work and will report back. Restart the session to
              apply the new env vars once it&apos;s done.
            </div>
          </Status>
          <div className="mt-2.5 flex items-center gap-1.5 justify-end">
            <Button onClick={() => send({ type: 'choice', screen: 'done', value: 'later' })}>
              Later
            </Button>
            <Button
              variant="primary"
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
