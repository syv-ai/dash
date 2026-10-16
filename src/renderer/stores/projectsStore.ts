import { create } from 'zustand';
import { toast } from 'sonner';
import { sessionRegistry } from '../terminal/SessionRegistry';
import type { Project, Task, BranchInfo, DeleteTaskOptions } from '../../shared/types';
import type { DeleteProjectOptions } from '../components/project/DeleteProjectModal';
import type { CreateTaskOptions } from '../components/task/TaskModal';
import { playPeonSound } from '../sounds';
import { useSettings } from './settingsStore';
import { notifyContextInjected } from './taskToasts';

export interface ProjectsState {
  /** Projects in the project list. Archived ones live in `archivedProjects`
   *  only, so everything that walks `projects` skips them. */
  projects: Project[];
  archivedProjects: Project[];
  tasksByProject: Record<string, Task[]>;
  activeProjectId: string | null;
  activeTaskId: string | null;
  branchesByProject: Record<string, BranchInfo[]>;
  ghAvailable: boolean;
  adoConfiguredById: Record<string, boolean>;
  availableIDEs: Array<{ id: string; label: string }>;
  isCreatingTask: boolean;
  /** Id of a project just created via the wizard — the sidebar scrolls its row
   *  into view once, then clears this. */
  justCreatedProjectId: string | null;
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
  setJustCreatedProject: (id: string | null) => void;
  clearJustCreatedProject: () => void;
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
  closeTask: (id: string) => Promise<void>;
  updateTask: (taskItem: Task, patch: Partial<Task>) => Promise<Task | null>;
  deleteTask: (taskItem: Task, options?: DeleteTaskOptions) => Promise<void>;
  deleteProject: (project: Project, options: DeleteProjectOptions) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  restoreProject: (id: string) => Promise<void>;
  createTask: (options: CreateTaskOptions, projectId?: string) => Promise<boolean>;
  /** Turn a task's Dash access on or off. A running session restarts so its
   *  next dispatch adds or drops the dash MCP server; returns the updated task. */
  setDashAccess: (taskItem: Task, enabled: boolean, running: boolean) => Promise<Task | null>;
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
  void sessionRegistry.dispose(taskId);
  void sessionRegistry.dispose(`shell:${taskId}`);
  void sessionRegistry.disposeByPrefix(`shell:${taskId}:`);
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
  archivedProjects: [],
  tasksByProject: {},
  activeProjectId: initialActive('activeProjectId'),
  activeTaskId: initialActive('activeTaskId'),
  branchesByProject: {},
  ghAvailable: false,
  adoConfiguredById: {},
  availableIDEs: [],
  isCreatingTask: false,
  justCreatedProjectId: null,

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
  setJustCreatedProject: (id) => set({ justCreatedProjectId: id }),
  clearJustCreatedProject: () => set({ justCreatedProjectId: null }),
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
    const all = resp.data.map((p) => {
      const looksLikePath = p.name.includes('\\') || p.name.includes('/');
      return looksLikePath ? { ...p, name: p.name.split(/[\\/]/).pop() || p.name } : p;
    });
    const projects = all.filter((p) => !p.archivedAt);
    const archivedProjects = all
      .filter((p) => p.archivedAt)
      .sort((a, b) => a.name.localeCompare(b.name));
    set((s) => {
      // Drop the tasks of projects that left the list (archived) so nothing
      // keeps rendering or polling them.
      const ids = new Set(projects.map((p) => p.id));
      const tasksByProject = Object.fromEntries(
        Object.entries(s.tasksByProject).filter(([id]) => ids.has(id)),
      );
      return { projects: applyProjectOrder(projects), archivedProjects, tasksByProject };
    });
    if (projects.length > 0) {
      const prev = useProjects.getState().activeProjectId;
      if (!prev || !projects.some((p) => p.id === prev)) {
        useProjects.getState().setActiveProject(projects[0]!.id);
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
  closeTask: async (id) => {
    disposeTaskSessions(id);
    void window.electronAPI.ptyClearSnapshot(id);
    if (useProjects.getState().activeTaskId === id) useProjects.getState().setActiveTask(null);
    // "Put to sleep" = `claude stop` under the supervisor. A bare ptyKill only
    // detaches the attach client and leaves the session running.
    const resp = await window.electronAPI.ptyStopSession(id);
    if (!resp.success) toast.error(resp.error || 'Failed to put task to sleep');
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
      model: patch.model ?? taskItem.model,
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
    // Main removes the worktree (as the dialog asked; branches only when Dash
    // created them), the supervisor session and the row.
    const resp = await window.electronAPI.deleteTask(taskItem.id, options);
    if (!resp.success) {
      toast.error(resp.error || 'Failed to delete task');
      return;
    }
    // Clean up all terminal sessions and the snapshot so a new task in the
    // same cwd starts fresh.
    disposeTaskSessions(taskItem.id);
    void window.electronAPI.ptyClearSnapshot(taskItem.id);
    if (useProjects.getState().activeTaskId === taskItem.id) {
      useProjects.getState().setActiveTask(null);
    }
    await useProjects.getState().loadTasks(taskItem.projectId);
  },
  deleteProject: async (project, options) => {
    // An archived project's tasks aren't loaded; fetch them so their
    // worktrees are cleaned up too.
    let projectTasks = useProjects.getState().tasksByProject[project.id];
    if (!projectTasks) {
      const resp = await window.electronAPI.getTasks(project.id);
      projectTasks = resp.success && resp.data ? resp.data : [];
    }
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
            teardownScript: t.teardownScript,
          },
        });
      }
      void sessionRegistry.dispose(`shell:${t.id}`);
      void sessionRegistry.disposeByPrefix(`shell:${t.id}:`);
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
  archiveProject: async (id) => {
    const projectTasks = useProjects.getState().tasksByProject[id] ?? [];
    const resp = await window.electronAPI.archiveProject(id);
    if (!resp.success) {
      toast.error(resp.error || 'Failed to archive project');
      return;
    }
    for (const t of projectTasks) disposeTaskSessions(t.id);
    const { activeProjectId, activeTaskId, setActiveProject, setActiveTask } =
      useProjects.getState();
    if (activeTaskId && projectTasks.some((t) => t.id === activeTaskId)) setActiveTask(null);
    await useProjects.getState().loadProjects();
    if (activeProjectId === id) {
      setActiveProject(useProjects.getState().projects[0]?.id ?? null);
    }
  },
  restoreProject: async (id) => {
    const resp = await window.electronAPI.restoreProject(id);
    if (!resp.success) {
      toast.error(resp.error || 'Failed to restore project');
      return;
    }
    await useProjects.getState().loadProjects();
  },
  createTask: async (options, projectId) => {
    const targetProjectId = projectId ?? useProjects.getState().activeProjectId;
    if (!targetProjectId) return false;

    set({ isCreatingTask: true });
    try {
      // Main does the work (worktree, row, ports, first prompt, reserve refill,
      // branch comments); what's left here is UI.
      const resp = await window.electronAPI.createTask({ ...options, projectId: targetProjectId });
      if (!resp.success || !resp.data) {
        toast.error(resp.error || 'Failed to create task');
        return false;
      }
      const { linkedItems } = options;
      if (linkedItems && linkedItems.length > 0) notifyContextInjected(linkedItems);

      await useProjects.getState().loadTasks(targetProjectId);
      useProjects.getState().setActiveProject(targetProjectId);
      useProjects.getState().setActiveTask(resp.data.task.id);

      if (useSettings.getState().notificationSound === 'peon') playPeonSound('what');
      return true;
    } finally {
      set({ isCreatingTask: false });
    }
  },
  setDashAccess: async (taskItem, enabled, running) => {
    const resp = await window.electronAPI.setTaskDashAccess({ taskId: taskItem.id, enabled });
    if (!resp.success || !resp.data) {
      toast.error(resp.error || 'Failed to change Dash access');
      return null;
    }
    await useProjects.getState().loadTasks(taskItem.projectId);
    // Not awaited: the switch shows the new value while the session restarts.
    if (running) {
      void sessionRegistry.restartAgent(taskItem.id).catch((err: unknown) => {
        toast.error(`Failed to restart the session: ${String(err)}`);
      });
    }
    return resp.data;
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
