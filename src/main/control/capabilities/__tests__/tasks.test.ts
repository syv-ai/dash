import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { ActivityInfo, CreateTaskInput, Task } from '../../../../shared/types';
import { ControlError, createRegistry, type Registry } from '../../registry';
import { fakeLookups, makeProject, makeTask } from '../../__tests__/fixtures';
import { registerProjectCapabilities } from '../projects';
import type { LiveSession } from '../../../services/claudeSessionRegistry';
import { registerTaskCapabilities, toTaskView, type TaskCapabilityDeps } from '../tasks';
import { FolderOccupiedError } from '../../../services/FolderOccupiedError';

const orch = { kind: 'orchestrator' } as const;
const asTask = (taskId: string) => ({ kind: 'task', taskId }) as const;

let projects = [
  makeProject({ id: 'pA', baseRef: 'origin/main' }),
  makeProject({ id: 'pB' }),
  makeProject({ id: 'pArch', archivedAt: '2026-01-02T00:00:00.000Z' }),
];
let tasks: Task[];
let activity: Record<string, ActivityInfo>;
let untrusted: Record<string, string>;
let sessions: Map<string, LiveSession>;
let listeners: Array<() => void>;
/** The fakes, typed loosely so each test can swap an implementation. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let deps: Record<keyof TaskCapabilityDeps, Mock<(...args: any[]) => any>>;
let registry: Registry;

function emitActivity(next: Record<string, ActivityInfo>): void {
  activity = next;
  for (const l of [...listeners]) l();
}

beforeEach(() => {
  projects = [
    makeProject({ id: 'pA', baseRef: 'origin/main' }),
    makeProject({ id: 'pB' }),
    makeProject({ id: 'pNoGit', isGitRepo: false }),
    makeProject({ id: 'pArch', archivedAt: '2026-01-02T00:00:00.000Z' }),
  ];
  tasks = [
    makeTask({ id: 'me', projectId: 'pA', dashAccess: true, name: 'Me' }),
    makeTask({ id: 'child', projectId: 'pA', parentTaskId: 'me', name: 'Child' }),
    makeTask({ id: 'sibling', projectId: 'pA', name: 'Sibling' }),
    makeTask({ id: 'old', projectId: 'pA', archivedAt: '2026-01-03T00:00:00.000Z' }),
    makeTask({ id: 'other', projectId: 'pB' }),
    makeTask({ id: 'hidden', projectId: 'pArch' }),
  ];
  activity = {};
  untrusted = {};
  sessions = new Map();
  listeners = [];
  deps = {
    getProjects: vi.fn(() => projects),
    getTask: vi.fn((id: string) => tasks.find((t) => t.id === id)),
    getTasks: vi.fn((projectId: string) => tasks.filter((t) => t.projectId === projectId)),
    getActivity: vi.fn(() => activity),
    getUntrustedRoot: vi.fn((id: string) => untrusted[id]),
    getLiveSessions: vi.fn(() => sessions),
    onActivityChange: vi.fn((l: () => void) => {
      listeners.push(l);
      return () => {
        listeners = listeners.filter((x) => x !== l);
      };
    }),
    taskDefaults: vi.fn(() => undefined),
    claudeDefaultPermissionMode: vi.fn(() => undefined),
    resolveBaseRef: vi.fn(async () => 'main'),
    currentBranch: vi.fn(async (): Promise<string | null> => 'live-head'),
    branchExists: vi.fn(async () => true),
    recheckTrust: vi.fn(async (id: string) => !untrusted[id]),
    createTask: vi.fn(async (input: CreateTaskInput) => {
      const task = makeTask({
        id: 'new',
        projectId: input.projectId,
        name: input.name,
        parentTaskId: input.parentTaskId ?? null,
      });
      tasks.push(task);
      return { task, session: 'started' as const };
    }),
    archiveTask: vi.fn(async () => {}),
    restoreTask: vi.fn(async () => {}),
    deleteTask: vi.fn(async () => {}),
    restartSession: vi.fn(async () => ({ jobId: 'job-1' })),
    startSession: vi.fn(async () => ({ jobId: 'job-1' })),
    readLogs: vi.fn(async () => ''),
    openTask: vi.fn(),
  } as never;
  registry = createRegistry(fakeLookups(projects, tasks));
  registerProjectCapabilities(registry, deps as never);
  registerTaskCapabilities(registry, deps as never);
});

afterEach(() => {
  vi.useRealTimers();
});

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    if (err instanceof ControlError) return err.status;
    throw err;
  }
}

const live = (socket: string | null = '/tmp/cc-socks/7.sock'): LiveSession => ({
  pid: 7,
  sessionId: 'sess-1',
  name: 't',
  messagingSocketPath: socket,
  status: 'idle',
});

describe('toTaskView', () => {
  const t = makeTask({ id: 't', projectId: 'p' });
  const view = (info: ActivityInfo | undefined, root?: string) =>
    toTaskView(t, info ? { t: info } : {}, () => root, new Map());

  it.each([
    ['busy', 'working'],
    ['idle', 'idle'],
    ['waiting', 'waiting'],
    ['error', 'error'],
    ['stopped', 'stopped'],
  ] as const)('maps activity %s to %s', (state, expected) => {
    expect(view({ state }).state).toBe(expected);
  });

  it('reads a task with no activity as stopped', () => {
    expect(view(undefined).state).toBe('stopped');
  });

  it('reads a task waiting on the trust prompt as needs-trust, whatever the activity', () => {
    const v = view({ state: 'idle' }, '/repo');
    expect(v.state).toBe('needs-trust');
    expect(v.detail).toMatch(/trust/);
  });

  it('carries the monitor detail', () => {
    expect(view({ state: 'waiting', detail: 'permission: Bash' }).detail).toBe('permission: Bash');
  });

  it("gives a live session's socket as its message address, else null", () => {
    const withJob = makeTask({ id: 't', projectId: 'p', jobId: 'job-t' });
    const at = (s: Map<string, LiveSession>, task: Task = withJob) =>
      toTaskView(task, {}, () => undefined, s).messageAddress;
    expect(at(new Map([['job-t', live()]]))).toBe('uds:/tmp/cc-socks/7.sock');
    expect(at(new Map([['job-t', live(null)]]))).toBeNull();
    expect(at(new Map([['job-other', live()]]))).toBeNull();
    expect(at(new Map([['job-t', live()]]), t)).toBeNull(); // no job
  });

  it('reads a live session the monitor still calls stopped as idle, or working when it is busy', () => {
    const withJob = makeTask({ id: 't', projectId: 'p', jobId: 'job-t' });
    const state = (info: ActivityInfo | undefined, s: LiveSession) =>
      toTaskView(withJob, info ? { t: info } : {}, () => undefined, new Map([['job-t', s]])).state;
    expect(state({ state: 'stopped' }, live())).toBe('idle');
    expect(state(undefined, live())).toBe('idle');
    expect(state({ state: 'stopped' }, { ...live(), status: 'busy' })).toBe('working');
    expect(state({ state: 'stopped' }, live(null))).toBe('stopped'); // no socket: not reachable
    expect(state({ state: 'waiting' }, live())).toBe('waiting'); // the monitor wins otherwise
  });

  it('marks a bypassPermissions task as needing approval for messages', () => {
    const mode = (permissionMode: Task['permissionMode']) =>
      toTaskView(
        makeTask({ id: 't', projectId: 'p', permissionMode }),
        {},
        () => undefined,
        new Map(),
      ).messaging;
    expect(mode('bypassPermissions')).toBe('needs-approval');
    expect(mode('default')).toBe('direct');
    expect(mode('acceptEdits')).toBe('direct');
  });
});

describe('projects.list', () => {
  it('lists visible projects with their task defaults', async () => {
    deps.taskDefaults.mockImplementation((path: string) =>
      path === '/repos/pB' ? { baseRef: 'origin/dev', dashAccess: true } : undefined,
    );
    const result = (await registry.call(orch, 'projects.list', {})) as Array<{
      id: string;
      defaultBaseRef: string | null;
      dashAccessDefault: boolean;
    }>;
    expect(result.map((p) => p.id)).toEqual(['pA', 'pB', 'pNoGit']);
    expect(result[0]).toMatchObject({ defaultBaseRef: 'origin/main', dashAccessDefault: false });
    expect(result[1]).toMatchObject({ defaultBaseRef: 'origin/dev', dashAccessDefault: true });
  });
});

describe('tasks.list', () => {
  it('gives a task caller only itself and its children', async () => {
    const result = (await registry.call(asTask('me'), 'tasks.list', {})) as Array<{ id: string }>;
    expect(result.map((t) => t.id).sort()).toEqual(['child', 'me']);
  });

  it('gives the orchestrator every visible, non-archived task', async () => {
    const result = (await registry.call(orch, 'tasks.list', {})) as Array<{ id: string }>;
    expect(result.map((t) => t.id).sort()).toEqual(['child', 'me', 'other', 'sibling']);
  });

  it('filters by project and includes archived tasks on request', async () => {
    const result = (await registry.call(orch, 'tasks.list', {
      projectId: 'pA',
      includeArchived: true,
    })) as Array<{ id: string; archived: boolean }>;
    expect(result.map((t) => t.id).sort()).toEqual(['child', 'me', 'old', 'sibling']);
    expect(result.find((t) => t.id === 'old')!.archived).toBe(true);
  });

  it('404s a project outside the scope', async () => {
    expect(await status(registry.call(orch, 'tasks.list', { projectId: 'pArch' }))).toBe(404);
    expect(await status(registry.call(asTask('me'), 'tasks.list', { projectId: 'pB' }))).toBe(404);
  });
});

describe('tasks.wait', () => {
  it('returns at once when the task already matches', async () => {
    activity = { child: { state: 'idle' } };
    const result = await registry.call(orch, 'tasks.wait', { taskId: 'child', until: 'idle' });
    expect(result).toMatchObject({ timedOut: false, task: { id: 'child', state: 'idle' } });
    expect(listeners).toHaveLength(0);
  });

  it('resolves on an activity change that matches', async () => {
    activity = { child: { state: 'busy' } };
    const pending = registry.call(orch, 'tasks.wait', { taskId: 'child', until: 'not-working' });
    await vi.waitFor(() => expect(listeners).toHaveLength(1));
    emitActivity({ child: { state: 'busy' } });
    emitActivity({ child: { state: 'waiting', detail: 'permission: Bash' } });
    await expect(pending).resolves.toMatchObject({
      timedOut: false,
      task: { state: 'waiting', detail: 'permission: Bash' },
    });
    expect(listeners).toHaveLength(0);
  });

  it('until change resolves on the first state change', async () => {
    activity = { child: { state: 'idle' } };
    const pending = registry.call(orch, 'tasks.wait', { taskId: 'child', until: 'change' });
    await vi.waitFor(() => expect(listeners).toHaveLength(1));
    emitActivity({ child: { state: 'busy' } });
    await expect(pending).resolves.toMatchObject({ timedOut: false, task: { state: 'working' } });
  });

  it('times out with timedOut: true', async () => {
    vi.useFakeTimers();
    activity = { child: { state: 'busy' } };
    const pending = registry.call(orch, 'tasks.wait', {
      taskId: 'child',
      until: 'idle',
      timeoutSec: 5,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toMatchObject({ timedOut: true, task: { state: 'working' } });
    expect(listeners).toHaveLength(0);
  });

  it('caps the timeout at 110 s', async () => {
    expect(
      await status(
        registry.call(orch, 'tasks.wait', { taskId: 'child', until: 'idle', timeoutSec: 111 }),
      ),
    ).toBe(400);
  });
});

describe('tasks.create', () => {
  it('from a task caller sets parentTaskId and maps new-branch onto a worktree', async () => {
    const result = await registry.call(asTask('me'), 'tasks.create', {
      projectId: 'pA',
      name: 'Write README',
      prompt: 'write a README',
    });
    expect(deps.createTask).toHaveBeenCalledWith(
      {
        projectId: 'pA',
        name: 'Write README',
        kind: 'worktree-new-branch',
        baseRef: 'origin/main',
        pushRemote: false,
        permissionMode: 'default',
        model: 'default',
        initialPrompt: 'write a README',
        contextPrompt: undefined,
        dashAccess: undefined,
        parentTaskId: 'me',
      },
      { startSession: true, source: 'api' },
    );
    expect(result).toMatchObject({ session: 'started', task: { id: 'new', parentTaskId: 'me' } });
  });

  it("sends the project's context prompt as context and the API prompt as a one-shot", async () => {
    deps.taskDefaults.mockReturnValue({ contextPrompt: 'Use pnpm.' });
    await registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'x', prompt: 'go' });
    expect(deps.createTask.mock.calls[0]![0]).toMatchObject({
      contextPrompt: 'Use pnpm.',
      initialPrompt: 'go',
    });
  });

  it('refuses a task caller creating in another project', async () => {
    expect(
      await status(registry.call(asTask('me'), 'tasks.create', { projectId: 'pB', name: 'x' })),
    ).toBe(404);
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it('rejects bypassPermissions in the schema', async () => {
    expect(
      await status(
        registry.call(orch, 'tasks.create', {
          projectId: 'pA',
          name: 'x',
          permissionMode: 'bypassPermissions',
        }),
      ),
    ).toBe(400);
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it('never inherits a bypassPermissions project default', async () => {
    deps.taskDefaults.mockReturnValue({ permissionMode: 'bypassPermissions' });
    await registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'x' });
    expect(deps.createTask.mock.calls[0]![0]).toMatchObject({ permissionMode: 'default' });
  });

  it('starts a task in auto mode when asked', async () => {
    await registry.call(orch, 'tasks.create', {
      projectId: 'pA',
      name: 'x',
      permissionMode: 'auto',
    });
    expect(deps.createTask.mock.calls[0]![0]).toMatchObject({ permissionMode: 'auto' });
  });

  it("inherits the project's auto default", async () => {
    deps.taskDefaults.mockReturnValue({ permissionMode: 'auto' });
    await registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'x' });
    expect(deps.createTask.mock.calls[0]![0]).toMatchObject({ permissionMode: 'auto' });
  });

  it("falls back to Claude Code's defaultMode, never its bypassPermissions", async () => {
    deps.claudeDefaultPermissionMode.mockReturnValueOnce('auto');
    await registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'x' });
    deps.claudeDefaultPermissionMode.mockReturnValueOnce('bypassPermissions');
    await registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'y' });
    expect(deps.claudeDefaultPermissionMode).toHaveBeenCalledWith('/repos/pA');
    expect(deps.createTask.mock.calls.map((c) => c[0].permissionMode)).toEqual(['auto', 'default']);
  });

  it('orchestrator-created tasks have no parent', async () => {
    await registry.call(orch, 'tasks.create', { projectId: 'pB', name: 'x' });
    expect(deps.createTask.mock.calls[0]![0]).toMatchObject({
      parentTaskId: null,
      baseRef: 'main', // no defaults anywhere → git's choice
    });
  });

  it('maps existing-branch and in-place, and in-place on a non-git project', async () => {
    await registry.call(orch, 'tasks.create', {
      projectId: 'pA',
      name: 'a',
      kind: 'existing-branch',
      branch: 'feat/x',
    });
    await registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'b', kind: 'in-place' });
    await registry.call(orch, 'tasks.create', { projectId: 'pNoGit', name: 'c' });
    const inputs = deps.createTask.mock.calls.map((c) => c[0]);
    expect(inputs[0]).toMatchObject({ kind: 'worktree-existing', branch: 'feat/x' });
    // In place with no branch stays on the project's live HEAD.
    expect(deps.currentBranch).toHaveBeenCalledWith('/repos/pA');
    expect(inputs[1]).toMatchObject({ kind: 'in-place-checkout', branch: 'live-head' });
    expect(inputs[2]).toMatchObject({ kind: 'in-place-no-git' });
  });

  it('400s existing-branch without a branch, and a worktree on a non-git project', async () => {
    expect(
      await status(
        registry.call(orch, 'tasks.create', {
          projectId: 'pA',
          name: 'a',
          kind: 'existing-branch',
        }),
      ),
    ).toBe(400);
    expect(
      await status(
        registry.call(orch, 'tasks.create', { projectId: 'pNoGit', name: 'a', kind: 'new-branch' }),
      ),
    ).toBe(400);
  });
});

describe('an occupied in-place folder', () => {
  const occupied = () =>
    Promise.reject(new FolderOccupiedError('active task "Busy" already uses this folder'));

  it('refuses tasks.create with 409', async () => {
    deps.createTask.mockImplementation(occupied);
    await expect(
      registry.call(orch, 'tasks.create', { projectId: 'pNoGit', name: 'x' }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('"Busy"') });
  });

  it('refuses tasks.restore with 409', async () => {
    deps.restoreTask.mockImplementation(occupied);
    expect(await status(registry.call(orch, 'tasks.restore', { taskId: 'old' }))).toBe(409);
  });
});

describe('tasks.create branch checks', () => {
  const create = (input: Record<string, unknown>) =>
    status(registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'x', ...input }));

  it('400s in place on a detached HEAD without a branch', async () => {
    deps.currentBranch.mockResolvedValue(null);
    expect(await create({ kind: 'in-place' })).toBe(400);
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it.each(['.', '-f', '--orphan=x', '../x', '/abs', 'a..b', 'HEAD~1', 'a b', 'x.lock'])(
    'rejects the branch %j in the schema',
    async (branch) => {
      expect(await create({ kind: 'in-place', branch })).toBe(400);
      expect(await create({ kind: 'existing-branch', branch })).toBe(400);
      expect(deps.branchExists).not.toHaveBeenCalled();
      expect(deps.createTask).not.toHaveBeenCalled();
    },
  );

  it('400s a branch git does not know', async () => {
    deps.branchExists.mockResolvedValue(false);
    expect(await create({ kind: 'in-place', branch: 'nope' })).toBe(400);
    expect(await create({ kind: 'existing-branch', branch: 'nope' })).toBe(400);
    expect(deps.branchExists).toHaveBeenCalledWith('/repos/pA', 'nope');
    expect(deps.createTask).not.toHaveBeenCalled();
  });
});

describe('archived tasks', () => {
  it('restart, open and wake refuse an archived task', async () => {
    for (const name of ['tasks.restart', 'tasks.open', 'tasks.wake']) {
      await expect(registry.call(orch, name, { taskId: 'old' })).rejects.toMatchObject({
        status: 409,
        message: 'old is archived; restore it first',
      });
    }
    expect(deps.restartSession).not.toHaveBeenCalled();
    expect(deps.startSession).not.toHaveBeenCalled();
    expect(deps.openTask).not.toHaveBeenCalled();
  });
});

describe('lifecycle capabilities', () => {
  it('a task cannot archive, restart or delete itself', async () => {
    expect(await status(registry.call(asTask('me'), 'tasks.archive', { taskId: 'me' }))).toBe(403);
    expect(await status(registry.call(asTask('me'), 'tasks.restart', { taskId: 'me' }))).toBe(403);
    expect(await status(registry.call(asTask('me'), 'tasks.delete', { taskId: 'child' }))).toBe(
      403,
    );
    expect(deps.archiveTask).not.toHaveBeenCalled();
    expect(deps.restartSession).not.toHaveBeenCalled();
  });

  it('a task can archive and restart its child', async () => {
    await registry.call(asTask('me'), 'tasks.archive', { taskId: 'child' });
    expect(deps.archiveTask).toHaveBeenCalledWith('child');
    await registry.call(asTask('me'), 'tasks.restart', { taskId: 'child' });
    expect(deps.restartSession).toHaveBeenCalledWith('child');
  });

  it('delete removes the worktree and maps deleteBranch onto both branch flags', async () => {
    await registry.call(orch, 'tasks.delete', { taskId: 'sibling', deleteBranch: true });
    expect(deps.deleteTask).toHaveBeenCalledWith('sibling', {
      deleteWorktreeDir: true,
      deleteLocalBranch: true,
      deleteRemoteBranch: true,
    });
    await registry.call(orch, 'tasks.delete', { taskId: 'child' });
    expect(deps.deleteTask).toHaveBeenLastCalledWith('child', {
      deleteWorktreeDir: true,
      deleteLocalBranch: false,
      deleteRemoteBranch: false,
    });
  });

  it('open focuses the task in Dash', async () => {
    expect(await registry.call(orch, 'tasks.open', { taskId: 'child' })).toEqual({});
    expect(deps.openTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'child' }));
  });
});

describe('tasks.output', () => {
  it('replays the session log into a terminal and returns the last lines as text', async () => {
    tasks.find((t) => t.id === 'child')!.jobId = 'job-c';
    deps.readLogs.mockResolvedValue(
      '\x1b7\x1b8\x1b[2J\x1b[H\x1b[38;2;1;2;3mone\x1b[2;1Htwo\x1b[3;1H\x1b[1mthree',
    );
    expect(await registry.call(orch, 'tasks.output', { taskId: 'child', lines: 2 })).toEqual({
      text: 'two\nthree',
    });
    expect(deps.readLogs).toHaveBeenCalledWith('job-c');
  });

  it('409s a task with no session', async () => {
    expect(await status(registry.call(orch, 'tasks.output', { taskId: 'child' }))).toBe(409);
  });
});

describe('tasks.get', () => {
  it('rechecks a needs-trust task, and only then', async () => {
    await registry.call(orch, 'tasks.get', { taskId: 'child' });
    expect(deps.recheckTrust).not.toHaveBeenCalled();
    untrusted = { child: '/repo' };
    deps.recheckTrust.mockImplementation(async (id: string) => {
      delete untrusted[id];
      return true;
    });
    expect(await registry.call(orch, 'tasks.get', { taskId: 'child' })).toMatchObject({
      state: 'stopped',
    });
  });
});

describe('tasks.wake', () => {
  const task = (id: string) => tasks.find((t) => t.id === id)!;
  /** startSession as ptyManager's: records the job; `register` makes it show up in the registry. */
  const starts = (register: boolean) =>
    deps.startSession.mockImplementation(async (id: string) => {
      task(id).jobId = 'job-new';
      if (register) sessions.set('job-new', live());
      return { jobId: 'job-new' };
    });

  it('returns a live session at once, without starting anything', async () => {
    task('child').jobId = 'job-c';
    sessions.set('job-c', live());
    activity = { child: { state: 'busy' } };
    expect(await registry.call(orch, 'tasks.wake', { taskId: 'child' })).toMatchObject({
      timedOut: false,
      task: { id: 'child', state: 'working', messageAddress: 'uds:/tmp/cc-socks/7.sock' },
    });
    expect(deps.startSession).not.toHaveBeenCalled();
  });

  it('starts a stopped session and returns once it is registered', async () => {
    vi.useFakeTimers();
    starts(false);
    const pending = registry.call(orch, 'tasks.wake', { taskId: 'child' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deps.startSession).toHaveBeenCalledWith('child');
    sessions.set('job-new', live());
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({
      timedOut: false,
      task: { messageAddress: 'uds:/tmp/cc-socks/7.sock' },
    });
  });

  it('times out with timedOut: true and the current view', async () => {
    vi.useFakeTimers();
    starts(false);
    const pending = registry.call(orch, 'tasks.wake', { taskId: 'child', timeoutSec: 5 });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toMatchObject({
      timedOut: true,
      task: { id: 'child', messageAddress: null },
    });
  });

  it('caps the timeout at 110 s', async () => {
    expect(
      await status(registry.call(orch, 'tasks.wake', { taskId: 'child', timeoutSec: 111 })),
    ).toBe(400);
  });

  it('refuses a task that needs the trust prompt', async () => {
    untrusted = { child: '/repo' };
    expect(await status(registry.call(orch, 'tasks.wake', { taskId: 'child' }))).toBe(409);
    expect(deps.startSession).not.toHaveBeenCalled();
    // Found untrusted by the start itself.
    deps.startSession.mockImplementation(async () => {
      untrusted = { sibling: '/repo' };
      return { needsTrust: '/repo' };
    });
    await expect(registry.call(orch, 'tasks.wake', { taskId: 'sibling' })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('/repo'),
    });
  });

  it('a task cannot wake itself, but can wake its child', async () => {
    expect(await status(registry.call(asTask('me'), 'tasks.wake', { taskId: 'me' }))).toBe(403);
    starts(true);
    expect(await registry.call(asTask('me'), 'tasks.wake', { taskId: 'child' })).toMatchObject({
      timedOut: false,
    });
  });
});
