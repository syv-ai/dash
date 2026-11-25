import { create } from 'zustand';
import type { Project, Task } from '../../shared/types';
import type { DeleteProjectOptions } from '../components/project/DeleteProjectModal';
import { parseAdoRemote } from '../../shared/urls';
import { useProjects } from './projectsStore';

export interface AdoSetup {
  projectId: string;
  organizationUrl: string;
  project: string;
}

export interface DeleteTaskOptions {
  deleteWorktreeDir: boolean;
  deleteLocalBranch: boolean;
  deleteRemoteBranch: boolean;
}

type Updater<T> = T | ((prev: T) => T);

const apply = <T>(v: Updater<T>, prev: T): T =>
  typeof v === 'function' ? (v as (p: T) => T)(prev) : v;

export interface UiState {
  // Modal open-flags + targets
  showTaskModal: boolean;
  taskModalProjectId: string | null;
  showAddProjectModal: boolean;
  deleteTaskTarget: Task | null;
  deleteProjectTarget: Project | null;
  projectSettingsTarget: Project | null;
  taskSettingsTarget: Task | null;
  adoSetup: AdoSetup | null;
  showSettings: boolean;
  /** The ⌘K task finder. */
  taskFinderOpen: boolean;
  // Project whose Claude memory the memory modal shows; null → closed.
  memoryProjectId: string | null;
  // The task whose "…" menu opened the memory modal (where "Send to task"
  // goes first); null when it was opened from a project.
  memoryTaskId: string | null;
  settingsInitialTab: string | undefined;
  remoteControlModalPtyId: string | null;
  // Panel-animation flags (driven by App's panel toggle handlers)
  sidebarAnimating: boolean;
  changesAnimating: boolean;
  shellDrawerAnimating: boolean;
  // The update the sidebar banner was closed for. Session-only: a ready
  // update installs on quit, and a newer version brings the banner back.
  dismissedUpdateVersion: string | null;
  /** Review mode's Comments tab: which side of its switch shows.
   *  Session-only, the same for every task. */
  reviewCommentsPane: ReviewCommentsPane;
  /** Review mode's Files lists every file at the PR's head, not only the
   *  changed ones. Session-only, the same for every task. */
  reviewAllFiles: boolean;
  /** Review mode's collapsible sections, open or not, by id
   *  (`useSectionOpen`); a section not in it keeps its default. Session-only. */
  reviewSections: Readonly<Record<string, boolean>>;
}

/** The Comments tab's switch: every exchange with the author, and the notes
 *  to the agent. */
export type ReviewCommentsPane = 'comments' | 'notes';

export interface UiActions {
  setShowTaskModal: (v: boolean) => void;
  setTaskModalProjectId: (v: string | null) => void;
  setShowAddProjectModal: (v: boolean) => void;
  setDeleteTaskTarget: (v: Task | null) => void;
  setDeleteProjectTarget: (v: Project | null) => void;
  setProjectSettingsTarget: (v: Updater<Project | null>) => void;
  setTaskSettingsTarget: (v: Updater<Task | null>) => void;
  setAdoSetup: (v: AdoSetup | null) => void;
  setShowSettings: (v: Updater<boolean>) => void;
  setTaskFinderOpen: (v: Updater<boolean>) => void;
  /** Show a project's memory (null closes the modal). Switching project keeps the task it was opened from. */
  setMemoryProjectId: (v: string | null) => void;
  /** Open the memory modal from a task's menu, on that task's project. */
  openTaskMemory: (projectId: string, taskId: string) => void;
  setSettingsInitialTab: (v: string | undefined) => void;
  setRemoteControlModalPtyId: (v: string | null) => void;
  setSidebarAnimating: (v: boolean) => void;
  setChangesAnimating: (v: boolean) => void;
  setShellDrawerAnimating: (v: boolean) => void;
  setDismissedUpdateVersion: (v: string | null) => void;
  setReviewCommentsPane: (v: ReviewCommentsPane) => void;
  setReviewAllFiles: (v: boolean) => void;
  setReviewSectionOpen: (id: string, open: boolean) => void;
  // Data-mutating UI flows (own their modal state; delegate domain ops to projectsStore)
  finishProjectCreation: (projectId: string) => Promise<void>;
  confirmDeleteProject: (options: DeleteProjectOptions) => Promise<void>;
  confirmDeleteTask: (options?: DeleteTaskOptions) => Promise<void>;
}

export type UiStore = UiState & UiActions;

const initialState: UiState = {
  showTaskModal: false,
  taskModalProjectId: null,
  showAddProjectModal: false,
  deleteTaskTarget: null,
  deleteProjectTarget: null,
  projectSettingsTarget: null,
  taskSettingsTarget: null,
  adoSetup: null,
  showSettings: false,
  taskFinderOpen: false,
  memoryProjectId: null,
  memoryTaskId: null,
  settingsInitialTab: undefined,
  remoteControlModalPtyId: null,
  sidebarAnimating: false,
  changesAnimating: false,
  shellDrawerAnimating: false,
  dismissedUpdateVersion: null,
  reviewCommentsPane: 'comments',
  reviewAllFiles: false,
  reviewSections: {},
};

export const useUi = create<UiStore>((set, get) => ({
  ...initialState,

  setShowTaskModal: (v) => set({ showTaskModal: v }),
  setTaskModalProjectId: (v) => set({ taskModalProjectId: v }),
  setShowAddProjectModal: (v) => set({ showAddProjectModal: v }),
  setDeleteTaskTarget: (v) => set({ deleteTaskTarget: v }),
  setDeleteProjectTarget: (v) => set({ deleteProjectTarget: v }),
  setProjectSettingsTarget: (v) =>
    set((s) => ({ projectSettingsTarget: apply(v, s.projectSettingsTarget) })),
  setTaskSettingsTarget: (v) =>
    set((s) => ({ taskSettingsTarget: apply(v, s.taskSettingsTarget) })),
  setAdoSetup: (v) => set({ adoSetup: v }),
  setShowSettings: (v) => set((s) => ({ showSettings: apply(v, s.showSettings) })),
  setTaskFinderOpen: (v) => set((s) => ({ taskFinderOpen: apply(v, s.taskFinderOpen) })),
  setMemoryProjectId: (v) =>
    set((s) => ({
      memoryProjectId: v,
      // Opening from a project, or closing, drops the task it was opened from.
      memoryTaskId: v !== null && s.memoryProjectId !== null ? s.memoryTaskId : null,
    })),
  openTaskMemory: (projectId, taskId) => set({ memoryProjectId: projectId, memoryTaskId: taskId }),
  setSettingsInitialTab: (v) => set({ settingsInitialTab: v }),
  setRemoteControlModalPtyId: (v) => set({ remoteControlModalPtyId: v }),
  setSidebarAnimating: (v) => set({ sidebarAnimating: v }),
  setChangesAnimating: (v) => set({ changesAnimating: v }),
  setShellDrawerAnimating: (v) => set({ shellDrawerAnimating: v }),
  setDismissedUpdateVersion: (v) => set({ dismissedUpdateVersion: v }),
  setReviewCommentsPane: (v) => set({ reviewCommentsPane: v }),
  setReviewAllFiles: (v) => set({ reviewAllFiles: v }),
  setReviewSectionOpen: (id, open) =>
    set((s) => ({ reviewSections: { ...s.reviewSections, [id]: open } })),

  finishProjectCreation: async (projectId) => {
    set({ showAddProjectModal: false });
    await useProjects.getState().loadProjects();
    useProjects.getState().setActiveTask(null);
    useProjects.getState().setActiveProject(projectId);
    useProjects.getState().setJustCreatedProject(projectId);
    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    promptAdoSetupIfNeeded(set, projectId, project?.gitRemote ?? null);
  },

  confirmDeleteProject: async (options) => {
    const target = get().deleteProjectTarget;
    if (!target) return;
    await useProjects.getState().deleteProject(target, options);
    set({ deleteProjectTarget: null });
  },

  confirmDeleteTask: async (options) => {
    const target = get().deleteTaskTarget;
    if (!target) return;
    try {
      await useProjects.getState().deleteTask(target, options);
    } finally {
      set({ deleteTaskTarget: null });
    }
  },
}));

function promptAdoSetupIfNeeded(
  set: (partial: Partial<UiState>) => void,
  projectId: string,
  remote: string | null,
) {
  if (!remote) return;
  const adoInfo = parseAdoRemote(remote);
  if (adoInfo) {
    set({
      adoSetup: { projectId, organizationUrl: adoInfo.organizationUrl, project: adoInfo.project },
    });
  }
}
