import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CreateTaskInput, Project, Task } from '@shared/types';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

// In-memory stand-in for the SQLite-backed DatabaseService.
const db: { projects: Project[]; tasks: Task[]; contextPrompts: Record<string, string> } = {
  projects: [],
  tasks: [],
  contextPrompts: {},
};
const conversationsFor: string[] = [];
vi.mock('../DatabaseService', () => ({
  DatabaseService: {
    getProjects: () => db.projects,
    getTask: (id: string) => db.tasks.find((t) => t.id === id),
    saveTask: (data: Partial<Task> & { projectId: string; name: string }) => {
      const t = {
        id: `t${db.tasks.length + 1}`,
        status: 'idle',
        jobId: null,
        sessionId: null,
        archivedAt: null,
        ...data,
      } as Task;
      db.tasks.push(t);
      return t;
    },
    setTaskContextPrompt: (id: string, prompt: string) => {
      db.contextPrompts[id] = prompt;
    },
    getOrCreateDefaultConversation: (taskId: string) => {
      conversationsFor.push(taskId);
      return { id: 'c1', taskId };
    },
    deleteTask: (id: string) => {
      db.tasks = db.tasks.filter((t) => t.id !== id);
    },
    archiveTask: (id: string) => {
      db.tasks.find((t) => t.id === id)!.archivedAt = 'now';
    },
    restoreTask: (id: string) => {
      db.tasks.find((t) => t.id === id)!.archivedAt = null;
    },
  },
}));

const worktree = vi.hoisted(() => ({
  createWorktree: vi.fn(async (_p: string, name: string) => ({
    branch: `${name}-new`,
    path: `/wt/${name}-new`,
  })),
  createWorktreeFromExistingBranch: vi.fn(async (_p: string, name: string, branch: string) => ({
    branch,
    path: `/wt/${name}`,
  })),
  removeWorktree: vi.fn(async () => {}),
}));
vi.mock('../WorktreeService', () => ({ worktreeService: worktree }));

const pool = vi.hoisted(() => ({
  claimReserve: vi.fn(async (): Promise<{ branch: string; path: string } | null> => null),
  ensureReserve: vi.fn(async () => {}),
}));
vi.mock('../WorktreePoolService', () => ({ worktreePoolService: pool }));

const initialPrompts: Record<string, string> = {};
const startTaskSession = vi.fn(
  async (_id: string): Promise<{ jobId: string } | { needsTrust: string }> => ({ jobId: 'j1' }),
);
const stopTaskSession = vi.fn(async (_id: string) => {});
const removeTaskSession = vi.fn(async (_id: string) => {});
vi.mock('../ptyManager', () => ({
  setInitialPrompt: (taskId: string, prompt: string) => {
    initialPrompts[taskId] = prompt;
  },
  discardInitialPrompt: vi.fn(),
  startTaskSession: (id: string) => startTaskSession(id),
  stopTaskSession: (id: string) => stopTaskSession(id),
  removeTaskSession: (id: string) => removeTaskSession(id),
}));

let workspaceConfig: { taskDefaults?: { dashAccess?: boolean } } | null = null;
vi.mock('../WorkspaceConfigService', () => ({
  loadWorkspaceConfig: () => workspaceConfig,
}));

vi.mock('../WorkspacePortsRuntime', () => ({ WorkspacePortsRuntime: { setupTask: vi.fn() } }));
vi.mock('../PortsConfigWatcher', () => ({ ensureWatching: vi.fn(), stop: vi.fn() }));
const captured: Array<[string, unknown]> = [];
vi.mock('../TelemetryService', () => ({
  TelemetryService: {
    capture: (event: string, props?: unknown) => captured.push([event, props]),
  },
}));
vi.mock('../GitService', () => ({
  GitService: {
    checkoutBranch: vi.fn(async () => {}),
    updateBranchToRemote: vi.fn(async () => {}),
  },
}));
const githubComments: Array<[number, string]> = [];
vi.mock('../GithubService', () => ({
  GithubService: {
    postBranchComment: async (_cwd: string, num: number, branch: string) => {
      githubComments.push([num, branch]);
    },
  },
}));
vi.mock('../AzureDevOpsService', () => ({
  AzureDevOpsService: { postBranchComment: vi.fn(async () => {}) },
}));
vi.mock('../ConnectionConfigService', () => ({
  ConnectionConfigService: { getAdoConfig: () => null },
}));
vi.mock('../ptyShellConfig', () => ({ removeShellHistory: vi.fn() }));
const removeTaskMcpConfig = vi.fn((_id: string) => {});
vi.mock('../../control/mcpConfig', () => ({
  removeTaskMcpConfig: (id: string) => removeTaskMcpConfig(id),
}));
vi.mock('../../tui/hostInstance', () => ({
  getTuiHost: () => ({ cancelForTask: async () => {} }),
}));

import { TaskService } from '../TaskService';
import { taskEvents } from '../taskEvents';

const UI = { startSession: false, source: 'ui' } as const;

function newBranchInput(over: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    kind: 'worktree-new-branch',
    projectId: 'p1',
    name: 'fix-login',
    baseRef: 'origin/main',
    pushRemote: false,
    permissionMode: 'default',
    model: 'default',
    ...over,
  } as CreateTaskInput;
}

beforeEach(() => {
  db.projects = [{ id: 'p1', name: 'app', path: '/repo/app' } as Project];
  db.tasks = [];
  db.contextPrompts = {};
  conversationsFor.length = 0;
  captured.length = 0;
  githubComments.length = 0;
  for (const k of Object.keys(initialPrompts)) delete initialPrompts[k];
  workspaceConfig = null;
  vi.clearAllMocks();
  pool.claimReserve.mockResolvedValue(null);
  startTaskSession.mockResolvedValue({ jobId: 'j1' });
});

describe('TaskService.create', () => {
  it('uses a claimed reserve worktree', async () => {
    pool.claimReserve.mockResolvedValueOnce({ branch: 'fix-login-r', path: '/wt/reserve' });
    const { task } = await TaskService.create(newBranchInput(), UI);
    expect(task.path).toBe('/wt/reserve');
    expect(task.branch).toBe('fix-login-r');
    expect(worktree.createWorktree).not.toHaveBeenCalled();
  });

  it('falls back to creating a worktree when no reserve can be claimed', async () => {
    const { task, session } = await TaskService.create(newBranchInput(), UI);
    expect(worktree.createWorktree).toHaveBeenCalledOnce();
    expect(task.path).toBe('/wt/fix-login-new');
    expect(task.useWorktree).toBe(true);
    expect(session).toBe('deferred');
    expect(conversationsFor).toEqual([task.id]);
  });

  it('marks only a new branch as created by Dash', async () => {
    const fresh = await TaskService.create(newBranchInput(), UI);
    expect(fresh.task.branchCreatedByDash).toBe(true);

    const existing = await TaskService.create(
      {
        kind: 'worktree-existing',
        projectId: 'p1',
        name: 'review',
        branch: 'feature/x',
        permissionMode: 'default',
        model: 'default',
      },
      UI,
    );
    expect(existing.task.branchCreatedByDash).toBe(false);
    expect(existing.task.branch).toBe('feature/x');

    const inPlace = await TaskService.create(
      {
        kind: 'in-place-no-git',
        projectId: 'p1',
        name: 'plain',
        permissionMode: 'default',
        model: 'default',
      },
      UI,
    );
    expect(inPlace.task.branchCreatedByDash).toBe(false);
    expect(inPlace.task.useWorktree).toBe(false);
    expect(inPlace.task.path).toBe('/repo/app');
  });

  it('resolves dashAccess: explicit, then the project default, then false', async () => {
    workspaceConfig = { taskDefaults: { dashAccess: true } };
    expect(
      (await TaskService.create(newBranchInput({ dashAccess: false }), UI)).task.dashAccess,
    ).toBe(false);
    expect((await TaskService.create(newBranchInput(), UI)).task.dashAccess).toBe(true);
    workspaceConfig = null;
    expect((await TaskService.create(newBranchInput(), UI)).task.dashAccess).toBe(false);
    workspaceConfig = { taskDefaults: { dashAccess: false } };
    expect(
      (await TaskService.create(newBranchInput({ dashAccess: true }), UI)).task.dashAccess,
    ).toBe(true);
  });

  it('stores parentTaskId', async () => {
    const { task } = await TaskService.create(newBranchInput({ parentTaskId: 'parent' }), UI);
    expect(task.parentTaskId).toBe('parent');
    const top = await TaskService.create(newBranchInput(), UI);
    expect(top.task.parentTaskId).toBeNull();
  });

  it('joins the context prompt and linked items into the first prompt', async () => {
    const { task } = await TaskService.create(
      newBranchInput({
        contextPrompt: '  Use pnpm.  ',
        linkedItems: [
          { provider: 'github', id: 42, title: 'Login breaks', url: 'https://x/42', labels: [] },
        ],
      } as Partial<CreateTaskInput>),
      UI,
    );
    const prompt = initialPrompts[task.id]!;
    expect(prompt.startsWith('Use pnpm.\n\n')).toBe(true);
    expect(prompt).toContain('#42');
    expect(db.contextPrompts[task.id]).toBe(prompt);
    // Fire-and-forget branch comment on the linked issue.
    await vi.waitFor(() => expect(githubComments).toEqual([[42, task.branch]]));
  });

  it('sets no prompt when there is neither context nor linked items', async () => {
    const { task } = await TaskService.create(newBranchInput(), UI);
    expect(initialPrompts[task.id]).toBeUndefined();
  });

  it('reports the source in telemetry', async () => {
    await TaskService.create(newBranchInput(), { startSession: false, source: 'api' });
    expect(captured).toContainEqual([
      'task_created',
      { kind: 'worktree-new-branch', source: 'api' },
    ]);
  });

  it('emits tasks-changed for the project', async () => {
    const seen: string[] = [];
    const on = ({ projectId }: { projectId: string }) => seen.push(projectId);
    taskEvents.on('tasks-changed', on);
    try {
      await TaskService.create(newBranchInput(), UI);
    } finally {
      taskEvents.off('tasks-changed', on);
    }
    expect(seen).toEqual(['p1']);
  });

  it('rejects an unknown project', async () => {
    await expect(TaskService.create(newBranchInput({ projectId: 'nope' }), UI)).rejects.toThrow(
      /project/i,
    );
  });

  it('starts the session when asked and maps the result', async () => {
    const api = { startSession: true, source: 'api' } as const;
    const started = await TaskService.create(newBranchInput(), api);
    expect(startTaskSession).toHaveBeenCalledWith(started.task.id);
    expect(started.session).toBe('started');

    startTaskSession.mockResolvedValueOnce({ needsTrust: '/repo/app' });
    const untrusted = await TaskService.create(newBranchInput(), api);
    expect(untrusted.session).toBe('needs-trust');
  });
});

describe('TaskService.delete', () => {
  function seedTask(over: Partial<Task> = {}): Task {
    const t = {
      id: 'del',
      projectId: 'p1',
      name: 'x',
      branch: 'x-abc',
      path: '/wt/x',
      useWorktree: true,
      branchCreatedByDash: false,
      teardownScript: 'make clean',
      archivedAt: null,
      jobId: null,
      sessionId: null,
      ...over,
    } as Task;
    db.tasks.push(t);
    return t;
  }

  it('never deletes a branch Dash did not create', async () => {
    seedTask({ branchCreatedByDash: false });
    await TaskService.delete('del', {
      deleteWorktreeDir: true,
      deleteLocalBranch: true,
      deleteRemoteBranch: true,
    });
    expect(worktree.removeWorktree).toHaveBeenCalledWith('/repo/app', '/wt/x', 'x-abc', {
      deleteWorktreeDir: true,
      deleteLocalBranch: false,
      deleteRemoteBranch: false,
      teardownScript: 'make clean',
    });
  });

  it('treats missing flags as false', async () => {
    seedTask({ branchCreatedByDash: true });
    await TaskService.delete('del', {});
    expect(worktree.removeWorktree).toHaveBeenCalledWith('/repo/app', '/wt/x', 'x-abc', {
      deleteWorktreeDir: false,
      deleteLocalBranch: false,
      deleteRemoteBranch: false,
      teardownScript: 'make clean',
    });
  });

  it('deletes a Dash-created branch when asked, then the row and session', async () => {
    seedTask({ branchCreatedByDash: true });
    const seen: string[] = [];
    const on = ({ projectId }: { projectId: string }) => seen.push(projectId);
    taskEvents.on('tasks-changed', on);
    try {
      await TaskService.delete('del', {
        deleteWorktreeDir: true,
        deleteLocalBranch: true,
        deleteRemoteBranch: false,
      });
    } finally {
      taskEvents.off('tasks-changed', on);
    }
    expect(worktree.removeWorktree).toHaveBeenCalledWith(
      '/repo/app',
      '/wt/x',
      'x-abc',
      expect.objectContaining({ deleteLocalBranch: true, deleteRemoteBranch: false }),
    );
    expect(removeTaskSession).toHaveBeenCalledWith('del');
    expect(removeTaskMcpConfig).toHaveBeenCalledWith('del');
    expect(db.tasks).toEqual([]);
    expect(seen).toEqual(['p1']);
  });

  it('leaves an in-place task directory alone', async () => {
    seedTask({ useWorktree: false, path: '/repo/app' });
    await TaskService.delete('del', { deleteWorktreeDir: true });
    expect(worktree.removeWorktree).not.toHaveBeenCalled();
    expect(db.tasks).toEqual([]);
  });
});

describe('TaskService.archive / restore', () => {
  it('stops the session, archives, and emits; restore clears it', async () => {
    db.tasks.push({ id: 'a', projectId: 'p1', archivedAt: null } as Task);
    const seen: string[] = [];
    const on = ({ projectId }: { projectId: string }) => seen.push(projectId);
    taskEvents.on('tasks-changed', on);
    try {
      await TaskService.archive('a');
      expect(stopTaskSession).toHaveBeenCalledWith('a');
      expect(db.tasks[0]!.archivedAt).toBe('now');
      await TaskService.restore('a');
      expect(db.tasks[0]!.archivedAt).toBeNull();
    } finally {
      taskEvents.off('tasks-changed', on);
    }
    expect(seen).toEqual(['p1', 'p1']);
  });
});
