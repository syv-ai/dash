import { useEffect, useState } from 'react';
import type { BypassAvailability, PermissionMode, Task } from '../../../shared/types';
import { confirm } from '../ui/ConfirmHost';
import { toast } from '../ui/toast';
import { useProjects } from '../../stores/projectsStore';
import { useRuntime } from '../../stores/runtimeStore';
import { sessionRegistry } from '../../terminal/SessionRegistry';
import { planPermissionSwitch } from './permissionSwitch';

/** Whether Claude Code's settings let the task skip permissions; null until known. */
export async function fetchBypassAvailability(taskId: string): Promise<BypassAvailability | null> {
  const resp = await window.electronAPI.getTaskBypassAvailability(taskId);
  return resp.success && resp.data ? resp.data : null;
}

/** The task's bypass availability, read when the caller mounts (a menu opens). */
export function useBypassAvailability(taskId: string): BypassAvailability | null {
  const [bypass, setBypass] = useState<BypassAvailability | null>(null);
  useEffect(() => {
    let live = true;
    void fetchBypassAvailability(taskId).then((b) => live && setBypass(b));
    return () => {
      live = false;
    };
  }, [taskId]);
  return bypass;
}

/** A live session, or a parked job that would wake with its old flags. */
function taskHasSession(task: Task): boolean {
  const state = useRuntime.getState().taskActivity[task.id]?.state;
  return (!!state && state !== 'stopped') || !!task.jobId;
}

/**
 * Switch a task's permission mode from anywhere in Dash (the task menu, Task
 * settings): confirm, save, and restart a session so it resumes under the
 * new flag. Resolves with the saved task, or null when nothing changed.
 */
export async function switchPermissionMode(
  task: Task,
  mode: PermissionMode,
  save: (task: Task, patch: Partial<Task>) => Promise<Task | null> = (t, p) =>
    useProjects.getState().updateTask(t, p),
): Promise<Task | null> {
  const plan = planPermissionSwitch({
    from: task.permissionMode,
    to: mode,
    hasSession: taskHasSession(task),
    bypass: mode === 'bypassPermissions' ? await fetchBypassAvailability(task.id) : null,
  });
  if (plan.kind === 'none') return null;
  if (plan.kind === 'blocked') {
    toast.error(plan.reason);
    return null;
  }
  if (plan.confirm && !(await confirm(plan.confirm))) return null;
  const updated = await save(task, { permissionMode: mode });
  if (updated && plan.restart) {
    await sessionRegistry.restartAgent(task.id).catch((err: unknown) => {
      toast.error(`Failed to restart the session: ${String(err)}`);
    });
  }
  return updated;
}
