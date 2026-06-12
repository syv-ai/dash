import { useEffect } from 'react';
import { useProjects, selectActiveProject, selectActiveTask } from '../stores/projectsStore';
import { useGit } from '../stores/gitStore';
import { useRuntime } from '../stores/runtimeStore';

/**
 * Wires the store-level live subscriptions + reactive bootstrap effects that used
 * to live inline in App.tsx. Call once from the App root.
 *
 * - runtimeStore.init(): activity monitor, remote-control, token-stats writeback, RTK.
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
  const gitBranch = useGit((s) => s.gitStatus?.branch ?? null);

  // Runtime IPC subscriptions (activity, remote control, token writeback, RTK).
  useEffect(() => useRuntime.getState().init(), []);

  // Token rollups re-fetch when the project list changes (initial load + add/remove).
  useEffect(() => {
    useRuntime.getState().refreshTokenRollups();
  }, [projects]);

  // Git watcher + poll, re-wired whenever the active task changes.
  useEffect(() => {
    useGit.getState().watchActiveTask(activeTask ?? null);
    return () => useGit.getState().stopWatch();
  }, [activeTask?.id, activeTask?.path]);

  // PR detection, re-run on task / project / branch change.
  useEffect(() => {
    useGit.getState().detectPr(activeProject ?? null, activeTask ?? null, gitBranch);
    return () => useGit.getState().stopPrDetect();
  }, [activeTask?.id, activeTask?.path, activeProject, gitBranch]);
}
