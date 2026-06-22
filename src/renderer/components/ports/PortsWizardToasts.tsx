import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plug, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { PortsShow, PortsTuiToMain } from '../../../shared/portsTuiProtocol';
import { useProjects } from '../../stores/projectsStore';

/**
 * Renders the ports wizard as a persistent toast. Main drives the flow (a state
 * machine over IPC) and pushes a screen at a time via `wizard:show`; this turns
 * each screen into a sonner toast (keyed by task so updates replace in place)
 * and sends the user's choices back via `wizard:message`. Replaces the old
 * side-car terminal entirely.
 */

type Send = (msg: PortsTuiToMain) => void;

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
          <div className="mt-2.5 flex items-center gap-1.5 justify-end">
            <Button
              onClick={() => send({ type: 'choice', screen: 'onboarding', value: 'not-relevant' })}
            >
              Never
            </Button>
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

/** A wizard screen pinned to a task, kept so it can be re-shown on task switch. */
interface PinnedScreen {
  id: string;
  taskId: string;
  render: () => React.ReactElement;
  interactive: boolean;
}

export function useWizardToasts(): void {
  useEffect(() => {
    // The wizard toast is logically per-task, but sonner renders globally — so
    // we hold the latest screen per task and only surface the active task's.
    // Switching tasks dismisses the others and re-shows the one you land on.
    const screens = new Map<string, PinnedScreen>();
    const activeTaskId = () => useProjects.getState().activeTaskId;

    const show = (s: PinnedScreen) => {
      toast.custom(s.render, { id: s.id, duration: Infinity, dismissible: s.interactive });
    };

    const reconcile = () => {
      const active = activeTaskId();
      for (const s of screens.values()) {
        if (s.taskId === active) show(s);
        else toast.dismiss(s.id);
      }
    };

    const offShow = window.electronAPI.onWizardShow(({ featureId, taskId, msg }) => {
      const id = `wizard:${featureId}:${taskId}`;
      const send: Send = (m) => window.electronAPI.wizardMessage({ featureId, taskId, msg: m });

      if (msg.type === 'progress' || msg.type === 'shutdown') {
        if (msg.type === 'shutdown') {
          screens.delete(id);
          toast.dismiss(id);
        }
        return;
      }
      // msg.type === 'show'
      if (msg.screen === 'exit') {
        // The persistent toast is dismissed on teardown; only an error needs its
        // own surfacing (e.g. the migrate failed).
        if (msg.props.reason === 'error') {
          toast.error(msg.props.errorMessage ?? 'Port setup failed.', { duration: 8000 });
        }
        screens.delete(id);
        toast.dismiss(id);
        return;
      }

      // "Cancel setup task" removes the whole port-setup task (worktree + agent).
      // db:deleteTask → WizardHost.cancelForTask dismisses this toast.
      const onCancelTask = () => {
        const { tasksByProject, deleteTask } = useProjects.getState();
        const task = Object.values(tasksByProject)
          .flat()
          .find((t) => t.id === taskId);
        if (task) {
          void deleteTask(task, {
            deleteWorktreeDir: true,
            deleteLocalBranch: true,
            deleteRemoteBranch: false,
          });
        }
      };

      const interactive = msg.screen === 'onboarding' || msg.screen === 'done';
      const pinned: PinnedScreen = {
        id,
        taskId,
        render: () => renderScreen(msg, send, onCancelTask) ?? <span />,
        interactive,
      };
      screens.set(id, pinned);
      // Only surface it when its task is the one in view; otherwise keep it
      // staged so navigating to that task re-shows it.
      if (taskId === activeTaskId()) show(pinned);
      else toast.dismiss(id);
    });

    const offDismiss = window.electronAPI.onWizardDismiss(({ featureId, taskId }) => {
      const id = `wizard:${featureId}:${taskId}`;
      screens.delete(id);
      toast.dismiss(id);
    });

    // Re-evaluate which toast is visible whenever the active task changes.
    let lastActive = activeTaskId();
    const offActive = useProjects.subscribe((state) => {
      if (state.activeTaskId !== lastActive) {
        lastActive = state.activeTaskId;
        reconcile();
      }
    });

    return () => {
      offShow();
      offDismiss();
      offActive();
    };
  }, []);
}
