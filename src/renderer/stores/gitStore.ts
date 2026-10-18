import { create } from 'zustand';
import type { GitStatus, PullRequestInfo, Project, Task } from '../../shared/types';
import { fetchPrsFor, prDetectionTargets, prTargetFor, type BranchPrs } from './prDetectionTargets';
import { useProjects, selectActiveTask } from './projectsStore';

const GIT_POLL_INTERVAL = 5000;
const PR_POLL_INTERVAL = 30_000;

export interface DiffFileTarget {
  cwd: string;
  filePath: string;
  staged: boolean;
  initialView?: { kind: 'working'; ref: 'HEAD' | 'index' } | { kind: 'commit'; hash: string };
}

type Updater<T> = T | ((prev: T) => T);
const apply = <T>(v: Updater<T>, prev: T): T =>
  typeof v === 'function' ? (v as (p: T) => T)(prev) : v;

const activeTask = (): Task | null => selectActiveTask(useProjects.getState());

/** The branch checked out at `cwd` (null: detached), or undefined when it can't be read. */
async function currentBranch(cwd: string): Promise<string | null | undefined> {
  try {
    const resp = await window.electronAPI.gitCurrentBranch(cwd);
    return resp.success ? (resp.data ?? null) : undefined;
  } catch {
    return undefined;
  }
}

export interface GitState {
  gitStatus: GitStatus | null;
  gitLoading: boolean;
  diffFile: DiffFileTarget | null;
  /** The PRs standing for the active task's branch now, newest first (see relevantPrs). */
  prs: PullRequestInfo[];
  /** The same per task, for the sidebar rows and ProjectView cards. */
  prByTask: Record<string, PullRequestInfo[]>;
  /** Per task, every PR from its branch, newest first: the list behind its PR badge. */
  branchPrsByTask: Record<string, PullRequestInfo[]>;
  /**
   * Each task's checked-out branch as last read (null: detached HEAD). Unlike
   * `task.branch`, the branch Dash created it on, this follows a session that
   * switched branches. Read it through useTaskBranch.
   */
  branchByTask: Record<string, string | null>;
  showCommitGraph: boolean;
  /** When set, the commit-graph modal selects + scrolls to this commit on open
   *  (e.g. opened from the diff editor's blame card). Cleared on close. */
  commitGraphFocusHash: string | null;
}

export interface GitActions {
  setDiffFile: (v: DiffFileTarget | null) => void;
  setShowCommitGraph: (v: Updater<boolean>) => void;
  /** Open the commit-graph modal scrolled to a specific commit. */
  openCommitGraphAtCommit: (hash: string) => void;
  setCommitGraphFocusHash: (hash: string | null) => void;
  refreshGitStatus: (cwd: string) => Promise<void>;
  // Mutating ops — resolve the active task themselves, then refresh its status.
  stageFiles: (filePaths: string[]) => Promise<void>;
  unstageFiles: (filePaths: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  discardFiles: (filePaths: string[]) => Promise<void>;
  addToGitignore: (filePath: string) => Promise<void>;
  commit: (message: string, options?: { allowEmpty?: boolean }) => Promise<void>;
  push: () => Promise<void>;
  // Live wiring — driven by App's thin effects on active-task/project change.
  watchActiveTask: (task: Task | null) => void;
  stopWatch: () => void;
  detectPr: (project: Project | null, task: Task | null, branch: string | null) => void;
  stopPrDetect: () => void;
  /** Fetch each task's PRs in parallel (main reads its live branch); fill prByTask. */
  detectProjectPrs: (project: Project, tasks: Task[]) => Promise<void>;
}

export type GitStore = GitState & GitActions;

/** Whether two statuses hold the same branch, counts and file changes, in order. */
export function sameGitStatus(a: GitStatus, b: GitStatus): boolean {
  if (
    a.branch !== b.branch ||
    a.hasUpstream !== b.hasUpstream ||
    a.ahead !== b.ahead ||
    a.behind !== b.behind ||
    a.files.length !== b.files.length
  ) {
    return false;
  }
  return a.files.every((f, i) => {
    const g = b.files[i]!;
    return (
      f.path === g.path &&
      f.status === g.status &&
      f.staged === g.staged &&
      f.additions === g.additions &&
      f.deletions === g.deletions &&
      f.oldPath === g.oldPath
    );
  });
}

// Non-reactive singleton resources (only ever one active task watched / one PR poll).
let watchTeardown: (() => void) | null = null;
let prTeardown: (() => void) | null = null;

export const useGit = create<GitStore>((set, get) => ({
  gitStatus: null,
  gitLoading: false,
  diffFile: null,
  prs: [],
  prByTask: {},
  branchPrsByTask: {},
  branchByTask: {},
  showCommitGraph: false,
  commitGraphFocusHash: null,

  setDiffFile: (v) => set({ diffFile: v }),
  setShowCommitGraph: (v) => set((s) => ({ showCommitGraph: apply(v, s.showCommitGraph) })),
  openCommitGraphAtCommit: (hash) => set({ commitGraphFocusHash: hash, showCommitGraph: true }),
  setCommitGraphFocusHash: (hash) => set({ commitGraphFocusHash: hash }),

  refreshGitStatus: async (cwd) => {
    // Only the first load shows "Loading..."; background polls don't toggle it,
    // which would re-render every subscriber twice per poll.
    const firstLoad = get().gitStatus === null;
    if (firstLoad) set({ gitLoading: true });
    try {
      const resp = await window.electronAPI.gitGetStatus(cwd);
      if (resp.success && resp.data) {
        const t = activeTask();
        const branch = resp.data.branch || null;
        const prev = get().gitStatus;
        set({
          // Keep the old object when nothing changed, so a poll of a big
          // worktree doesn't re-render every file row.
          gitStatus: prev && sameGitStatus(prev, resp.data) ? prev : resp.data,
          ...(t?.path === cwd && get().branchByTask[t.id] !== branch
            ? { branchByTask: { ...get().branchByTask, [t.id]: branch } }
            : {}),
        });
      }
    } catch {
      // Ignore — keep the last good status.
    } finally {
      if (firstLoad) set({ gitLoading: false });
    }
  },

  stageFiles: async (filePaths) => {
    const t = activeTask();
    if (!t || filePaths.length === 0) return;
    await window.electronAPI.gitStageFiles({ cwd: t.path, filePaths });
    await get().refreshGitStatus(t.path);
  },

  unstageFiles: async (filePaths) => {
    const t = activeTask();
    if (!t || filePaths.length === 0) return;
    await window.electronAPI.gitUnstageFiles({ cwd: t.path, filePaths });
    await get().refreshGitStatus(t.path);
  },

  stageAll: async () => {
    const t = activeTask();
    if (!t) return;
    await window.electronAPI.gitStageAll(t.path);
    await get().refreshGitStatus(t.path);
  },

  unstageAll: async () => {
    const t = activeTask();
    if (!t) return;
    await window.electronAPI.gitUnstageAll(t.path);
    await get().refreshGitStatus(t.path);
  },

  discardFiles: async (filePaths) => {
    const t = activeTask();
    if (!t || filePaths.length === 0) return;
    await window.electronAPI.gitDiscardFiles({ cwd: t.path, filePaths });
    await get().refreshGitStatus(t.path);
  },

  addToGitignore: async (filePath) => {
    const t = activeTask();
    if (!t) return;
    const res = await window.electronAPI.gitignoreAdd({ cwd: t.path, filePath });
    if (!res.success) console.error('[gitignore] add failed', res.error);
    await get().refreshGitStatus(t.path);
  },

  commit: async (message, options = {}) => {
    const t = activeTask();
    if (!t) return;
    const res = await window.electronAPI.gitCommit({
      cwd: t.path,
      message,
      allowEmpty: options.allowEmpty,
    });
    if (!res.success) throw new Error(res.error || 'Commit failed');
    await get().refreshGitStatus(t.path);
  },

  push: async () => {
    const t = activeTask();
    if (!t) return;
    const res = await window.electronAPI.gitPush(t.path);
    if (!res.success) throw new Error(res.error || 'Push failed');
    await get().refreshGitStatus(t.path);
  },

  watchActiveTask: (task) => {
    watchTeardown?.();
    watchTeardown = null;
    if (!task) {
      set({ gitStatus: null });
      return;
    }
    const { id, path: cwd } = task;
    void get().refreshGitStatus(cwd);
    void window.electronAPI.gitWatch({ id, cwd });
    const unsubscribe = window.electronAPI.onGitFileChanged((changedId) => {
      if (changedId === id) void get().refreshGitStatus(cwd);
    });
    const timer = setInterval(() => void get().refreshGitStatus(cwd), GIT_POLL_INTERVAL);
    watchTeardown = () => {
      unsubscribe();
      void window.electronAPI.gitUnwatch(id);
      clearInterval(timer);
    };
  },

  stopWatch: () => {
    watchTeardown?.();
    watchTeardown = null;
  },

  detectPr: (project, task, branch) => {
    prTeardown?.();
    prTeardown = null;
    set({ prs: [] });

    const defaultBranch = project?.baseRef || project?.gitBranch || 'main';
    if (!branch || !project || branch === defaultBranch) {
      if (task) {
        set({
          prByTask: { ...get().prByTask, [task.id]: [] },
          branchPrsByTask: { ...get().branchPrsByTask, [task.id]: [] },
        });
      }
      return;
    }

    let cancelled = false;
    const target = prTargetFor(project, task?.path || project.path);

    const fetchPrs = async () => {
      const found = await fetchPrsFor(target);
      if (cancelled || found === null) return;
      set({
        prs: found.current,
        ...(task
          ? {
              prByTask: { ...get().prByTask, [task.id]: found.current },
              branchPrsByTask: { ...get().branchPrsByTask, [task.id]: found.all },
            }
          : {}),
      });
    };

    void fetchPrs();
    const interval = setInterval(() => void fetchPrs(), PR_POLL_INTERVAL);
    prTeardown = () => {
      cancelled = true;
      clearInterval(interval);
    };
  },

  stopPrDetect: () => {
    prTeardown?.();
    prTeardown = null;
  },

  detectProjectPrs: async (project, tasks) => {
    const targets = prDetectionTargets(project, tasks);
    const [results, branches] = await Promise.all([
      Promise.all(targets.map(async (t) => [t.taskId, await fetchPrsFor(t)] as const)),
      Promise.all(targets.map(async (t) => [t.taskId, await currentBranch(t.cwd)] as const)),
    ]);
    // A failed fetch (undefined / null) keeps what the task showed.
    const fetched = results.filter((r): r is readonly [string, BranchPrs] => r[1] !== null);
    const read = branches.filter((r): r is readonly [string, string | null] => r[1] !== undefined);
    set({
      prByTask: {
        ...get().prByTask,
        ...Object.fromEntries(fetched.map(([id, f]) => [id, f.current])),
      },
      branchPrsByTask: {
        ...get().branchPrsByTask,
        ...Object.fromEntries(fetched.map(([id, f]) => [id, f.all])),
      },
      branchByTask: { ...get().branchByTask, ...Object.fromEntries(read) },
    });
  },
}));

/** The branch `task` is on now, falling back to the one it was created on until it is read. */
export function useTaskBranch(task: Pick<Task, 'id' | 'branch'>): string {
  return useGit((s) => s.branchByTask[task.id]) ?? task.branch;
}
