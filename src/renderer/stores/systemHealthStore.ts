import { create } from 'zustand';
import type { SystemHealthSnapshot } from '@shared/systemHealth';
import { idleTaskIds } from '../lib/idleTasks';
import { useProjects } from './projectsStore';
import { useRuntime } from './runtimeStore';

interface SystemHealthState {
  /** Main's last sample while the health icon is on (`systemHealth:snapshot`),
   *  or null before the first one and while the icon is off. */
  snapshot: SystemHealthSnapshot | null;
  setSnapshot: (snapshot: SystemHealthSnapshot | null) => void;
}

export const useSystemHealthStore = create<SystemHealthState>((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
}));

/** The tasks "Sleep N idle tasks" would put to sleep right now. */
export function idleTasksNow(): string[] {
  return idleTaskIds(useRuntime.getState().taskActivity, useProjects.getState().activeTaskId);
}

/** Put every idle task to sleep, through the task's own "Put to sleep"; the
 *  memory warning's and the health popover's action. Returns how many. */
export function sleepIdleTasks(): number {
  const ids = idleTasksNow();
  for (const id of ids) void useProjects.getState().closeTask(id);
  return ids.length;
}
