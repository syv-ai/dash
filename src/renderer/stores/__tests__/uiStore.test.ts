import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { Project, Task } from '../../../shared/types';

// uiStore imports projectsStore, which statically imports these renderer-only modules
// that won't load under the node test env — stub them just like projectsStore.test.ts.
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

// Re-import after mocks/window so the modules read the stubbed window at first use.
async function freshStores() {
  vi.resetModules();
  const { useUi } = await import('../uiStore');
  const { useProjects } = await import('../projectsStore');
  return { useUi, useProjects };
}

describe('uiStore setters', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('plain setters update their field', async () => {
    const { useUi } = await freshStores();
    useUi.getState().setShowTaskModal(true);
    expect(useUi.getState().showTaskModal).toBe(true);

    const t = task('t1', 'p1');
    useUi.getState().setDeleteTaskTarget(t);
    expect(useUi.getState().deleteTaskTarget).toBe(t);

    useUi.getState().setRemoteControlModalPtyId('pty-9');
    expect(useUi.getState().remoteControlModalPtyId).toBe('pty-9');
  });

  it('setShowSettings accepts a functional updater', async () => {
    const { useUi } = await freshStores();
    expect(useUi.getState().showSettings).toBe(false);
    useUi.getState().setShowSettings((v) => !v);
    expect(useUi.getState().showSettings).toBe(true);
    useUi.getState().setShowSettings((v) => !v);
    expect(useUi.getState().showSettings).toBe(false);
  });

  it('setProjectSettingsTarget accepts a functional updater', async () => {
    const { useUi } = await freshStores();
    const p = proj('p1');
    useUi.getState().setProjectSettingsTarget(p);
    useUi
      .getState()
      .setProjectSettingsTarget((prev) =>
        prev?.id === 'p1' ? proj('p1', { name: 'renamed' }) : prev,
      );
    expect(useUi.getState().projectSettingsTarget?.name).toBe('renamed');
  });

  it('setTaskSettingsTarget accepts a functional updater', async () => {
    const { useUi } = await freshStores();
    const t = task('t1', 'p1');
    useUi.getState().setTaskSettingsTarget(t);
    useUi
      .getState()
      .setTaskSettingsTarget((prev) =>
        prev?.id === 't1' ? task('t1', 'p1', { name: 'renamed' }) : prev,
      );
    expect(useUi.getState().taskSettingsTarget?.name).toBe('renamed');
  });
});

describe('uiStore.finishProjectCreation', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('loads projects, activates the new one, flags it for scroll, and closes the modal', async () => {
    const saved = proj('newid', { name: 'new', path: '/p/new' });
    api.getProjects = vi.fn(() => Promise.resolve({ success: true, data: [saved] }));

    const { useUi, useProjects } = await freshStores();
    useUi.getState().setShowAddProjectModal(true);
    await useUi.getState().finishProjectCreation('newid');

    expect(useProjects.getState().activeProjectId).toBe('newid');
    expect(useProjects.getState().activeTaskId).toBeNull();
    expect(useProjects.getState().justCreatedProjectId).toBe('newid');
    expect(useUi.getState().showAddProjectModal).toBe(false);
    expect(useUi.getState().adoSetup).toBeNull();
  });

  it('prompts ADO setup when the new project has an Azure DevOps remote', async () => {
    const remote = 'https://dev.azure.com/org/proj/_git/repo';
    const saved = proj('adoid', { name: 'repo', path: '/p/repo', gitRemote: remote });
    api.getProjects = vi.fn(() => Promise.resolve({ success: true, data: [saved] }));

    const { useUi } = await freshStores();
    await useUi.getState().finishProjectCreation('adoid');

    expect(useUi.getState().adoSetup).toEqual({
      projectId: 'adoid',
      organizationUrl: 'https://dev.azure.com/org',
      project: 'proj',
    });
  });
});

describe('uiStore delete confirmations', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('confirmDeleteProject delegates to projectsStore and clears the target', async () => {
    const { useUi, useProjects } = await freshStores();
    const deleteProject = vi.fn(() => Promise.resolve());
    useProjects.setState({ deleteProject });
    const p = proj('p1');
    useUi.getState().setDeleteProjectTarget(p);

    const options = { deleteWorktrees: true } as never;
    await useUi.getState().confirmDeleteProject(options);

    expect(deleteProject).toHaveBeenCalledWith(p, options);
    expect(useUi.getState().deleteProjectTarget).toBeNull();
  });

  it('confirmDeleteProject is a no-op with no target', async () => {
    const { useUi, useProjects } = await freshStores();
    const deleteProject = vi.fn(() => Promise.resolve());
    useProjects.setState({ deleteProject });
    await useUi.getState().confirmDeleteProject({} as never);
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('confirmDeleteTask delegates to projectsStore and clears the target', async () => {
    const { useUi, useProjects } = await freshStores();
    const deleteTask = vi.fn(() => Promise.resolve());
    useProjects.setState({ deleteTask });
    const t = task('t1', 'p1');
    useUi.getState().setDeleteTaskTarget(t);

    const options = {
      deleteWorktreeDir: true,
      deleteLocalBranch: false,
      deleteRemoteBranch: false,
    };
    await useUi.getState().confirmDeleteTask(options);

    expect(deleteTask).toHaveBeenCalledWith(t, options);
    expect(useUi.getState().deleteTaskTarget).toBeNull();
  });

  it('confirmDeleteTask clears the target even if the delete throws', async () => {
    const { useUi, useProjects } = await freshStores();
    const deleteTask = vi.fn(() => Promise.reject(new Error('boom')));
    useProjects.setState({ deleteTask });
    useUi.getState().setDeleteTaskTarget(task('t1', 'p1'));

    await expect(useUi.getState().confirmDeleteTask()).rejects.toThrow('boom');
    expect(useUi.getState().deleteTaskTarget).toBeNull();
  });
});
