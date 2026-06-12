import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeElectronApiMock, installWindow, resetWindow } from './helpers/electronApiMock';
import type { Project, Task, GitStatus } from '../../../shared/types';

// gitStore imports projectsStore (for the active task) → renderer-only modules that don't load
// under the node env. Stub them exactly like the other store tests.
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
    branch: 'feature',
    path: `/wt/${id}`,
    useWorktree: true,
    archivedAt: null,
    ...over,
  }) as Task;
const status = (over: Partial<GitStatus> = {}): GitStatus => ({
  branch: 'feature',
  hasUpstream: true,
  ahead: 0,
  behind: 0,
  files: [],
  ...over,
});

async function freshStores() {
  vi.resetModules();
  const git = await import('../gitStore');
  const projects = await import('../projectsStore');
  return { useGit: git.useGit, useProjects: projects.useProjects };
}

function seedActiveTask(
  useProjects: { setState: (partial: Record<string, unknown>) => void },
  t: Task,
) {
  useProjects.setState({
    tasksByProject: { [t.projectId]: [t] },
    activeProjectId: t.projectId,
    activeTaskId: t.id,
  });
}

describe('gitStore.refreshGitStatus', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('loads status from gitGetStatus and toggles gitLoading', async () => {
    const st = status({ branch: 'feature', ahead: 2 });
    api.gitGetStatus = vi.fn(() => Promise.resolve({ success: true, data: st }));
    const { useGit } = await freshStores();

    await useGit.getState().refreshGitStatus('/wt/t1');

    expect(api.gitGetStatus).toHaveBeenCalledWith('/wt/t1');
    expect(useGit.getState().gitStatus).toEqual(st);
    expect(useGit.getState().gitLoading).toBe(false);
  });

  it('leaves prior status intact and resets loading when the call throws', async () => {
    api.gitGetStatus = vi.fn(() => Promise.reject(new Error('boom')));
    const { useGit } = await freshStores();
    await useGit.getState().refreshGitStatus('/wt/t1');
    expect(useGit.getState().gitStatus).toBeNull();
    expect(useGit.getState().gitLoading).toBe(false);
  });
});

describe('gitStore setters', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('setShowCommitGraph accepts a functional updater', async () => {
    const { useGit } = await freshStores();
    useGit.getState().setShowCommitGraph((v) => !v);
    expect(useGit.getState().showCommitGraph).toBe(true);
    useGit.getState().setShowCommitGraph(false);
    expect(useGit.getState().showCommitGraph).toBe(false);
  });

  it('setDiffFile stores the full target', async () => {
    const { useGit } = await freshStores();
    const target = { cwd: '/wt/t1', filePath: 'a.ts', staged: false };
    useGit.getState().setDiffFile(target);
    expect(useGit.getState().diffFile).toEqual(target);
    useGit.getState().setDiffFile(null);
    expect(useGit.getState().diffFile).toBeNull();
  });
});

describe('gitStore git operations (resolve the active task, then refresh)', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => resetWindow());

  it('stageAll stages the active task path and refreshes', async () => {
    api.gitStageAll = vi.fn(() => Promise.resolve({ success: true }));
    api.gitGetStatus = vi.fn(() => Promise.resolve({ success: true, data: status() }));
    const { useGit, useProjects } = await freshStores();
    seedActiveTask(useProjects, task('t1', 'p1'));

    await useGit.getState().stageAll();

    expect(api.gitStageAll).toHaveBeenCalledWith('/wt/t1');
    expect(api.gitGetStatus).toHaveBeenCalledWith('/wt/t1');
  });

  it('stageFiles / unstageFiles / discardFiles pass cwd + filePaths', async () => {
    api.gitStageFiles = vi.fn(() => Promise.resolve({ success: true }));
    api.gitUnstageFiles = vi.fn(() => Promise.resolve({ success: true }));
    api.gitDiscardFiles = vi.fn(() => Promise.resolve({ success: true }));
    api.gitGetStatus = vi.fn(() => Promise.resolve({ success: true, data: status() }));
    const { useGit, useProjects } = await freshStores();
    seedActiveTask(useProjects, task('t1', 'p1'));

    await useGit.getState().stageFiles(['a.ts']);
    await useGit.getState().unstageFiles(['b.ts']);
    await useGit.getState().discardFiles(['c.ts']);

    expect(api.gitStageFiles).toHaveBeenCalledWith({ cwd: '/wt/t1', filePaths: ['a.ts'] });
    expect(api.gitUnstageFiles).toHaveBeenCalledWith({ cwd: '/wt/t1', filePaths: ['b.ts'] });
    expect(api.gitDiscardFiles).toHaveBeenCalledWith({ cwd: '/wt/t1', filePaths: ['c.ts'] });
  });

  it('no-ops when there is no active task', async () => {
    api.gitStageAll = vi.fn();
    const { useGit } = await freshStores();
    await useGit.getState().stageAll();
    expect(api.gitStageAll).not.toHaveBeenCalled();
  });

  it('commit throws on failure and refreshes on success', async () => {
    api.gitCommit = vi.fn(() => Promise.resolve({ success: false, error: 'nope' }));
    api.gitGetStatus = vi.fn(() => Promise.resolve({ success: true, data: status() }));
    const { useGit, useProjects } = await freshStores();
    seedActiveTask(useProjects, task('t1', 'p1'));

    await expect(useGit.getState().commit('msg')).rejects.toThrow('nope');

    api.gitCommit = vi.fn(() => Promise.resolve({ success: true }));
    await useGit.getState().commit('msg', { allowEmpty: true });
    expect(api.gitCommit).toHaveBeenCalledWith({
      cwd: '/wt/t1',
      message: 'msg',
      allowEmpty: true,
    });
    expect(api.gitGetStatus).toHaveBeenCalled();
  });

  it('push throws on failure', async () => {
    api.gitPush = vi.fn(() => Promise.resolve({ success: false, error: 'rejected' }));
    const { useGit, useProjects } = await freshStores();
    seedActiveTask(useProjects, task('t1', 'p1'));
    await expect(useGit.getState().push()).rejects.toThrow('rejected');
  });
});

describe('gitStore.watchActiveTask', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  let onGitFileChangedCb: ((id: string) => void) | null;
  beforeEach(() => {
    vi.useFakeTimers();
    onGitFileChangedCb = null;
    api = makeElectronApiMock();
    api.gitGetStatus = vi.fn(() => Promise.resolve({ success: true, data: status() }));
    api.gitWatch = vi.fn(() => Promise.resolve({ success: true }));
    api.gitUnwatch = vi.fn(() => Promise.resolve({ success: true }));
    api.onGitFileChanged = vi.fn((cb: (id: string) => void) => {
      onGitFileChangedCb = cb;
      return vi.fn();
    });
    installWindow(api);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetWindow();
  });

  it('watches the task dir, refreshes immediately, and polls on the interval', async () => {
    const { useGit } = await freshStores();
    useGit.getState().watchActiveTask(task('t1', 'p1'));

    expect(api.gitWatch).toHaveBeenCalledWith({ id: 't1', cwd: '/wt/t1' });
    expect(api.gitGetStatus).toHaveBeenCalledTimes(1); // immediate refresh

    vi.advanceTimersByTime(5000);
    expect(api.gitGetStatus).toHaveBeenCalledTimes(2); // one poll tick
  });

  it('refreshes when the watched task reports a file change', async () => {
    const { useGit } = await freshStores();
    useGit.getState().watchActiveTask(task('t1', 'p1'));
    api.gitGetStatus.mockClear();

    onGitFileChangedCb?.('other'); // different task → ignored
    expect(api.gitGetStatus).not.toHaveBeenCalled();
    onGitFileChangedCb?.('t1'); // matching task → refresh
    expect(api.gitGetStatus).toHaveBeenCalledTimes(1);
  });

  it('null task clears status and stops watching the previous task', async () => {
    const { useGit } = await freshStores();
    useGit.getState().watchActiveTask(task('t1', 'p1'));
    useGit.getState().watchActiveTask(null);

    expect(api.gitUnwatch).toHaveBeenCalledWith('t1');
    expect(useGit.getState().gitStatus).toBeNull();
    api.gitGetStatus.mockClear();
    vi.advanceTimersByTime(5000);
    expect(api.gitGetStatus).not.toHaveBeenCalled(); // poll stopped
  });

  it('stopWatch tears the watcher down', async () => {
    const { useGit } = await freshStores();
    useGit.getState().watchActiveTask(task('t1', 'p1'));
    useGit.getState().stopWatch();
    expect(api.gitUnwatch).toHaveBeenCalledWith('t1');
  });
});

describe('gitStore.detectPr', () => {
  let api: ReturnType<typeof makeElectronApiMock>;
  beforeEach(() => {
    vi.useFakeTimers();
    api = makeElectronApiMock();
    installWindow(api);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetWindow();
  });

  it('skips and clears prInfo when on the default branch', async () => {
    api.githubGetPrForBranch = vi.fn();
    const { useGit } = await freshStores();
    useGit.getState().detectPr(proj('p1', { gitBranch: 'main' }), task('t1', 'p1'), 'main');
    expect(api.githubGetPrForBranch).not.toHaveBeenCalled();
    expect(useGit.getState().prInfo).toBeNull();
  });

  it('fetches a GitHub PR for a non-default branch', async () => {
    const pr = { number: 7, title: 'PR', url: 'u', state: 'open', provider: 'github' };
    api.githubGetPrForBranch = vi.fn(() => Promise.resolve({ success: true, data: pr }));
    const { useGit } = await freshStores();
    useGit.getState().detectPr(proj('p1', { gitBranch: 'main' }), task('t1', 'p1'), 'feature');
    await vi.runOnlyPendingTimersAsync();
    expect(api.githubGetPrForBranch).toHaveBeenCalledWith('/wt/t1', 'feature');
    expect(useGit.getState().prInfo).toEqual(pr);
  });

  it('uses the ADO endpoint for an Azure DevOps remote', async () => {
    const remote = 'https://dev.azure.com/org/proj/_git/repo';
    const pr = { number: 9, title: 'ADO', url: 'u', state: 'open', provider: 'ado' };
    api.adoGetPrForBranch = vi.fn(() => Promise.resolve({ success: true, data: pr }));
    const { useGit } = await freshStores();
    useGit
      .getState()
      .detectPr(proj('p1', { gitBranch: 'main', gitRemote: remote }), task('t1', 'p1'), 'feature');
    await vi.runOnlyPendingTimersAsync();
    expect(api.adoGetPrForBranch).toHaveBeenCalledWith('feature', remote, 'p1');
    expect(useGit.getState().prInfo).toEqual(pr);
  });
});
