import { useEffect, useState } from 'react';
import type { BypassAvailability, Task } from '../../../shared/types';
import { confirm } from '../ui/ConfirmHost';
import { toast } from '../ui/toast';
import { useProjects } from '../../stores/projectsStore';
import { useRuntime } from '../../stores/runtimeStore';
import { sessionRegistry } from '../../terminal/SessionRegistry';
import { planSessionSettingChange, type SessionSettingChange } from './sessionSettingChange';

/** Whether Claude Code's settings let a session in `cwd` skip permissions; null until known. */
export async function fetchBypassAvailability(cwd: string): Promise<BypassAvailability | null> {
  const resp = await window.electronAPI.getBypassAvailability(cwd);
  return resp.success && resp.data ? resp.data : null;
}

/**
 * Bypass availability for a session in `cwd` (a task's checkout, or the
 * project a new task starts in), read when the caller mounts (a menu opens).
 */
export function useBypassAvailability(cwd: string | undefined): BypassAvailability | null {
  const [bypass, setBypass] = useState<BypassAvailability | null>(null);
  useEffect(() => {
    if (!cwd) return;
    let live = true;
    void fetchBypassAvailability(cwd).then((b) => live && setBypass(b));
    return () => {
      live = false;
    };
  }, [cwd]);
  return bypass;
}

/** A live session, or a parked job that would wake with its old flags. */
function taskHasSession(task: Task): boolean {
  const state = useRuntime.getState().taskActivity[task.id]?.state;
  return (!!state && state !== 'stopped') || !!task.jobId;
}

function save(task: Task, change: SessionSettingChange): Promise<Task | null> {
  const store = useProjects.getState();
  switch (change.setting) {
    case 'dashAccess':
      return store.setDashAccess(task, change.to);
    case 'permissionMode':
      return store.updateTask(task, { permissionMode: change.to });
    case 'model':
      return store.updateTask(task, { model: change.to });
    case 'extraArgs':
      return store.setLaunchOptions(task, { extraArgs: change.to });
    case 'addDirs':
      return store.setLaunchOptions(task, { addDirs: change.to });
    case 'effort':
      return store.setLaunchOptions(task, { effort: change.to });
  }
}

/**
 * Change a task's session setting from anywhere in Dash (the task menu, Task
 * settings): confirm, save, and restart a session so it resumes under the
 * new value. Resolves with the saved task, or null when nothing changed. The
 * restart isn't awaited: the caller shows the new value while it runs.
 */
export async function changeSessionSetting(
  task: Task,
  change: SessionSettingChange,
): Promise<Task | null> {
  const toBypass = change.setting === 'permissionMode' && change.to === 'bypassPermissions';
  const plan = planSessionSettingChange({
    task,
    change,
    hasSession: taskHasSession(task),
    bypass: toBypass ? await fetchBypassAvailability(task.path) : null,
  });
  if (plan.kind === 'none') return null;
  if (plan.kind === 'blocked') {
    toast.error(plan.reason);
    return null;
  }
  if (plan.confirm && !(await confirm(plan.confirm))) return null;
  const updated = await save(task, change);
  if (updated && plan.restart) {
    void sessionRegistry.restartAgent(task.id).catch((err: unknown) => {
      toast.error(`Failed to restart the session: ${String(err)}`);
    });
  }
  return updated;
}
