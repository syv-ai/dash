import { useEffect } from 'react';
import {
  useProjects,
  selectActiveProject,
  selectActiveTask,
  selectProjectHasGit,
} from '../stores/projectsStore';
import { useGit } from '../stores/gitStore';
import { useRuntime } from '../stores/runtimeStore';

/**
 * Wires the store-level live subscriptions + reactive bootstrap effects that used
 * to live inline in App.tsx. Call once from the App root.
 *
 * - runtimeStore.init(): activity monitor, remote-control, token-stats writeback.
 * - token rollups: re-fetched whenever the project list changes.
 * - gitStore watcher/poll + PR detection: re-wired on active-task / project / branch change.
 *
 * React schedules WHEN (effect deps); the stores own HOW (timers/subscriptions/teardown).
 * StrictMode-safe: every wiring returns/owns an idempotent cleanup.
 */
export function useAppBootstrap() {
  const projects = useProjects((s) => s.projects);
  const activeTask = useProjects(selectActiveTask);
  const activeProject = useProjects(selectActiveProject);
  const activeHasGit = useProjects((s) => selectProjectHasGit(s, activeTask?.projectId));
  const gitBranch = useGit((s) => s.gitStatus?.branch ?? null);

  // Runtime IPC subscriptions (activity, remote control, token writeback).
  useEffect(() => useRuntime.getState().init(), []);

  // Token rollups re-fetch when the project list changes (initial load + add/remove).
  useEffect(() => {
    void useRuntime.getState().refreshTokenRollups();
  }, [projects]);

  // Git watcher + poll, re-wired whenever the active task changes or its
  // folder gains or loses git; none for a plain folder's task.
  useEffect(() => {
    useGit.getState().watchActiveTask(activeHasGit ? (activeTask ?? null) : null);
    return () => useGit.getState().stopWatch();
  }, [activeTask?.id, activeTask?.path, activeHasGit]);

  // PR detection, re-run on task / project / branch change.
  useEffect(() => {
    useGit.getState().detectPr(activeProject ?? null, activeTask ?? null, gitBranch);
    return () => useGit.getState().stopPrDetect();
  }, [activeTask?.id, activeTask?.path, activeProject, gitBranch]);
}
