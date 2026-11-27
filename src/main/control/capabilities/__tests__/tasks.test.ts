import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { ActivityInfo, CreateTaskInput, Task } from '../../../../shared/types';
import { ControlError, createRegistry, type Registry } from '../../registry';
import { fakeLookups, makeProject, makeTask } from '../../__tests__/fixtures';
import { registerProjectCapabilities } from '../projects';
import type { LiveSession } from '../../../services/claudeSessionRegistry';
import {
  registerTaskCapabilities,
  toTaskView,
  type TaskCapabilityDeps,
  type TaskViewSources,
} from '../tasks';
import { FolderOccupiedError } from '../../../services/FolderOccupiedError';
import { DASH_ACCESS_OFF, ORCHESTRATOR_ACCESS_OFF } from '../../scope';

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
let taskListeners: Array<() => void>;
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
    makeProject({
      id: 'pA',
      baseRef: 'origin/main',
      gitRemote: 'git@github.com:acme/app.git',
    }),
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
  taskListeners = [];
  deps = {
    getProjects: vi.fn(() => projects),
    getTask: vi.fn((id: string) => tasks.find((t) => t.id === id)),
    getTasks: vi.fn((projectId: string) => tasks.filter((t) => t.projectId === projectId)),
    getActivity: vi.fn(() => activity),
    getActivityTiming: vi.fn(() => ({})),
    getStatusLine: vi.fn(() => ({})),
    getUntrustedRoot: vi.fn((id: string) => untrusted[id]),
    getLiveSessions: vi.fn(() => sessions),
    onActivityChange: vi.fn((l: () => void) => {
      listeners.push(l);
      return () => {
        listeners = listeners.filter((x) => x !== l);
      };
    }),
    onTasksChange: vi.fn((l: () => void) => {
      taskListeners.push(l);
      return () => {
        taskListeners = taskListeners.filter((x) => x !== l);
      };
    }),
    taskDefaults: vi.fn(() => undefined),
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
    getGithubIssue: vi.fn(async (_path: string, n: number) => ({
      provider: 'github' as const,
      id: n,
      title: `Issue ${n}`,
      url: `https://github.com/acme/app/issues/${n}`,
    })),
    getAdoWorkItem: vi.fn(async (_projectId: string, id: number) => ({
      provider: 'ado' as const,
      id,
      title: `Item ${id}`,
      url: `https://dev.azure.com/acme/app/_workitems/edit/${id}`,
      type: 'Bug',
      state: 'New',
    })),
    linkItems: vi.fn(async (taskId: string) => tasks.find((t) => t.id === taskId)!),
    setProtected: vi.fn((id: string, value: boolean) => {
      const task = tasks.find((t) => t.id === id)!;
      task.protected = value;
      return task;
    }),
    setLaunchOptions: vi.fn((id: string, patch: Partial<Task>) => {
      const task = tasks.find((t) => t.id === id)!;
      Object.assign(task, patch);
      return task;
    }),
    listAgents: vi.fn(async () => [
      { name: 'reviewer', description: 'Reviews', source: 'project' as const },
    ]),
    // Project capabilities share this deps object.
    sessionConfig: vi.fn(() => undefined),
    configure: vi.fn(async () => {}),
  } as never;
  registry = createRegistry(fakeLookups(projects, tasks));
  registerProjectCapabilities(registry, deps as never);
  registerTaskCapabilities(registry, deps as never);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A ControlError's status and message, or a failure when the call succeeds. */
async function refusalOf(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ControlError) return { status: err.status, message: err.message };
    throw err;
  }
  throw new Error('expected a refusal');
}

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

/** Sources with nothing known, over which a test sets what it needs. */
const sources = (over: Partial<TaskViewSources> = {}): TaskViewSources => ({
  activity: {},
  timing: {},
  statusLine: {},
  untrustedRoot: () => undefined,
  sessions: new Map(),
  ...over,
});

describe('toTaskView', () => {
  const t = makeTask({ id: 't', projectId: 'p' });
  const view = (info: ActivityInfo | undefined, root?: string) =>
    toTaskView(t, sources({ activity: info ? { t: info } : {}, untrustedRoot: () => root }));

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
      toTaskView(task, sources({ sessions: s })).messageAddress;
    expect(at(new Map([['job-t', live()]]))).toBe('uds:/tmp/cc-socks/7.sock');
    expect(at(new Map([['job-t', live(null)]]))).toBeNull();
    expect(at(new Map([['job-other', live()]]))).toBeNull();
    expect(at(new Map([['job-t', live()]]), t)).toBeNull(); // no job
  });

  it('reads a live session the monitor still calls stopped as idle, or working when it is busy', () => {
    const withJob = makeTask({ id: 't', projectId: 'p', jobId: 'job-t' });
    const state = (info: ActivityInfo | undefined, s: LiveSession) =>
      toTaskView(
        withJob,
        sources({ activity: info ? { t: info } : {}, sessions: new Map([['job-t', s]]) }),
      ).state;
    expect(state({ state: 'stopped' }, live())).toBe('idle');
    expect(state(undefined, live())).toBe('idle');
    expect(state({ state: 'stopped' }, { ...live(), status: 'busy' })).toBe('working');
    expect(state({ state: 'stopped' }, live(null))).toBe('stopped'); // no socket: not reachable
    expect(state({ state: 'waiting' }, live())).toBe('waiting'); // the monitor wins otherwise
  });

  it('marks a bypassPermissions task as needing approval for messages', () => {
    const mode = (permissionMode: Task['permissionMode']) =>
      toTaskView(makeTask({ id: 't', projectId: 'p', permissionMode }), sources()).messaging;
    expect(mode('bypassPermissions')).toBe('needs-approval');
    expect(mode('default')).toBe('direct');
    expect(mode('acceptEdits')).toBe('direct');
  });

  it('names the tool a wait asks about, the live mode, the times, context and cost', () => {
    const v = toTaskView(
      makeTask({ id: 't', projectId: 'p', totalTokens: 1200, totalCostUsd: 0.5 }),
      sources({
        activity: {
          t: {
            state: 'waiting',
            tool: { toolName: 'Bash', label: 'Clean', input: 'rm -rf build' },
            permissionMode: 'default',
          },
        },
        timing: { t: { lastActiveAt: Date.UTC(2026, 0, 2), waitingSince: Date.UTC(2026, 0, 1) } },
        statusLine: {
          t: {
            contextUsage: { used: 50_000, total: 200_000, percentage: 25 },
            cost: {
              totalCostUsd: 0.12,
              totalDurationMs: 0,
              totalApiDurationMs: 0,
              totalLinesAdded: 0,
              totalLinesRemoved: 0,
            },
            updatedAt: 0,
          },
        },
      }),
    );
    expect(v).toMatchObject({
      state: 'waiting',
      tool: { name: 'Bash', label: 'Clean', input: 'rm -rf build' },
      permissionMode: 'default',
      lastActiveAt: '2026-01-02T00:00:00.000Z',
      waitingSince: '2026-01-01T00:00:00.000Z',
      context: { used: 50_000, total: 200_000, percentage: 25 },
      costUsd: 0.12,
      totalTokens: 1200,
      totalCostUsd: 0.5,
    });
  });

  it('gives null for what is not known, and no wait start unless waiting', () => {
    const v = toTaskView(
      t,
      sources({
        activity: { t: { state: 'idle' } },
        timing: { t: { lastActiveAt: null, waitingSince: 5 } },
      }),
    );
    expect(v).toMatchObject({
      tool: null,
      permissionMode: null,
      lastActiveAt: null,
      waitingSince: null,
      context: null,
      costUsd: null,
    });
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
        permissionMode: 'auto',
        model: 'default',
        initialPrompt: 'write a README',
        contextPrompt: undefined,
        dashAccess: undefined,
        effort: null,
        agent: null,
        env: undefined,
        denyInsteadOfPrompting: undefined,
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

  it('passes the launch options, leaving folders and flags to the project default when not given', async () => {
    await registry.call(orch, 'tasks.create', {
      projectId: 'pA',
      name: 'x',
      effort: 'ultracode',
      agent: 'reviewer',
      addDir: ['/lib'],
      extraArgs: '--chrome',
    });
    expect(deps.createTask.mock.calls[0]![0]).toMatchObject({
      effort: 'ultracode',
      agent: 'reviewer',
      addDirs: ['/lib'],
      extraArgs: '--chrome',
    });
    await registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'y' });
    expect(deps.createTask.mock.calls[1]![0]).toMatchObject({
      addDirs: undefined,
      extraArgs: undefined,
    });
  });

  it('refuses a flag Dash owns, a relative folder and an agent the project lacks', async () => {
    const create = (input: object) =>
      registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'x', ...input });
    expect(await refusalOf(create({ extraArgs: '--dangerously-skip-permissions' }))).toEqual({
      status: 400,
      message:
        "Extra arguments: --dangerously-skip-permissions is set by the task's Permissions picker; use that instead.",
    });
    expect((await refusalOf(create({ addDir: ['lib'] }))).message).toMatch(/^Folders: lib/);
    expect((await refusalOf(create({ agent: 'ghost' }))).message).toBe(
      'no agent "ghost" in pA: its agents are reviewer',
    );
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it("passes a child's env and deny-instead-of-prompting, refusing a code-running key from a task", async () => {
    await registry.call(asTask('me'), 'tasks.create', {
      projectId: 'pA',
      name: 'seat',
      env: ['TEAMWORK_SEAT=seat'],
      denyInsteadOfPrompting: true,
    });
    expect(deps.createTask.mock.calls[0]![0]).toMatchObject({
      env: { TEAMWORK_SEAT: 'seat' },
      denyInsteadOfPrompting: true,
    });
    expect(
      await status(
        registry.call(asTask('me'), 'tasks.create', {
          projectId: 'pA',
          name: 'x',
          env: ['GIT_SSH_COMMAND=evil'],
        }),
      ),
    ).toBe(403);
    expect(deps.createTask).toHaveBeenCalledTimes(1);
  });

  it("checks the agent against the task's --plugin-dir plugins too, or the project default's", async () => {
    deps.listAgents.mockImplementation(async (_path: string, dirs: string[]) =>
      dirs.includes('/tw') ? [{ name: 'tw:lead', description: '', source: 'plugin' }] : [],
    );
    const create = (input: object) =>
      registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'x', ...input });
    await create({ agent: 'tw:lead', extraArgs: '--plugin-dir /tw' });
    expect(deps.listAgents).toHaveBeenLastCalledWith('/repos/pA', ['/tw']);
    deps.taskDefaults.mockReturnValue({ extraArgs: '--plugin-dir=/tw' });
    await create({ agent: 'tw:lead' });
    expect(deps.createTask).toHaveBeenCalledTimes(2);
    expect(await status(create({ agent: 'tw:lead', extraArgs: '' }))).toBe(400);
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
    expect(deps.createTask.mock.calls[0]![0]).toMatchObject({ permissionMode: 'auto' });
  });

  it("inherits the project's default mode", async () => {
    deps.taskDefaults.mockReturnValue({ permissionMode: 'acceptEdits' });
    await registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'x' });
    expect(deps.createTask.mock.calls[0]![0]).toMatchObject({ permissionMode: 'acceptEdits' });
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

describe('tasks.restart', () => {
  it('restarts now, fresh with a prompt when asked, and returns the task', async () => {
    const result = await registry.call(orch, 'tasks.restart', {
      taskId: 'child',
      fresh: true,
      prompt: 'Resume: read your state.',
    });
    expect(deps.restartSession).toHaveBeenCalledWith('child', {
      fresh: true,
      prompt: 'Resume: read your state.',
    });
    expect(result).toMatchObject({ id: 'child' });
  });

  it('queues a restart of a working task until its turn ends, answering at once', async () => {
    activity = { child: { state: 'busy' } };
    const result = await registry.call(orch, 'tasks.restart', {
      taskId: 'child',
      fresh: true,
      whenIdle: true,
    });
    expect(result).toMatchObject({ queued: true, task: { state: 'working' } });
    expect(deps.restartSession).not.toHaveBeenCalled();
    emitActivity({ child: { state: 'waiting' } });
    expect(deps.restartSession).not.toHaveBeenCalled();
    emitActivity({ child: { state: 'idle' } });
    expect(deps.restartSession).toHaveBeenCalledWith('child', { fresh: true, prompt: undefined });
    expect(listeners).toHaveLength(0);
    // Once only.
    emitActivity({ child: { state: 'idle' } });
    expect(deps.restartSession).toHaveBeenCalledTimes(1);
  });

  it('restarts an idle task at once with --when-idle', async () => {
    activity = { child: { state: 'idle' } };
    expect(
      await registry.call(orch, 'tasks.restart', { taskId: 'child', whenIdle: true }),
    ).toMatchObject({ queued: false, task: { id: 'child' } });
    expect(deps.restartSession).toHaveBeenCalledTimes(1);
  });

  it('lets a task restart itself only when idle, and a newer queued restart replaces the older', async () => {
    activity = { me: { state: 'busy' } };
    expect(await refusalOf(registry.call(asTask('me'), 'tasks.restart', { taskId: 'me' }))).toEqual(
      {
        status: 403,
        message:
          'a task can restart itself only with --when-idle: a restart now would cut the call making it',
      },
    );
    await registry.call(asTask('me'), 'tasks.restart', { taskId: 'me', whenIdle: true });
    await registry.call(asTask('me'), 'tasks.restart', {
      taskId: 'me',
      whenIdle: true,
      fresh: true,
      prompt: 'go',
    });
    expect(listeners).toHaveLength(1);
    emitActivity({ me: { state: 'idle' } });
    expect(deps.restartSession).toHaveBeenCalledTimes(1);
    expect(deps.restartSession).toHaveBeenCalledWith('me', { fresh: true, prompt: 'go' });
  });

  it('queues a self-restart even when no hook has marked the task working yet', async () => {
    activity = { me: { state: 'idle' } };
    expect(
      await registry.call(asTask('me'), 'tasks.restart', { taskId: 'me', whenIdle: true }),
    ).toMatchObject({ queued: true });
    expect(deps.restartSession).not.toHaveBeenCalled();
    // Another task's change, before this turn has been seen, isn't its end.
    emitActivity({ me: { state: 'idle' }, child: { state: 'busy' } });
    expect(deps.restartSession).not.toHaveBeenCalled();
    emitActivity({ me: { state: 'busy' } });
    emitActivity({ me: { state: 'idle' } });
    expect(deps.restartSession).toHaveBeenCalledTimes(1);
  });

  it('drops a queued restart when the task is archived first', async () => {
    activity = { child: { state: 'busy' } };
    await registry.call(orch, 'tasks.restart', { taskId: 'child', whenIdle: true });
    tasks.find((t) => t.id === 'child')!.archivedAt = '2026-01-04T00:00:00.000Z';
    emitActivity({ child: { state: 'stopped' } });
    expect(deps.restartSession).not.toHaveBeenCalled();
    expect(listeners).toHaveLength(0);
  });
});

describe('protected tasks', () => {
  it('refuses every agent archiving or deleting one, naming the protection', async () => {
    tasks.find((t) => t.id === 'child')!.protected = true;
    expect(
      await refusalOf(registry.call(asTask('me'), 'tasks.archive', { taskId: 'child' })),
    ).toEqual({ status: 403, message: 'Child is protected; a person archives it in Dash.' });
    expect(await refusalOf(registry.call(orch, 'tasks.archive', { taskId: 'child' }))).toEqual({
      status: 403,
      message: 'Child is protected; a person archives it in Dash.',
    });
    expect(await refusalOf(registry.call(orch, 'tasks.delete', { taskId: 'child' }))).toEqual({
      status: 403,
      message: 'Child is protected; a person deletes it in Dash.',
    });
    expect(deps.archiveTask).not.toHaveBeenCalled();
    expect(deps.deleteTask).not.toHaveBeenCalled();
  });

  it('creates and configures a task protected, without a restart, and never lifts it', async () => {
    await registry.call(asTask('me'), 'tasks.create', {
      projectId: 'pA',
      name: 'seat',
      protected: true,
    });
    expect(deps.createTask.mock.calls[0]![0]).toMatchObject({ protected: true });
    tasks.find((t) => t.id === 'child')!.jobId = 'job-c';
    const result = await registry.call(asTask('me'), 'tasks.configure', {
      taskId: 'child',
      protected: true,
    });
    expect(result).toMatchObject({ restarted: false, task: { protected: true } });
    expect(deps.setLaunchOptions).not.toHaveBeenCalled();
    expect(deps.restartSession).not.toHaveBeenCalled();
    for (const call of [
      registry.call(orch, 'tasks.configure', { taskId: 'child', protected: false }),
      registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'x', protected: false }),
    ]) {
      expect(await refusalOf(call)).toMatchObject({
        status: 403,
        message: expect.stringMatching(/^only a person can lift a task's protection/),
      });
    }
    expect(tasks.find((t) => t.id === 'child')!.protected).toBe(true);
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
    expect(deps.restartSession).toHaveBeenCalledWith('child', {
      fresh: undefined,
      prompt: undefined,
    });
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

describe('linking issues and work items', () => {
  it('tasks.create passes the fetched issue and work item through as linkedItems', async () => {
    await registry.call(orch, 'tasks.create', {
      projectId: 'pA',
      name: 'x',
      issue: '#12',
      workItem: 7,
    });
    expect(deps.getGithubIssue).toHaveBeenCalledWith('/repos/pA', 12);
    expect(deps.getAdoWorkItem).toHaveBeenCalledWith('pA', 7);
    expect(deps.createTask.mock.calls[0]![0].linkedItems).toEqual([
      expect.objectContaining({ provider: 'github', id: 12 }),
      expect.objectContaining({ provider: 'ado', id: 7 }),
    ]);
  });

  it('tasks.create without links passes no linkedItems', async () => {
    await registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'x' });
    expect(deps.createTask.mock.calls[0]![0].linkedItems).toBeUndefined();
  });

  it.each([
    ['123', 123],
    ['#123', 123],
    [123, 123],
    ['https://github.com/acme/app/issues/123', 123],
    ['https://github.com/Acme/App/issues/123/', 123],
    ['https://github.com/acme/app/issues/123#issuecomment-1', 123],
  ])('reads the issue %s as #%s', async (issue, n) => {
    await registry.call(orch, 'tasks.link', { taskId: 'sibling', issue });
    expect(deps.getGithubIssue).toHaveBeenCalledWith('/repos/pA', n);
  });

  it("400s an issue URL of another repository, or that isn't an issue", async () => {
    for (const issue of [
      'https://github.com/other/app/issues/1',
      'https://github.com/acme/app/pull/1',
      'abc',
      '0',
    ]) {
      expect(await status(registry.call(orch, 'tasks.link', { taskId: 'sibling', issue }))).toBe(
        400,
      );
    }
    expect(deps.getGithubIssue).not.toHaveBeenCalled();
    expect(deps.linkItems).not.toHaveBeenCalled();
  });

  it('404s an issue gh cannot find, with its reason', async () => {
    deps.getGithubIssue.mockRejectedValue(new Error('Could not resolve to an issue'));
    await expect(
      registry.call(orch, 'tasks.create', { projectId: 'pA', name: 'x', issue: '9' }),
    ).rejects.toMatchObject({ status: 404, message: 'issue #9: Could not resolve to an issue' });
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it('400s a work item on a project with no Azure DevOps connection', async () => {
    deps.getAdoWorkItem.mockResolvedValue(null);
    await expect(
      registry.call(orch, 'tasks.link', { taskId: 'sibling', workItem: 3 }),
    ).rejects.toMatchObject({ status: 400, message: 'pA has no Azure DevOps connection' });
  });

  it('tasks.link hands the fetched items to linkItems and returns the task', async () => {
    const result = await registry.call(asTask('me'), 'tasks.link', {
      taskId: 'child',
      issue: '5',
    });
    expect(deps.linkItems).toHaveBeenCalledWith('child', [
      expect.objectContaining({ provider: 'github', id: 5 }),
    ]);
    expect(result).toMatchObject({ id: 'child' });
  });

  it('tasks.link needs an issue or work item, and refuses an archived task', async () => {
    expect(await status(registry.call(orch, 'tasks.link', { taskId: 'sibling' }))).toBe(400);
    expect(await status(registry.call(orch, 'tasks.link', { taskId: 'old', issue: '1' }))).toBe(
      409,
    );
    expect(deps.linkItems).not.toHaveBeenCalled();
  });
});

describe('tasks.watch', () => {
  const task = (id: string) => tasks.find((t) => t.id === id)!;
  const emitTasks = () => {
    for (const l of [...taskListeners]) l();
  };
  /** A stream that collects its lines, and the controller that ends it. */
  function watch(caller: Parameters<Registry['call']>[0], input: Record<string, unknown> = {}) {
    const lines: Array<Record<string, unknown>> = [];
    const ac = new AbortController();
    const done = registry.call(caller, 'tasks.watch', input, {
      emit: (line) => lines.push(line as Record<string, unknown>),
      signal: ac.signal,
    });
    return { lines, ac, done };
  }
  const ids = (lines: Array<Record<string, unknown>>) =>
    lines.map((l) => (l.task as { id?: string } | undefined)?.id ?? `${l.event}:${l.taskId}`);

  it("starts with every watched task's view: the caller's scope, archived ones left out", async () => {
    const all = watch(orch);
    expect(ids(all.lines)).toEqual(['me', 'child', 'sibling', 'other']);
    expect(all.lines[0]).toEqual({
      event: 'task',
      task: toTaskView(task('me'), sources({ activity, sessions })),
    });
    const mine = watch(asTask('me'));
    expect(ids(mine.lines)).toEqual(['me', 'child']);
    const projectB = watch(orch, { projectId: 'pB' });
    expect(ids(projectB.lines)).toEqual(['other']);
    for (const w of [all, mine, projectB]) w.ac.abort();
    await Promise.all([all.done, mine.done, projectB.done]);
  });

  it('emits a task again only when its view changes', async () => {
    const w = watch(orch, { taskId: 'child' });
    expect(w.lines).toHaveLength(1);
    emitActivity({});
    emitActivity({ sibling: { state: 'busy' } });
    expect(w.lines).toHaveLength(1);
    emitActivity({ child: { state: 'busy' } });
    emitActivity({ child: { state: 'busy' } });
    expect(w.lines).toHaveLength(2);
    expect(w.lines[1]).toMatchObject({ event: 'task', task: { id: 'child', state: 'working' } });
    w.ac.abort();
    await w.done;
  });

  it('picks up new tasks, and says when one is archived or deleted', async () => {
    const w = watch(orch, { projectId: 'pA' });
    w.lines.length = 0;
    tasks.push(makeTask({ id: 'fresh', projectId: 'pA' }));
    emitTasks();
    task('sibling').archivedAt = '2026-02-01T00:00:00.000Z';
    tasks.splice(tasks.indexOf(task('child')), 1);
    emitTasks();
    expect(ids(w.lines)).toEqual(['fresh', 'removed:child', 'removed:sibling']);
    // A restored task is watched again.
    task('sibling').archivedAt = null;
    emitTasks();
    expect(ids(w.lines).at(-1)).toBe('sibling');
    w.ac.abort();
    await w.done;
  });

  it("re-reads views on a timer, for a session's message address", async () => {
    vi.useFakeTimers();
    const w = watch(orch, { taskId: 'child' });
    task('child').jobId = 'job-c';
    sessions.set('job-c', live());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.lines.at(-1)).toMatchObject({
      task: { id: 'child', messageAddress: 'uds:/tmp/cc-socks/7.sock' },
    });
    w.ac.abort();
    await w.done;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends after the removed line when watching one task', async () => {
    const w = watch(orch, { taskId: 'child' });
    task('child').archivedAt = '2026-02-01T00:00:00.000Z';
    emitTasks();
    await expect(w.done).resolves.toBeUndefined();
    expect(ids(w.lines)).toEqual(['child', 'removed:child']);
    expect(listeners).toHaveLength(0);
    expect(taskListeners).toHaveLength(0);
  });

  it('unsubscribes when the stream is aborted', async () => {
    vi.useFakeTimers();
    const w = watch(orch);
    expect(listeners).toHaveLength(1);
    expect(taskListeners).toHaveLength(1);
    w.ac.abort();
    await expect(w.done).resolves.toBeUndefined();
    expect(listeners).toHaveLength(0);
    expect(taskListeners).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    emitActivity({ child: { state: 'busy' } });
    expect(ids(w.lines)).toEqual(['me', 'child', 'sibling', 'other']);
  });

  it("ends with an error once the caller's access is gone", async () => {
    // A task caller: its Dash access turned off, or the task itself removed.
    const mine = watch(asTask('me'));
    task('me').dashAccess = false;
    emitTasks();
    await expect(mine.done).rejects.toMatchObject({ status: 403, message: DASH_ACCESS_OFF });
    task('me').dashAccess = true;
    const gone = watch(asTask('me'));
    tasks.splice(tasks.indexOf(task('me')), 1);
    emitActivity({});
    await expect(gone.done).rejects.toMatchObject({ status: 403 });
    expect(listeners).toHaveLength(0);
    expect(taskListeners).toHaveLength(0);
  });

  it('ends with an error once orchestrator access is turned off, on the next poll', async () => {
    vi.useFakeTimers();
    let allowed = true;
    registry = createRegistry({
      ...fakeLookups(projects, tasks),
      isOrchestratorAllowed: () => allowed,
    });
    registerTaskCapabilities(registry, deps as never);
    const w = watch(orch);
    allowed = false;
    const settled = expect(w.done).rejects.toMatchObject({
      status: 403,
      message: ORCHESTRATOR_ACCESS_OFF,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await settled;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses before streaming: out of scope, archived, both targets, no stream', async () => {
    const refused = async (
      caller: Parameters<Registry['call']>[0],
      input: Record<string, unknown>,
    ) => {
      const w = watch(caller, input);
      const code = await status(w.done);
      expect(w.lines).toEqual([]);
      return code;
    };
    expect(await refused(asTask('me'), { taskId: 'sibling' })).toBe(404);
    expect(await refused(orch, { taskId: 'hidden' })).toBe(404);
    expect(await refused(orch, { projectId: 'pArch' })).toBe(404);
    expect(await refused(orch, { taskId: 'old' })).toBe(409);
    expect(await refused(orch, { taskId: 'child', projectId: 'pA' })).toBe(400);
    expect(await status(registry.call(orch, 'tasks.watch', {}))).toBe(406);
    expect(listeners).toHaveLength(0);
  });
});

describe('tasks.configure', () => {
  it('saves only what is given and restarts a task that has a session', async () => {
    tasks.find((t) => t.id === 'child')!.jobId = 'job-c';
    const result = await registry.call(orch, 'tasks.configure', {
      taskId: 'child',
      effort: 'high',
      addDir: ['/lib', ''],
    });
    expect(deps.setLaunchOptions).toHaveBeenCalledWith('child', {
      effort: 'high',
      addDirs: ['/lib'],
    });
    expect(deps.restartSession).toHaveBeenCalledWith('child');
    expect(result).toMatchObject({ restarted: true, task: { effort: 'high', addDirs: ['/lib'] } });
  });

  it("clears with default and '', and saves without a restart when there is no session", async () => {
    const result = await registry.call(orch, 'tasks.configure', {
      taskId: 'sibling',
      effort: 'default',
      extraArgs: '  ',
    });
    expect(deps.setLaunchOptions).toHaveBeenCalledWith('sibling', {
      effort: null,
      extraArgs: null,
    });
    expect(deps.restartSession).not.toHaveBeenCalled();
    expect(result).toMatchObject({ restarted: false });
  });

  it('refuses a task giving another risky flags, which a person may give it', async () => {
    tasks.find((t) => t.id === 'child')!.jobId = 'job-c';
    expect(
      await refusalOf(
        registry.call(asTask('me'), 'tasks.configure', {
          taskId: 'child',
          extraArgs: "--allowedTools 'Bash'",
        }),
      ),
    ).toMatchObject({
      status: 403,
      message: expect.stringMatching(/^a task can't give another task --allowedTools/),
    });
    expect(
      (
        await refusalOf(
          registry.call(asTask('me'), 'tasks.create', {
            projectId: 'pA',
            name: 'x',
            extraArgs: '--mcp-config m.json',
          }),
        )
      ).status,
    ).toBe(403);
    await registry.call(asTask('me'), 'tasks.configure', {
      taskId: 'child',
      extraArgs: '--chrome',
    });
    await registry.call(orch, 'tasks.configure', { taskId: 'child', extraArgs: '--tools Read' });
    expect(deps.setLaunchOptions).toHaveBeenCalledTimes(2);
  });

  it("sets a child's env and deny-instead-of-prompting from its parent, replacing the env", async () => {
    tasks.find((t) => t.id === 'child')!.jobId = 'job-c';
    const result = await registry.call(asTask('me'), 'tasks.configure', {
      taskId: 'child',
      env: ['TEAMWORK_SEAT=lead', 'NOTE=a=b'],
      denyInsteadOfPrompting: true,
    });
    expect(deps.setLaunchOptions).toHaveBeenCalledWith('child', {
      env: { TEAMWORK_SEAT: 'lead', NOTE: 'a=b' },
      denyInsteadOfPrompting: true,
    });
    expect(result).toMatchObject({
      restarted: true,
      task: { env: { TEAMWORK_SEAT: 'lead', NOTE: 'a=b' }, denyInsteadOfPrompting: true },
    });
    await registry.call(orch, 'tasks.configure', { taskId: 'child', env: [''] });
    expect(deps.setLaunchOptions).toHaveBeenLastCalledWith('child', { env: {} });
  });

  it('refuses env a task may not set: 400 for everyone, 403 for the code-running keys from a task', async () => {
    const configure = (caller: typeof orch | ReturnType<typeof asTask>, env: string[]) =>
      refusalOf(registry.call(caller, 'tasks.configure', { taskId: 'child', env }));
    expect(await configure(orch, ['FOO'])).toEqual({
      status: 400,
      message: '--env FOO: write KEY=VALUE',
    });
    expect(await configure(orch, ['ANTHROPIC_API_KEY=x'])).toMatchObject({
      status: 400,
      message: expect.stringMatching(/^Environment: ANTHROPIC_API_KEY configures/),
    });
    expect(await configure(asTask('me'), ['NODE_OPTIONS=--require /x.js'])).toMatchObject({
      status: 403,
      message: expect.stringMatching(
        /^a task can't give another task NODE_OPTIONS: NODE_OPTIONS makes a program load code/,
      ),
    });
    // A task never reaches one it didn't create, nor itself.
    expect(
      await status(
        registry.call(asTask('me'), 'tasks.configure', { taskId: 'sibling', env: ['A=1'] }),
      ),
    ).toBe(404);
    expect(
      await status(registry.call(asTask('me'), 'tasks.configure', { taskId: 'me', env: ['A=1'] })),
    ).toBe(403);
    // A person (an outside orchestrator) may.
    await registry.call(orch, 'tasks.configure', { taskId: 'child', env: ['NODE_OPTIONS=--x'] });
    expect(deps.setLaunchOptions).toHaveBeenCalledTimes(1);
  });

  it('says it did not restart when the folder now needs trust', async () => {
    tasks.find((t) => t.id === 'child')!.jobId = 'job-c';
    deps.restartSession.mockResolvedValueOnce({ needsTrust: '/lib' });
    expect(
      await registry.call(orch, 'tasks.configure', { taskId: 'child', addDir: ['/lib'] }),
    ).toMatchObject({ restarted: false });
  });

  it('refuses blocked flags, an empty change, and a task configuring itself', async () => {
    expect(
      await refusalOf(
        registry.call(orch, 'tasks.configure', { taskId: 'child', extraArgs: '--settings x' }),
      ),
    ).toMatchObject({
      status: 400,
      message: expect.stringMatching(/^Extra arguments: --settings/),
    });
    expect(
      (await refusalOf(registry.call(orch, 'tasks.configure', { taskId: 'child' }))).status,
    ).toBe(400);
    expect(
      await status(registry.call(asTask('me'), 'tasks.configure', { taskId: 'me', effort: 'low' })),
    ).toBe(403);
    expect(deps.setLaunchOptions).not.toHaveBeenCalled();
  });
});

describe('projects.configure', () => {
  it('writes what is given, checked like a task, and gives the project back', async () => {
    const result = await registry.call(orch, 'projects.configure', {
      projectId: 'pA',
      appendSystemPrompt: 'Use pnpm.',
      addDir: ['/lib'],
    });
    const projectDeps = deps as unknown as { configure: Mock };
    expect(projectDeps.configure).toHaveBeenCalledWith(projects[0]!.path, {
      appendSystemPrompt: 'Use pnpm.',
      addDirs: ['/lib'],
    });
    expect(result).toMatchObject({ id: 'pA' });
    expect(
      (
        await refusalOf(
          registry.call(orch, 'projects.configure', { projectId: 'pA', extraArgs: '-p' }),
        )
      ).message,
    ).toMatch(/^Extra arguments: -p works only with --print/);
  });
});
