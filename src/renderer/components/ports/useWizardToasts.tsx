import { useEffect } from 'react';
import { toast } from 'sonner';
import { useProjects } from '../../stores/projectsStore';
import { WizardScreen, type Send } from './PortsWizardToasts';

/**
 * Drives the ports wizard toasts. Main pushes a screen at a time via
 * `wizard:show`; this turns each into a sonner toast (keyed by task so updates
 * replace in place) and sends the user's choices back via `wizard:message`.
 *
 * Lives in its own module — separate from `PortsWizardToasts.tsx`, whose only
 * export must stay a component for React Fast Refresh.
 */

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
        render: () => <WizardScreen show={msg} send={send} onCancelTask={onCancelTask} />,
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
