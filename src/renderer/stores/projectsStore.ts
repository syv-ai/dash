import { create } from 'zustand';
import type { Project, Task, BranchInfo } from '../../shared/types';

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
