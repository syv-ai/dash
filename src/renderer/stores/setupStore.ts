import { create } from 'zustand';
import { toast } from 'sonner';
import { appendCapped, type SetupLog, type SetupRun } from '../../shared/setupRuns';
import { useProjects } from './projectsStore';

export interface SetupState {
  /** Latest setup run per worktree path (a task's `path`), since launch. */
  runs: Record<string, SetupRun>;
  /** The worktree whose output the setup view shows; null → closed. */
  viewPath: string | null;
  /** That worktree's output, kept live while the view is open. */
  viewLog: SetupLog | null;
}

export interface SetupActions {
  openLog: (worktreePath: string) => Promise<void>;
  closeLog: () => void;
  /** Run the task's setup again and show its output; toasts when main refuses. */
  rerun: (task: { id: string; path: string }) => Promise<void>;
  /** Wire the IPC subscriptions; returns their cleanup. */
  init: () => () => void;
}

export type SetupStore = SetupState & SetupActions;

function taskNameAt(worktreePath: string): string | null {
  for (const list of Object.values(useProjects.getState().tasksByProject)) {
    const task = list.find((t) => t.path === worktreePath);
    if (task) return task.name;
  }
  return null;
}

export const useSetup = create<SetupStore>((set, get) => ({
  runs: {},
  viewPath: null,
  viewLog: null,

  openLog: async (worktreePath) => {
    set({ viewPath: worktreePath, viewLog: null });
    const resp = await window.electronAPI.worktreeSetupLog(worktreePath);
    // Output that streamed in while this was in flight is already in the
    // snapshot, so the snapshot replaces it.
    if (get().viewPath !== worktreePath) return;
    set({ viewLog: resp.success && resp.data ? resp.data : { text: '', trimmed: false } });
  },

  closeLog: () => set({ viewPath: null, viewLog: null }),

  rerun: async (task) => {
    const resp = await window.electronAPI.worktreeSetupRerun(task.id);
    if (!resp.success) {
      toast.error(resp.error ?? 'Could not run setup');
      return;
    }
    if (get().viewPath !== task.path) await get().openLog(task.path);
  },

  init: () => {
    const offChanged = window.electronAPI.onWorktreeSetupChanged((run) => {
      const prev = get().runs[run.worktreePath];
      set((s) => ({ runs: { ...s.runs, [run.worktreePath]: run } }));
      // A new run starts with an empty log.
      if (run.status === 'running' && get().viewPath === run.worktreePath) {
        set({ viewLog: { text: '', trimmed: false } });
      }
      if (run.status === 'failed' && prev?.status !== 'failed') {
        const name = taskNameAt(run.worktreePath);
        toast.error(name ? `Setup failed for ${name}` : 'Workspace setup failed', {
          description: run.error ?? undefined,
          action: { label: 'View output', onClick: () => void get().openLog(run.worktreePath) },
          duration: 10_000,
        });
      }
    });
    const offOutput = window.electronAPI.onWorktreeSetupOutput(({ worktreePath, chunk }) => {
      const { viewPath, viewLog } = get();
      if (viewPath !== worktreePath || !viewLog) return;
      set({ viewLog: appendCapped(viewLog, chunk) });
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
      offOutput();
    };
  },
}));
