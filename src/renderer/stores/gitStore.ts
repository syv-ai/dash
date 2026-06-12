import { create } from 'zustand';
import type { GitStatus, PullRequestInfo, Project, Task } from '../../shared/types';
import { isAdoRemote } from '../../shared/urls';
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

export interface GitState {
  gitStatus: GitStatus | null;
  gitLoading: boolean;
  diffFile: DiffFileTarget | null;
  prInfo: PullRequestInfo | null;
  showCommitGraph: boolean;
}

export interface GitActions {
  setDiffFile: (v: DiffFileTarget | null) => void;
  setShowCommitGraph: (v: Updater<boolean>) => void;
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
}

export type GitStore = GitState & GitActions;

// Non-reactive singleton resources (only ever one active task watched / one PR poll).
let watchTeardown: (() => void) | null = null;
let prTeardown: (() => void) | null = null;

export const useGit = create<GitStore>((set, get) => ({
  gitStatus: null,
  gitLoading: false,
  diffFile: null,
  prInfo: null,
  showCommitGraph: false,

  setDiffFile: (v) => set({ diffFile: v }),
  setShowCommitGraph: (v) => set((s) => ({ showCommitGraph: apply(v, s.showCommitGraph) })),

  refreshGitStatus: async (cwd) => {
    set({ gitLoading: true });
    try {
      const resp = await window.electronAPI.gitGetStatus(cwd);
      if (resp.success && resp.data) set({ gitStatus: resp.data });
    } catch {
      // Ignore — keep the last good status.
    } finally {
      set({ gitLoading: false });
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
    get().refreshGitStatus(cwd);
    window.electronAPI.gitWatch({ id, cwd });
    const unsubscribe = window.electronAPI.onGitFileChanged((changedId) => {
      if (changedId === id) get().refreshGitStatus(cwd);
    });
    const timer = setInterval(() => get().refreshGitStatus(cwd), GIT_POLL_INTERVAL);
    watchTeardown = () => {
      unsubscribe();
      window.electronAPI.gitUnwatch(id);
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
    set({ prInfo: null });

    const defaultBranch = project?.baseRef || project?.gitBranch || 'main';
    if (!branch || !project || branch === defaultBranch) return;

    let cancelled = false;
    const remote = project.gitRemote;
    const projectId = project.id;
    const cwd = task?.path || project.path;

    const fetchPr = async () => {
      try {
        let pr: PullRequestInfo | null = null;
        if (remote && isAdoRemote(remote)) {
          const resp = await window.electronAPI.adoGetPrForBranch(branch, remote, projectId);
          if (!cancelled && resp.success) pr = resp.data ?? null;
        } else {
          const resp = await window.electronAPI.githubGetPrForBranch(cwd, branch);
          if (!cancelled && resp.success) pr = resp.data ?? null;
        }
        if (!cancelled) set({ prInfo: pr });
      } catch {
        if (!cancelled) set({ prInfo: null });
      }
    };

    fetchPr();
    const interval = setInterval(fetchPr, PR_POLL_INTERVAL);
    prTeardown = () => {
      cancelled = true;
      clearInterval(interval);
    };
  },

  stopPrDetect: () => {
    prTeardown?.();
    prTeardown = null;
  },
}));
