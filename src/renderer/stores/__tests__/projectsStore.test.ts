import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shallow } from 'zustand/vanilla/shallow';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { Project, Task } from '../../../shared/types';
import type { DeleteProjectOptions } from '../../components/project/DeleteProjectModal';
import type { CreateTaskOptions } from '../../components/task/TaskModal';

vi.mock('../../terminal/SessionRegistry', () => ({
  sessionRegistry: {
    dispose: vi.fn(),
    disposeByPrefix: vi.fn(),
    restartAllForTask: vi.fn(),
    restartAgent: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock('../../sounds', () => ({ playPeonSound: vi.fn(), playNotificationSound: vi.fn() }));

const proj = (id: string, over: Partial<Project> = {}): Project =>
  ({
    id,
    name: id,
    path: `/p/${id}`,
    isGitRepo: true,
    gitRemote: null,
    gitBranch: 'main',
    ...over,
  }) as Project;
const task = (id: string, projectId: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    projectId,
    name: id,
    branch: 'b',
    path: `/p/${projectId}/${id}`,
    useWorktree: true,
    archivedAt: null,
    ...over,
  }) as Task;

// Import AFTER mocks/window so the module reads the stubbed window at first use.
let store: typeof import('../projectsStore');
async function freshStore() {
  vi.resetModules();
  store = await import('../projectsStore');
  return store.useProjects;
}

describe('projectsStore state + selectors', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('setActiveProject persists to the activeProjectId localStorage key', async () => {
    const useProjects = await freshStore();
    useProjects.getState().setActiveProject('p1');
    expect(useProjects.getState().activeProjectId).toBe('p1');
    expect(window.localStorage.getItem('activeProjectId')).toBe('p1');
    useProjects.getState().setActiveProject(null);
    expect(window.localStorage.getItem('activeProjectId')).toBeNull();
  });

  it('setActiveTask persists to the activeTaskId localStorage key', async () => {
    const useProjects = await freshStore();
    useProjects.getState().setActiveTask('t1');
    expect(window.localStorage.getItem('activeTaskId')).toBe('t1');
    useProjects.getState().setActiveTask(null);
    expect(window.localStorage.getItem('activeTaskId')).toBeNull();
  });

  it('selectActiveProject / selectActiveTask / selectActiveProjectTasks', async () => {
    const useProjects = await freshStore();
    useProjects.setState({
      projects: [proj('p1'), proj('p2')],
      tasksByProject: {
        p1: [task('t1', 'p1'), task('t2', 'p1', { archivedAt: '123' })],
        p2: [task('t3', 'p2')],
      },
      activeProjectId: 'p1',
      activeTaskId: 't3',
    });
    const s = useProjects.getState();
    expect(store.selectActiveProject(s)?.id).toBe('p1');
    expect(store.selectActiveTask(s)?.id).toBe('t3'); // searches all projects
    expect(store.selectActiveProjectTasks(s).map((t) => t.id)).toEqual(['t1']); // non-archived for active project
  });

  // App subscribes via useProjects(useShallow(selectActiveProjectTasks)). The raw selector
  // filters → a fresh array every call (a !== b), which alone would loop useSyncExternalStore;
  // useShallow only rescues it because successive outputs are SHALLOW-equal. If a future change
  // makes the output not shallow-stable for unchanged state, useShallow stops working and the
  // app loops again — this test guards that invariant in the (renderable-free) vanilla layer.
  it('selectActiveProjectTasks is shallow-stable across calls (the useShallow precondition)', async () => {
    const useProjects = await freshStore();
    useProjects.setState({
      tasksByProject: { p1: [task('t1', 'p1'), task('t2', 'p1', { archivedAt: '123' })] },
      activeProjectId: 'p1',
    });
    const s = useProjects.getState();
    const a = store.selectActiveProjectTasks(s);
    const b = store.selectActiveProjectTasks(s);
    expect(a).not.toBe(b); // raw selector allocates a new array each call (the hazard)
    expect(shallow(a, b)).toBe(true); // ...but shallow-equal, so useShallow collapses them
  });
});

describe('projectsStore loadProjects / loadTasks', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('loadProjects applies saved projectOrder and prunes stale ids', async () => {
    const useProjects = await freshStore();
    window.localStorage.setItem('projectOrder', JSON.stringify(['p2', 'p1', 'gone']));
    api.getProjects.mockResolvedValue({ success: true, data: [proj('p1'), proj('p2')] });
    await useProjects.getState().loadProjects();
    expect(useProjects.getState().projects.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(JSON.parse(window.localStorage.getItem('projectOrder')!)).toEqual(['p2', 'p1']);
  });

  it('loadProjects defaults activeProject to first only when no valid selection', async () => {
    const useProjects = await freshStore();
    api.getProjects.mockResolvedValue({ success: true, data: [proj('p1'), proj('p2')] });
    await useProjects.getState().loadProjects();
    expect(useProjects.getState().activeProjectId).toBe('p1');
    useProjects.getState().setActiveProject('p2');
    await useProjects.getState().loadProjects();
    expect(useProjects.getState().activeProjectId).toBe('p2'); // kept
  });

  it('loadProjects shortens Windows-style path names', async () => {
    const useProjects = await freshStore();
    api.getProjects.mockResolvedValue({
      success: true,
      data: [proj('p1', { name: 'C:\\repos\\app' })],
    });
    await useProjects.getState().loadProjects();
    expect(useProjects.getState().projects[0]!.name).toBe('app');
  });

  it('loadTasks stores tasks under the project id', async () => {
    const useProjects = await freshStore();
    api.getTasks.mockResolvedValue({ success: true, data: [task('t1', 'p1')] });
    await useProjects.getState().loadTasks('p1');
    expect(useProjects.getState().tasksByProject.p1!.map((t) => t.id)).toEqual(['t1']);
  });

  it('loadTasks disposes the sessions of a task that disappeared and deselects it', async () => {
    const useProjects = await freshStore();
    const { sessionRegistry } = await import('../../terminal/SessionRegistry');
    useProjects.setState({ tasksByProject: { p1: [task('t1', 'p1'), task('t2', 'p1')] } });
    useProjects.getState().setActiveTask('t1');
    // Deleted elsewhere (the control API): main only says the list changed.
    api.getTasks.mockResolvedValue({ success: true, data: [task('t2', 'p1')] });
    await useProjects.getState().loadTasks('p1');
    expect(sessionRegistry.dispose).toHaveBeenCalledWith('t1');
    expect(sessionRegistry.dispose).toHaveBeenCalledWith('shell:t1');
    expect(sessionRegistry.disposeByPrefix).toHaveBeenCalledWith('shell:t1:');
    expect(sessionRegistry.disposeByPrefix).toHaveBeenCalledWith('service:t1:');
    expect(sessionRegistry.dispose).not.toHaveBeenCalledWith('t2');
    expect(api.ptyClearSnapshot).toHaveBeenCalledWith('t1');
    expect(useProjects.getState().activeTaskId).toBeNull();
  });

  it('loadTasks drops a response a newer load overtook, so a new task is not read as deleted', async () => {
    const useProjects = await freshStore();
    const { sessionRegistry } = await import('../../terminal/SessionRegistry');
    let releaseStale!: () => void;
    api.getTasks
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseStale = () => resolve({ success: true, data: [] });
          }),
      )
      .mockResolvedValueOnce({ success: true, data: [task('new', 'p1')] });
    const stale = useProjects.getState().loadTasks('p1');
    await useProjects.getState().loadTasks('p1');
    releaseStale();
    await stale;
    expect(useProjects.getState().tasksByProject.p1!.map((t) => t.id)).toEqual(['new']);
    expect(sessionRegistry.dispose).not.toHaveBeenCalledWith('new');
  });
});

describe('projectsStore reordering', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('reorderProjects sets projects and persists projectOrder', async () => {
    const useProjects = await freshStore();
    useProjects.getState().reorderProjects([proj('p2'), proj('p1')]);
    expect(useProjects.getState().projects.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(JSON.parse(window.localStorage.getItem('projectOrder')!)).toEqual(['p2', 'p1']);
  });

  it('reorderTasks keeps archived tasks appended after the new order', async () => {
    const useProjects = await freshStore();
    useProjects.setState({
      tasksByProject: {
        p1: [task('t1', 'p1'), task('t2', 'p1'), task('a1', 'p1', { archivedAt: '9' })],
      },
    });
    useProjects.getState().reorderTasks('p1', [task('t2', 'p1'), task('t1', 'p1')]);
    expect(useProjects.getState().tasksByProject.p1!.map((t) => t.id)).toEqual(['t2', 't1', 'a1']);
  });

  it('commitTaskReorder refetches and toasts on failure', async () => {
    const useProjects = await freshStore();
    api.reorderTasks.mockResolvedValue({ success: false, error: 'boom' });
    api.getTasks.mockResolvedValue({ success: true, data: [task('t1', 'p1')] });
    await useProjects.getState().commitTaskReorder('p1', [task('t2', 'p1')]);
    expect(api.getTasks).toHaveBeenCalledWith('p1');
    expect(useProjects.getState().tasksByProject.p1!.map((t) => t.id)).toEqual(['t1']);
  });
});

describe('projectsStore archive/restore/close/update', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  // The list reloads on main's `tasks:changed` push, not from the action.
  it('archiveTask calls IPC and leaves the reload to the push', async () => {
    const useProjects = await freshStore();
    useProjects.setState({ tasksByProject: { p1: [task('t1', 'p1')] } });
    await useProjects.getState().archiveTask('t1');
    expect(api.archiveTask).toHaveBeenCalledWith('t1');
    expect(api.getTasks).not.toHaveBeenCalled();
  });

  it('restoreTask calls IPC and leaves the reload to the push', async () => {
    const useProjects = await freshStore();
    useProjects.setState({ tasksByProject: { p1: [task('t1', 'p1', { archivedAt: '5' })] } });
    await useProjects.getState().restoreTask('t1');
    expect(api.restoreTask).toHaveBeenCalledWith('t1');
    expect(api.getTasks).not.toHaveBeenCalled();
  });

  it('closeTask stops the supervisor session (not just the pty), clears snapshot, and clears active task if it was active', async () => {
    const useProjects = await freshStore();
    useProjects.getState().setActiveTask('t1');
    await useProjects.getState().closeTask('t1');
    // A bare ptyKill only detaches the attach client; sleeping means `claude stop`.
    expect(api.ptyStopSession).toHaveBeenCalledWith('t1');
    expect(api.ptyKill).not.toHaveBeenCalled();
    expect(api.ptyClearSnapshot).toHaveBeenCalledWith('t1');
    expect(useProjects.getState().activeTaskId).toBeNull();
  });

  it('closeTask surfaces a failed stop as a toast', async () => {
    const useProjects = await freshStore();
    api.ptyStopSession.mockResolvedValueOnce({ success: false, error: 'claude stop failed' });
    await useProjects.getState().closeTask('t1');
    const { toast } = await import('sonner');
    expect(toast.error).toHaveBeenCalledWith('claude stop failed');
  });

  it('updateTask saves, reloads, and returns the updated task', async () => {
    const useProjects = await freshStore();
    const updated = task('t1', 'p1', { name: 'renamed' });
    api.saveTask.mockResolvedValue({ success: true, data: updated });
    api.getTasks.mockResolvedValue({ success: true, data: [updated] });
    const result = await useProjects.getState().updateTask(task('t1', 'p1'), { name: 'renamed' });
    expect(result?.name).toBe('renamed');
    expect(api.saveTask).toHaveBeenCalled();
  });
});

describe('projectsStore delete', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('deleteTask hands the dialog options to main, then clears UI state', async () => {
    const useProjects = await freshStore();
    useProjects.setState({
      projects: [proj('p1')],
      tasksByProject: { p1: [task('t1', 'p1', { branchCreatedByDash: true })] },
    });
    useProjects.getState().setActiveTask('t1');
    api.getTasks.mockResolvedValue({ success: true, data: [] });
    const options = {
      deleteWorktreeDir: true,
      deleteLocalBranch: true,
      deleteRemoteBranch: false,
    };
    await useProjects
      .getState()
      .deleteTask(task('t1', 'p1', { branchCreatedByDash: true }), options);
    // Worktree removal and branch gating live in main (TaskService.delete).
    expect(api.deleteTask).toHaveBeenCalledWith('t1', options);
    expect(api.ptyClearSnapshot).toHaveBeenCalledWith('t1');
    expect(useProjects.getState().activeTaskId).toBeNull();
    // The list reloads on main's `tasks:changed` push.
    expect(api.getTasks).not.toHaveBeenCalled();
  });

  it('deleteTask keeps the task selected and toasts when main refuses', async () => {
    const useProjects = await freshStore();
    useProjects.getState().setActiveTask('t1');
    api.deleteTask.mockResolvedValueOnce({ success: false, error: 'busy' });
    await useProjects.getState().deleteTask(task('t1', 'p1'), {
      deleteWorktreeDir: true,
      deleteLocalBranch: false,
      deleteRemoteBranch: false,
    });
    const { toast } = await import('sonner');
    expect(toast.error).toHaveBeenCalledWith('busy');
    expect(useProjects.getState().activeTaskId).toBe('t1');
  });

  it('deleteProject has main delete the tasks and project, then clears active and the panes', async () => {
    const useProjects = await freshStore();
    useProjects.setState({
      projects: [proj('p1')],
      tasksByProject: { p1: [task('t1', 'p1', { branchCreatedByDash: true })] },
      activeProjectId: 'p1',
    });
    api.getProjects.mockResolvedValue({ success: true, data: [] });
    const opts: DeleteProjectOptions = {
      deleteWorktreeDirs: true,
      deleteLocalBranches: true,
      deleteRemoteBranches: false,
    };
    await useProjects.getState().deleteProject(proj('p1'), opts);
    // Worktree removal and branch gating live in main (TaskService.deleteProject).
    expect(api.deleteProject).toHaveBeenCalledWith('p1', {
      deleteWorktreeDir: true,
      deleteLocalBranch: true,
      deleteRemoteBranch: false,
    });
    expect(api.ptyClearSnapshot).toHaveBeenCalledWith('t1');
    expect(useProjects.getState().activeProjectId).toBeNull();
    expect(useProjects.getState().tasksByProject.p1).toBeUndefined();
  });
});

describe('projectsStore project archive', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('loadProjects keeps archived projects out of the list and drops their tasks', async () => {
    const useProjects = await freshStore();
    useProjects.setState({ tasksByProject: { p1: [task('t1', 'p1')], p2: [task('t2', 'p2')] } });
    api.getProjects.mockResolvedValue({
      success: true,
      data: [proj('p1'), proj('p2', { archivedAt: '2026-10-12' })],
    });
    await useProjects.getState().loadProjects();
    const s = useProjects.getState();
    expect(s.projects.map((p) => p.id)).toEqual(['p1']);
    expect(s.archivedProjects.map((p) => p.id)).toEqual(['p2']);
    expect(Object.keys(s.tasksByProject)).toEqual(['p1']);
  });

  it('archiveProject moves the selection off the archived project', async () => {
    const useProjects = await freshStore();
    useProjects.setState({
      projects: [proj('p1'), proj('p2')],
      tasksByProject: { p1: [task('t1', 'p1')], p2: [] },
      activeProjectId: 'p1',
      activeTaskId: 't1',
    });
    api.getProjects.mockResolvedValue({
      success: true,
      data: [proj('p1', { archivedAt: '2026-10-12' }), proj('p2')],
    });
    await useProjects.getState().archiveProject('p1');
    expect(api.archiveProject).toHaveBeenCalledWith('p1');
    const s = useProjects.getState();
    expect(s.activeProjectId).toBe('p2');
    expect(s.activeTaskId).toBeNull();
    expect(s.archivedProjects.map((p) => p.id)).toEqual(['p1']);
  });

  it('archiveProject leaves state alone and toasts when the IPC fails', async () => {
    const useProjects = await freshStore();
    useProjects.setState({ projects: [proj('p1')], activeProjectId: 'p1' });
    api.archiveProject.mockResolvedValue({ success: false, error: 'nope' });
    await useProjects.getState().archiveProject('p1');
    expect(useProjects.getState().activeProjectId).toBe('p1');
    expect(api.getProjects).not.toHaveBeenCalled();
  });

  it('restoreProject brings the project back into the list', async () => {
    const useProjects = await freshStore();
    useProjects.setState({ projects: [], archivedProjects: [proj('p1', { archivedAt: 'x' })] });
    api.getProjects.mockResolvedValue({ success: true, data: [proj('p1')] });
    await useProjects.getState().restoreProject('p1');
    expect(api.restoreProject).toHaveBeenCalledWith('p1');
    expect(useProjects.getState().projects.map((p) => p.id)).toEqual(['p1']);
    expect(useProjects.getState().archivedProjects).toEqual([]);
  });

  it('deleteProject on an archived project fetches its tasks to clean up their panes', async () => {
    const useProjects = await freshStore();
    api.getTasks.mockResolvedValue({ success: true, data: [task('t1', 'p1')] });
    await useProjects.getState().deleteProject(proj('p1', { archivedAt: 'x' }), {
      deleteWorktreeDirs: true,
      deleteLocalBranches: false,
      deleteRemoteBranches: false,
    });
    expect(api.getTasks).toHaveBeenCalledWith('p1');
    expect(api.ptyClearSnapshot).toHaveBeenCalledWith('t1');
  });

  it('deleteProject keeps the project and toasts when main refuses', async () => {
    const useProjects = await freshStore();
    useProjects.setState({ projects: [proj('p1')], activeProjectId: 'p1' });
    api.deleteProject.mockResolvedValueOnce({ success: false, error: 'nope' });
    await useProjects.getState().deleteProject(proj('p1'), {
      deleteWorktreeDirs: false,
      deleteLocalBranches: false,
      deleteRemoteBranches: false,
    });
    const { toast } = await import('sonner');
    expect(toast.error).toHaveBeenCalledWith('nope');
    expect(useProjects.getState().activeProjectId).toBe('p1');
  });
});

describe('projectsStore createTask', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('creates the task in main with the target project, then selects it', async () => {
    const useProjects = await freshStore();
    useProjects.setState({ projects: [proj('p1')], activeProjectId: 'p1' });
    api.createTask.mockResolvedValue({
      success: true,
      data: { task: task('t9', 'p1'), session: 'deferred' },
    });
    api.getTasks.mockResolvedValue({ success: true, data: [task('t9', 'p1')] });
    const options = {
      kind: 'worktree-new-branch',
      name: 'x',
      baseRef: 'main',
      pushRemote: false,
      permissionMode: 'default',
    } as CreateTaskOptions;
    const ok = await useProjects.getState().createTask(options);
    expect(ok).toBe(true);
    expect(api.createTask).toHaveBeenCalledWith({ ...options, projectId: 'p1' });
    expect(api.createTask).toHaveBeenCalledTimes(1);
    expect(api.saveTask).not.toHaveBeenCalled();
    expect(useProjects.getState().tasksByProject.p1!.map((t) => t.id)).toEqual(['t9']);
    expect(useProjects.getState().activeTaskId).toBe('t9');
    expect(useProjects.getState().isCreatingTask).toBe(false);
  });

  it("passes the dialog's dashAccess choice through to main", async () => {
    const useProjects = await freshStore();
    useProjects.setState({ projects: [proj('p1')], activeProjectId: 'p1' });
    api.createTask.mockResolvedValue({
      success: true,
      data: { task: task('t9', 'p1', { dashAccess: true }), session: 'deferred' },
    });
    await useProjects.getState().createTask({
      kind: 'in-place-no-git',
      name: 'x',
      permissionMode: 'default',
      dashAccess: true,
    } as CreateTaskOptions);
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', dashAccess: true }),
    );
  });

  it('targets the given project over the active one', async () => {
    const useProjects = await freshStore();
    useProjects.setState({ projects: [proj('p1'), proj('p2')], activeProjectId: 'p1' });
    api.createTask.mockResolvedValue({
      success: true,
      data: { task: task('t9', 'p2'), session: 'deferred' },
    });
    await useProjects
      .getState()
      .createTask({ kind: 'in-place-no-git', name: 'x' } as CreateTaskOptions, 'p2');
    expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p2' }));
    expect(useProjects.getState().activeProjectId).toBe('p2');
  });

  it('returns false and toasts when main fails to create the task', async () => {
    const useProjects = await freshStore();
    useProjects.setState({ projects: [proj('p1')], activeProjectId: 'p1' });
    api.createTask.mockResolvedValue({ success: false, error: 'nope' });
    const ok = await useProjects.getState().createTask({
      kind: 'worktree-new-branch',
      name: 'x',
      baseRef: 'main',
      pushRemote: false,
      permissionMode: 'default',
    } as CreateTaskOptions);
    expect(ok).toBe(false);
    const { toast } = await import('sonner');
    expect(toast.error).toHaveBeenCalledWith('nope');
    expect(useProjects.getState().isCreatingTask).toBe(false);
  });

  it('returns false when there is no target project', async () => {
    const useProjects = await freshStore();
    const ok = await useProjects.getState().createTask({
      kind: 'in-place-no-git',
      name: 'x',
      permissionMode: 'default',
    } as CreateTaskOptions);
    expect(ok).toBe(false);
  });
});

describe('projectsStore setDashAccess', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  async function registry() {
    const { sessionRegistry } = await import('../../terminal/SessionRegistry');
    return sessionRegistry as unknown as { restartAgent: ReturnType<typeof vi.fn> };
  }

  it('sets the flag in main and returns the updated task, leaving the reload to the push', async () => {
    const useProjects = await freshStore();
    const updated = task('t1', 'p1', { dashAccess: true });
    api.setTaskDashAccess.mockResolvedValue({ success: true, data: updated });
    const result = await useProjects.getState().setDashAccess(task('t1', 'p1'), true, false);
    expect(api.setTaskDashAccess).toHaveBeenCalledWith({ taskId: 't1', enabled: true });
    expect(result).toEqual(updated);
    expect(api.getTasks).not.toHaveBeenCalled();
  });

  it('restarts the session only when it is running', async () => {
    const useProjects = await freshStore();
    const reg = await registry();
    reg.restartAgent.mockClear();
    api.setTaskDashAccess.mockResolvedValue({ success: true, data: task('t1', 'p1') });
    await useProjects.getState().setDashAccess(task('t1', 'p1'), false, false);
    expect(reg.restartAgent).not.toHaveBeenCalled();
    await useProjects.getState().setDashAccess(task('t1', 'p1'), true, true);
    expect(reg.restartAgent).toHaveBeenCalledWith('t1');
  });

  it('toasts and skips the restart when main refuses', async () => {
    const useProjects = await freshStore();
    const reg = await registry();
    reg.restartAgent.mockClear();
    api.setTaskDashAccess.mockResolvedValue({ success: false, error: 'nope' });
    const result = await useProjects.getState().setDashAccess(task('t1', 'p1'), true, true);
    expect(result).toBeNull();
    expect(reg.restartAgent).not.toHaveBeenCalled();
    const { toast } = await import('sonner');
    expect(toast.error).toHaveBeenCalledWith('nope');
  });
});
