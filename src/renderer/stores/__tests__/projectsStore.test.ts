import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { Project, Task } from '../../../shared/types';

vi.mock('../../terminal/SessionRegistry', () => ({
  sessionRegistry: {
    dispose: vi.fn(),
    disposeByPrefix: vi.fn(),
    restartAllForTask: vi.fn(),
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
        p1: [task('t1', 'p1'), task('t2', 'p1', { archivedAt: 123 })],
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
    expect(useProjects.getState().projects[0].name).toBe('app');
  });

  it('loadTasks stores tasks under the project id', async () => {
    const useProjects = await freshStore();
    api.getTasks.mockResolvedValue({ success: true, data: [task('t1', 'p1')] });
    await useProjects.getState().loadTasks('p1');
    expect(useProjects.getState().tasksByProject.p1.map((t) => t.id)).toEqual(['t1']);
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
        p1: [task('t1', 'p1'), task('t2', 'p1'), task('a1', 'p1', { archivedAt: 9 })],
      },
    });
    useProjects.getState().reorderTasks('p1', [task('t2', 'p1'), task('t1', 'p1')]);
    expect(useProjects.getState().tasksByProject.p1.map((t) => t.id)).toEqual(['t2', 't1', 'a1']);
  });

  it('commitTaskReorder refetches and toasts on failure', async () => {
    const useProjects = await freshStore();
    api.reorderTasks.mockResolvedValue({ success: false, error: 'boom' });
    api.getTasks.mockResolvedValue({ success: true, data: [task('t1', 'p1')] });
    await useProjects.getState().commitTaskReorder('p1', [task('t2', 'p1')]);
    expect(api.getTasks).toHaveBeenCalledWith('p1');
    expect(useProjects.getState().tasksByProject.p1.map((t) => t.id)).toEqual(['t1']);
  });
});

describe('projectsStore archive/restore/close/update', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('archiveTask calls IPC and reloads the owning project', async () => {
    const useProjects = await freshStore();
    useProjects.setState({ tasksByProject: { p1: [task('t1', 'p1')] } });
    api.getTasks.mockResolvedValue({ success: true, data: [task('t1', 'p1', { archivedAt: 5 })] });
    await useProjects.getState().archiveTask('t1');
    expect(api.archiveTask).toHaveBeenCalledWith('t1');
    expect(useProjects.getState().tasksByProject.p1[0].archivedAt).toBe(5);
  });

  it('restoreTask calls IPC and reloads the owning project', async () => {
    const useProjects = await freshStore();
    useProjects.setState({ tasksByProject: { p1: [task('t1', 'p1', { archivedAt: 5 })] } });
    api.getTasks.mockResolvedValue({ success: true, data: [task('t1', 'p1')] });
    await useProjects.getState().restoreTask('t1');
    expect(api.restoreTask).toHaveBeenCalledWith('t1');
  });

  it('closeTask kills pty, clears snapshot, and clears active task if it was active', async () => {
    const useProjects = await freshStore();
    useProjects.getState().setActiveTask('t1');
    useProjects.getState().closeTask('t1');
    expect(api.ptyKill).toHaveBeenCalledWith('t1');
    expect(api.ptyClearSnapshot).toHaveBeenCalledWith('t1');
    expect(useProjects.getState().activeTaskId).toBeNull();
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
