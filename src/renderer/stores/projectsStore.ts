import { create } from 'zustand';
import { toast } from 'sonner';
import { sessionRegistry } from '../terminal/SessionRegistry';
import type { Project, Task, BranchInfo } from '../../shared/types';
import type { DeleteProjectOptions } from '../components/DeleteProjectModal';

export interface ProjectsState {
  projects: Project[];
  tasksByProject: Record<string, Task[]>;
  activeProjectId: string | null;
  activeTaskId: string | null;
  branchesByProject: Record<string, BranchInfo[]>;
  ghAvailable: boolean;
  adoConfiguredById: Record<string, boolean>;
  availableIDEs: Array<{ id: string; label: string }>;
  isCreatingTask: boolean;
}

const ls = () => (typeof window !== 'undefined' ? window.localStorage : undefined);

function persistKey(key: string, value: string | null) {
  const store = ls();
  if (!store) return;
  if (value) store.setItem(key, value);
  else store.removeItem(key);
}

function initialActive(key: string): string | null {
  return ls()?.getItem(key) ?? null;
}

export interface ProjectsActions {
  setProjects: (projects: Project[]) => void;
  setTasksForProject: (projectId: string, tasks: Task[]) => void;
  setActiveProject: (id: string | null) => void;
  setActiveTask: (id: string | null) => void;
  setGhAvailable: (v: boolean) => void;
  setAdoConfigured: (projectId: string, v: boolean) => void;
  setBranchesForProject: (projectId: string, branches: BranchInfo[]) => void;
  setAvailableIDEs: (list: Array<{ id: string; label: string }>) => void;
  loadProjects: () => Promise<void>;
  loadTasks: (projectId: string) => Promise<void>;
  reorderProjects: (reordered: Project[]) => void;
  reorderTasks: (projectId: string, reordered: Task[]) => void;
  commitTaskReorder: (projectId: string, reordered: Task[]) => Promise<void>;
  archiveTask: (id: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  closeTask: (id: string) => void;
  updateTask: (taskItem: Task, patch: Partial<Task>) => Promise<Task | null>;
  deleteTask: (
    taskItem: Task,
    options?: {
      deleteWorktreeDir: boolean;
      deleteLocalBranch: boolean;
      deleteRemoteBranch: boolean;
    },
  ) => Promise<void>;
  deleteProject: (project: Project, options: DeleteProjectOptions) => Promise<void>;
}

/** Reload tasks for whichever project currently owns `taskId`. */
async function reloadOwningProject(taskId: string) {
  const { tasksByProject } = useProjects.getState();
  for (const [projectId, tasks] of Object.entries(tasksByProject)) {
    if (tasks.some((t) => t.id === taskId)) {
      await useProjects.getState().loadTasks(projectId);
      return;
    }
  }
}

/** Dispose the Claude session + shell sessions for a task. */
function disposeTaskSessions(taskId: string) {
  sessionRegistry.dispose(taskId);
  sessionRegistry.dispose(`shell:${taskId}`);
  sessionRegistry.disposeByPrefix(`shell:${taskId}:`);
}

/** Sort projects by the saved projectOrder, pruning stale ids from storage. */
function applyProjectOrder(projectList: Project[]): Project[] {
  const store = ls();
  try {
    const saved = store?.getItem('projectOrder');
    if (!saved) return projectList;
    const order: string[] = JSON.parse(saved);
    const validIds = new Set(projectList.map((p) => p.id));
    const cleanOrder = order.filter((id) => validIds.has(id));
    if (cleanOrder.length !== order.length) {
      store?.setItem('projectOrder', JSON.stringify(cleanOrder));
    }
    const orderMap = new Map(cleanOrder.map((id, i) => [id, i]));
    return [...projectList].sort(
      (a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity),
    );
  } catch {
    return projectList;
  }
}

export type ProjectsStore = ProjectsState & ProjectsActions;

export const useProjects = create<ProjectsStore>((set) => ({
  projects: [],
  tasksByProject: {},
  activeProjectId: initialActive('activeProjectId'),
  activeTaskId: initialActive('activeTaskId'),
  branchesByProject: {},
  ghAvailable: false,
  adoConfiguredById: {},
  availableIDEs: [],
  isCreatingTask: false,

  setProjects: (projects) => set({ projects }),
  setTasksForProject: (projectId, tasks) =>
    set((s) => ({ tasksByProject: { ...s.tasksByProject, [projectId]: tasks } })),
  setActiveProject: (id) => {
    persistKey('activeProjectId', id);
    set({ activeProjectId: id });
  },
  setActiveTask: (id) => {
    persistKey('activeTaskId', id);
    set({ activeTaskId: id });
  },
  setGhAvailable: (v) => set({ ghAvailable: v }),
  setAdoConfigured: (projectId, v) =>
    set((s) => ({ adoConfiguredById: { ...s.adoConfiguredById, [projectId]: v } })),
  setBranchesForProject: (projectId, branches) =>
    set((s) => ({ branchesByProject: { ...s.branchesByProject, [projectId]: branches } })),
  setAvailableIDEs: (list) => set({ availableIDEs: list }),

  loadProjects: async () => {
    const resp = await window.electronAPI.getProjects();
    if (!resp.success || !resp.data) return;
    // On Windows, older projects may have been saved with the full path as the
    // name; derive the folder name so the sidebar shows short names.
    const projects = resp.data.map((p) => {
      const looksLikePath = p.name.includes('\\') || p.name.includes('/');
      return looksLikePath ? { ...p, name: p.name.split(/[\\/]/).pop() || p.name } : p;
    });
    set({ projects: applyProjectOrder(projects) });
    if (projects.length > 0) {
      const prev = useProjects.getState().activeProjectId;
      if (!prev || !projects.some((p) => p.id === prev)) {
        useProjects.getState().setActiveProject(projects[0].id);
      }
    }
  },
  loadTasks: async (projectId) => {
    const resp = await window.electronAPI.getTasks(projectId);
    if (resp.success && resp.data) {
      set((s) => ({ tasksByProject: { ...s.tasksByProject, [projectId]: resp.data! } }));
    }
  },
  reorderProjects: (reordered) => {
    set({ projects: reordered });
    ls()?.setItem('projectOrder', JSON.stringify(reordered.map((p) => p.id)));
  },
  reorderTasks: (projectId, reordered) =>
    set((s) => {
      const current = s.tasksByProject[projectId] || [];
      const archived = current.filter((t) => t.archivedAt);
      return { tasksByProject: { ...s.tasksByProject, [projectId]: [...reordered, ...archived] } };
    }),
  commitTaskReorder: async (projectId, reordered) => {
    const resp = await window.electronAPI.reorderTasks(
      projectId,
      reordered.map((t) => t.id),
    );
    if (resp.success) return;
    console.error('Failed to persist task reorder:', resp.error);
    toast.error('Failed to save task order');
    const refetch = await window.electronAPI.getTasks(projectId);
    if (refetch.success && refetch.data) {
      set((s) => ({ tasksByProject: { ...s.tasksByProject, [projectId]: refetch.data! } }));
    } else {
      toast.error('Could not recover task list — reloading');
      await useProjects.getState().loadTasks(projectId);
    }
  },
  archiveTask: async (id) => {
    await window.electronAPI.archiveTask(id);
    await reloadOwningProject(id);
  },
  restoreTask: async (id) => {
    await window.electronAPI.restoreTask(id);
    await reloadOwningProject(id);
  },
  closeTask: (id) => {
    disposeTaskSessions(id);
    window.electronAPI.ptyKill(id);
    window.electronAPI.ptyClearSnapshot(id);
    if (useProjects.getState().activeTaskId === id) useProjects.getState().setActiveTask(null);
  },
  updateTask: async (taskItem, patch) => {
    const resp = await window.electronAPI.saveTask({
      id: taskItem.id,
      projectId: taskItem.projectId,
      name: patch.name ?? taskItem.name,
      branch: taskItem.branch,
      path: taskItem.path,
      useWorktree: taskItem.useWorktree,
      permissionMode: patch.permissionMode ?? taskItem.permissionMode,
      branchCreatedByDash: taskItem.branchCreatedByDash,
      linkedItems: taskItem.linkedItems,
    });
    if (!resp.success || !resp.data) {
      toast.error(resp.error || 'Failed to save task');
      return null;
    }
    await useProjects.getState().loadTasks(taskItem.projectId);
    return resp.data;
  },
  deleteTask: async (taskItem, options) => {
    if (taskItem.useWorktree) {
      const project = useProjects.getState().projects.find((p) => p.id === taskItem.projectId);
      if (project) {
        await window.electronAPI.worktreeRemove({
          projectPath: project.path,
          worktreePath: taskItem.path,
          branch: taskItem.branch,
          options: options
            ? {
                deleteWorktreeDir: options.deleteWorktreeDir,
                deleteLocalBranch: options.deleteLocalBranch && taskItem.branchCreatedByDash,
                deleteRemoteBranch: options.deleteRemoteBranch && taskItem.branchCreatedByDash,
              }
            : undefined,
        });
      }
    }
    // Clean up all terminal sessions, then kill PTY + clear snapshot so a new
    // task in the same cwd starts fresh.
    disposeTaskSessions(taskItem.id);
    window.electronAPI.ptyKill(taskItem.id);
    window.electronAPI.ptyClearSnapshot(taskItem.id);
    await window.electronAPI.deleteTask(taskItem.id);
    if (useProjects.getState().activeTaskId === taskItem.id) {
      useProjects.getState().setActiveTask(null);
    }
    await useProjects.getState().loadTasks(taskItem.projectId);
  },
  deleteProject: async (project, options) => {
    const projectTasks = useProjects.getState().tasksByProject[project.id] ?? [];
    for (const t of projectTasks) {
      if (t.useWorktree) {
        await window.electronAPI.worktreeRemove({
          projectPath: project.path,
          worktreePath: t.path,
          branch: t.branch,
          options: {
            deleteWorktreeDir: options.deleteWorktreeDirs,
            deleteLocalBranch: options.deleteLocalBranches && t.branchCreatedByDash,
            deleteRemoteBranch: options.deleteRemoteBranches && t.branchCreatedByDash,
          },
        });
      }
      sessionRegistry.dispose(`shell:${t.id}`);
      sessionRegistry.disposeByPrefix(`shell:${t.id}:`);
    }
    await window.electronAPI.deleteProject(project.id);
    if (useProjects.getState().activeProjectId === project.id) {
      useProjects.getState().setActiveProject(null);
      useProjects.getState().setActiveTask(null);
    }
    set((s) => {
      const next = { ...s.tasksByProject };
      delete next[project.id];
      return { tasksByProject: next };
    });
    await useProjects.getState().loadProjects();
  },
}));

// ── Selectors ───────────────────────────────────────────────
export const selectActiveProject = (s: ProjectsState): Project | null =>
  s.projects.find((p) => p.id === s.activeProjectId) ?? null;

export const selectActiveTask = (s: ProjectsState): Task | null => {
  if (!s.activeTaskId) return null;
  for (const tasks of Object.values(s.tasksByProject)) {
    const found = tasks.find((t) => t.id === s.activeTaskId);
    if (found) return found;
  }
  return null;
};

export const selectActiveProjectTasks = (s: ProjectsState): Task[] =>
  s.activeProjectId ? (s.tasksByProject[s.activeProjectId] ?? []).filter((t) => !t.archivedAt) : [];
