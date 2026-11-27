import { useEffect } from 'react';
import {
  autoSleepAfterMs,
  checkEveryMs,
  dueForSleep,
  restingTaskIds,
  trackRest,
} from '../lib/autoSleep';
import { useProjects } from '../stores/projectsStore';
import { useRuntime } from '../stores/runtimeStore';
import { useSettings } from '../stores/settingsStore';

/** Dev-only: a shorter duration, in ms, to test auto-sleep quickly. */
const devOverride = import.meta.env.DEV
  ? (import.meta.env.VITE_DASH_AUTO_SLEEP_AFTER_MS as string | undefined)
  : undefined;

function restingNow(): string[] {
  const { activeTaskId, tasksByProject } = useProjects.getState();
  const runtime = useRuntime.getState();
  const protectedIds = new Set<string>();
  for (const tasks of Object.values(tasksByProject)) {
    for (const t of tasks) if (t.protected) protectedIds.add(t.id);
  }
  return restingTaskIds({
    activity: runtime.taskActivity,
    activeTaskId,
    unseen: useSettings.getState().unseenTaskIds,
    protectedIds,
    remoteControlIds: new Set(Object.keys(runtime.remoteControlStates)),
  });
}

/**
 * Settings → System health → Auto-sleep: puts a task's session to sleep, as
 * its "Put to sleep" does, once it has rested, seen, for the chosen time.
 * The rest clocks follow every store change, so a turn between two checks
 * still restarts one; the check itself is coarse (checkEveryMs). It lives in
 * the renderer because "seen" (unseenTaskIds) and the task on screen are the
 * renderer's, as are the terminals a sleep disposes. Mount once, at the root.
 */
export function useAutoSleep(): void {
  const after = useSettings((s) => s.autoSleepAfter);

  useEffect(() => {
    const afterMs = autoSleepAfterMs(after, devOverride);
    if (afterMs === null) return;
    let restSince = new Map<string, number>();
    const observe = () => {
      restSince = trackRest(restSince, restingNow(), Date.now());
    };
    const unsubscribe = [
      useRuntime.subscribe(observe),
      useProjects.subscribe(observe),
      useSettings.subscribe(observe),
    ];
    observe();
    const timer = setInterval(() => {
      observe();
      for (const id of dueForSleep(restSince, Date.now(), afterMs)) {
        restSince.delete(id);
        void useProjects.getState().closeTask(id, 'auto_sleep');
      }
    }, checkEveryMs(afterMs));
    return () => {
      clearInterval(timer);
      for (const off of unsubscribe) off();
    };
  }, [after]);
}
