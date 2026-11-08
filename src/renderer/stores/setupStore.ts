import { create } from 'zustand';
import { toast } from 'sonner';
import type { SetupRun } from '../../shared/setupRuns';
import type { Task } from '../../shared/types';
import { useProjects } from './projectsStore';

export interface SetupState {
  /** Latest setup run per worktree path (a task's `path`), since launch. A
   *  task with a run gets a Setup tab in its drawer. */
  runs: Record<string, SetupRun>;
  /** Someone asked to show this worktree's Setup tab; the drawer consumes it.
   *  `seq` makes a repeat request for the same path a new value. */
  setupTabRequest: { worktreePath: string; seq: number } | null;
}

export interface SetupActions {
  /** Select the task owning `worktreePath` and ask its drawer to open the
   *  Setup tab (expanding the drawer if collapsed). */
  showSetup: (worktreePath: string) => void;
  /** The drawer handled the request. */
  clearSetupTabRequest: () => void;
  /** Run the task's setup again and show its Setup tab; toasts when main refuses. */
  rerun: (task: { id: string; path: string }) => Promise<void>;
  /** Wire the IPC subscriptions; returns their cleanup. */
  init: () => () => void;
}

export type SetupStore = SetupState & SetupActions;

function taskAt(worktreePath: string): Task | null {
  for (const list of Object.values(useProjects.getState().tasksByProject)) {
    const task = list.find((t) => t.path === worktreePath && !t.archivedAt);
    if (task) return task;
  }
  return null;
}

export const useSetup = create<SetupStore>((set, get) => ({
  runs: {},
  setupTabRequest: null,

  showSetup: (worktreePath) => {
    const task = taskAt(worktreePath);
    if (task) {
      const projects = useProjects.getState();
      if (projects.activeProjectId !== task.projectId) projects.setActiveProject(task.projectId);
      if (projects.activeTaskId !== task.id) projects.setActiveTask(task.id);
    }
    set((s) => ({ setupTabRequest: { worktreePath, seq: (s.setupTabRequest?.seq ?? 0) + 1 } }));
  },

  clearSetupTabRequest: () => set({ setupTabRequest: null }),

  rerun: async (task) => {
    const resp = await window.electronAPI.worktreeSetupRerun(task.id);
    if (!resp.success) {
      toast.error(resp.error ?? 'Could not run setup');
      return;
    }
    get().showSetup(task.path);
  },

  init: () => {
    const offChanged = window.electronAPI.onWorktreeSetupChanged((run) => {
      const prev = get().runs[run.worktreePath];
      set((s) => ({ runs: { ...s.runs, [run.worktreePath]: run } }));
      if (run.status === 'failed' && prev?.status !== 'failed') {
        const name = taskAt(run.worktreePath)?.name;
        toast.error(name ? `Setup failed for ${name}` : 'Workspace setup failed', {
          description: run.error ?? undefined,
          action: { label: 'View output', onClick: () => get().showSetup(run.worktreePath) },
          duration: 10_000,
        });
      }
    });
    // The task was archived or deleted: its Setup tab goes with the run.
    const offForgotten = window.electronAPI.onWorktreeSetupForgotten(({ worktreePath }) => {
      set((s) => {
        const runs = { ...s.runs };
        delete runs[worktreePath];
        return s.setupTabRequest?.worktreePath === worktreePath
          ? { runs, setupTabRequest: null }
          : { runs };
      });
    });
    void window.electronAPI.worktreeSetupList().then((resp) => {
      if (!resp.success || !resp.data) return;
      const runs: Record<string, SetupRun> = {};
      for (const run of resp.data) runs[run.worktreePath] = run;
      // Events that landed first are newer than the listing.
      set((s) => ({ runs: { ...runs, ...s.runs } }));
    });
    return () => {
      offChanged();
      offForgotten();
    };
  },
}));
