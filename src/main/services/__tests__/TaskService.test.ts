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
    getTasks: (projectId: string) => db.tasks.filter((t) => t.projectId === projectId),
    deleteProject: (id: string) => {
      db.projects = db.projects.filter((p) => p.id !== id);
    },
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
    findActiveNonWorktreeTaskAt: (projectId: string, path: string) =>
      db.tasks.find(
        (t) =>
          t.projectId === projectId && t.path === path && !t.useWorktree && t.archivedAt == null,
      ) ?? null,
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

const initialPrompts: Record<string, string> = {};
const startTaskSession = vi.fn(
  async (_id: string): Promise<{ jobId: string } | { needsTrust: string }> => ({ jobId: 'j1' }),
);
const stopTaskSession = vi.fn(async (_id: string) => {});
const removeTaskSession = vi.fn(async (_id: string) => {});
const ptysForTask = vi.hoisted(() => ({ list: [] as string[], killed: [] as string[] }));
vi.mock('../ptyManager', () => ({
  // Kind by id shape: `shell:<id>…`, `service:<id>:…`, the bare task id is the agent.
  listForTask: (_taskId: string, opts?: { kinds?: string[] }) =>
    ptysForTask.list.filter((id) => opts?.kinds?.some((k) => id.startsWith(`${k}:`))),
  killPtyAwait: async (id: string) => {
    ptysForTask.killed.push(id);
  },
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
const git = vi.hoisted(() => ({
  checkoutBranch: vi.fn(async () => {}),
  updateBranchToRemote: vi.fn(async () => {}),
}));
vi.mock('../GitService', () => ({ GitService: git }));
const liveness = vi.hoisted(() => ({ forgetTask: vi.fn() }));
vi.mock('../PortLivenessService', () => ({ portLivenessService: liveness }));
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
const removeTaskSettings = vi.fn((_id: string) => {});
vi.mock('../taskSettings', () => ({
  removeTaskSettings: (id: string) => removeTaskSettings(id),
}));
vi.mock('../../tui/hostInstance', () => ({
  getTuiHost: () => ({ cancelForTask: async () => {} }),
}));

import { TaskService, UNATTENDED_INSTRUCTION } from '../TaskService';
import { taskEvents } from '../taskEvents';
import { FolderOccupiedError } from '../FolderOccupiedError';

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
  ptysForTask.list = [];
  ptysForTask.killed = [];
  startTaskSession.mockResolvedValue({ jobId: 'j1' });
});

describe('TaskService.create', () => {
  it('creates a new-branch worktree', async () => {
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

  it('submits a one-shot initialPrompt first but persists only the context', async () => {
    const { task } = await TaskService.create(
      newBranchInput({ contextPrompt: 'Use pnpm.', initialPrompt: 'Write the README.' }),
      UI,
    );
    expect(initialPrompts[task.id]).toBe('Use pnpm.\n\nWrite the README.');
    expect(db.contextPrompts[task.id]).toBe('Use pnpm.');
    expect(task.contextPrompt).toBe('Use pnpm.');

    const bare = await TaskService.create(newBranchInput({ initialPrompt: 'Go.' }), UI);
    expect(initialPrompts[bare.task.id]).toBe('Go.');
    expect(db.contextPrompts[bare.task.id]).toBeUndefined();
    expect(bare.task.contextPrompt).toBeNull();
  });

  it('refuses an in-place task in an occupied project folder before any checkout', async () => {
    db.tasks.push({
      id: 'busy',
      projectId: 'p1',
      name: 'Busy',
      path: '/repo/app',
      useWorktree: false,
      archivedAt: null,
    } as Task);
    const refused = TaskService.create(
      {
        kind: 'in-place-checkout',
        projectId: 'p1',
        name: 'other',
        branch: 'feat',
        updateFromRemote: true,
        permissionMode: 'default',
        model: 'default',
      },
      UI,
    );
    await expect(refused).rejects.toThrow(FolderOccupiedError);
    await expect(refused).rejects.toThrow(/"Busy"/); // the dialog's toast
    expect(git.updateBranchToRemote).not.toHaveBeenCalled();
    expect(git.checkoutBranch).not.toHaveBeenCalled();
    expect(db.tasks).toHaveLength(1);
  });

  it('starts the first message of an API task with the unattended instruction, and only then', async () => {
    const API = { startSession: false, source: 'api' } as const;
    const api = await TaskService.create(
      newBranchInput({ contextPrompt: 'Use pnpm.', initialPrompt: 'Go.' }),
      API,
    );
    expect(initialPrompts[api.task.id]).toBe(`${UNATTENDED_INSTRUCTION}\n\nUse pnpm.\n\nGo.`);
    // Context only, as persisted for /clear and /compact.
    expect(db.contextPrompts[api.task.id]).toBe('Use pnpm.');

    const ui = await TaskService.create(newBranchInput({ initialPrompt: 'Go.' }), UI);
    expect(initialPrompts[ui.task.id]).toBe('Go.');

    // No first message, nothing to start it with.
    const bare = await TaskService.create(newBranchInput(), API);
    expect(initialPrompts[bare.task.id]).toBeUndefined();
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
    expect(removeTaskSettings).toHaveBeenCalledWith('del');
    expect(db.tasks).toEqual([]);
    expect(seen).toEqual(['p1']);
  });

  it("kills the task's shell and service terminals before removing the worktree", async () => {
    seedTask();
    ptysForTask.list = ['del', 'shell:del', 'shell:del:2', 'service:del:web'];
    worktree.removeWorktree.mockImplementationOnce(async () => {
      expect(ptysForTask.killed).toEqual(['shell:del', 'shell:del:2', 'service:del:web']);
    });
    await TaskService.delete('del', { deleteWorktreeDir: true });
    expect(worktree.removeWorktree).toHaveBeenCalledOnce();
    expect(ptysForTask.killed).toEqual(['shell:del', 'shell:del:2', 'service:del:web']);
    expect(liveness.forgetTask).toHaveBeenCalledWith('del');
  });

  it('leaves an in-place task directory alone', async () => {
    seedTask({ useWorktree: false, path: '/repo/app' });
    await TaskService.delete('del', { deleteWorktreeDir: true });
    expect(worktree.removeWorktree).not.toHaveBeenCalled();
    expect(db.tasks).toEqual([]);
  });
});

describe('TaskService.deleteProject', () => {
  it('deletes every task the way TaskService.delete does (archived ones too), then the project', async () => {
    const seed = (id: string, over: Partial<Task> = {}) =>
      db.tasks.push({
        id,
        projectId: 'p1',
        name: id,
        branch: `${id}-b`,
        path: `/wt/${id}`,
        useWorktree: true,
        branchCreatedByDash: true,
        teardownScript: null,
        archivedAt: null,
        jobId: `job-${id}`,
        sessionId: null,
        ...over,
      } as Task);
    seed('a');
    seed('b', { archivedAt: 'then' });
    seed('c', { useWorktree: false, path: '/repo/app' });
    db.tasks.push({ id: 'elsewhere', projectId: 'p2' } as Task);

    await TaskService.deleteProject('p1', { deleteWorktreeDir: true, deleteLocalBranch: true });

    expect(removeTaskSession.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c']);
    expect(worktree.removeWorktree).toHaveBeenCalledTimes(2);
    expect(worktree.removeWorktree).toHaveBeenCalledWith('/repo/app', '/wt/a', 'a-b', {
      deleteWorktreeDir: true,
      deleteLocalBranch: true,
      deleteRemoteBranch: false,
      teardownScript: null,
    });
    expect(db.tasks.map((t) => t.id)).toEqual(['elsewhere']);
    expect(db.projects.map((p) => p.id)).not.toContain('p1');
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

  it("ends the task's shell and service terminals, but leaves the agent pane to the session stop", async () => {
    db.tasks.push({ id: 'a', projectId: 'p1', archivedAt: null } as Task);
    ptysForTask.list = ['a', 'shell:a', 'shell:a:2', 'service:a:web'];
    await TaskService.archive('a');
    expect(ptysForTask.killed).toEqual(['shell:a', 'shell:a:2', 'service:a:web']);
    expect(stopTaskSession).toHaveBeenCalledWith('a');
  });
});
