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
