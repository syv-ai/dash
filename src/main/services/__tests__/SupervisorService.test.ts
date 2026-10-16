import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// execFile is promisified inside the service; mock it at the callback level so
// `promisify` wraps our fake. Each test queues responses per invocation.
type Call = { args: string[]; opts: Record<string, unknown> };
const calls: Call[] = [];
let responses: Array<{ stdout?: string; stderr?: string; error?: Error }> = [];

vi.mock('child_process', async () => {
  const { promisify } = await import('util');
  // Same promisified shape as the real execFile: resolves { stdout, stderr },
  // rejects with the error carrying stdout/stderr.
  const execFile = (_file: string, args: string[], opts: Record<string, unknown>) => {
    calls.push({ args, opts });
    // An unqueued listing reads as "no sessions", not as unparseable output.
    const r = responses.shift() ?? { stdout: args[0] === 'agents' ? '[]' : '' };
    if (r.error) {
      const e = r.error as Error & { stdout?: string; stderr?: string };
      e.stdout = r.stdout ?? '';
      e.stderr = r.stderr ?? '';
      return Promise.reject(e);
    }
    return Promise.resolve({ stdout: r.stdout ?? '', stderr: r.stderr ?? '' });
  };
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = execFile;
  return { execFile };
});
vi.mock('electron', () => ({ app: { on: vi.fn(), removeListener: vi.fn() }, powerMonitor: {} }));
vi.mock('../claudeCli', () => ({ findClaudePath: async () => '/usr/local/bin/claude' }));
vi.mock('../claudeEnv', () => ({ isUltracode: () => false }));
vi.mock('../DatabaseService', () => ({
  DatabaseService: { getTasksWithSessions: () => [], setTaskSession: vi.fn() },
}));
vi.mock('../ActivityMonitor', () => ({
  activityMonitor: { applySupervisor: vi.fn(), unregister: vi.fn() },
}));

import { supervisorService, DispatchError } from '../SupervisorService';
import { SessionNotIdleError } from '../supervisorSession';

const listing = (rows: unknown[]) => ({ stdout: JSON.stringify(rows) });

beforeEach(() => {
  calls.length = 0;
  responses = [];
});

// dispatch() and the lifecycle verbs fire a background refresh() and don't
// wait for it. Join it here so it can't run on into the next test and shift a
// response off that test's queue. refresh() coalesces, so this returns the
// in-flight promise when there is one rather than starting another listing.
afterEach(async () => {
  await supervisorService.refresh('test-drain');
});

describe('SupervisorService.dispatch', () => {
  it('runs claude --bg in the cwd and resolves the job + session id from the listing', async () => {
    responses = [
      { stdout: 'backgrounded · 5ebbd6cc · my task\n\n  claude attach 5ebbd6cc\n' },
      listing([
        { id: '5ebbd6cc', sessionId: '5ebbd6cc-1111', cwd: '/wt', kind: 'background', pid: 1 },
      ]),
      listing([]), // refresh('dispatch') fired in the background
    ];
    const result = await supervisorService.dispatch({
      cwd: '/wt',
      name: 'my task',
      permissionMode: 'acceptEdits',
      env: { PATH: '/bin' },
    });
    expect(result).toEqual({ jobId: '5ebbd6cc', sessionId: '5ebbd6cc-1111' });
    expect(calls[0]!.args).toEqual([
      '--bg',
      '--name',
      'my task',
      '--permission-mode',
      'acceptEdits',
    ]);
    expect(calls[0]!.opts.cwd).toBe('/wt');
    expect(calls[0]!.opts.env).toEqual({ PATH: '/bin' });
    expect(calls[1]!.args).toEqual(['agents', '--json', '--all', '--cwd', '/wt']);
  });

  it('throws a DispatchError when no job id was printed', async () => {
    responses = [{ stdout: '', stderr: "Couldn't start a background session: no such dir" }];
    await expect(
      supervisorService.dispatch({ cwd: '/gone', name: 't', env: {} }),
    ).rejects.toBeInstanceOf(DispatchError);
  });

  it('treats a non-zero exit that still printed the job line as dispatched', async () => {
    responses = [
      { error: new Error('exit 1'), stdout: 'backgrounded · deadbeef · t\n' },
      listing([]),
      listing([]),
      listing([]),
      listing([]),
      listing([]),
    ];
    const result = await supervisorService.dispatch({ cwd: '/wt', name: 't', env: {} });
    expect(result).toEqual({ jobId: 'deadbeef', sessionId: null });
  }, 10_000);

  it('retries the listing until the fresh row shows its session id', async () => {
    responses = [
      { stdout: 'backgrounded · cafebabe · t\n' },
      listing([]),
      listing([{ id: 'cafebabe', sessionId: 'cafebabe-2', cwd: '/wt', kind: 'background' }]),
      listing([]),
    ];
    const result = await supervisorService.dispatch({ cwd: '/wt', name: 't', env: {} });
    expect(result).toEqual({ jobId: 'cafebabe', sessionId: 'cafebabe-2' });
  });
});

describe('SupervisorService verbs', () => {
  it('list passes --all and --cwd through and parses rows', async () => {
    responses = [listing([{ id: 'a', cwd: '/x', kind: 'background', startedAt: 1, pid: 2 }])];
    const rows = await supervisorService.list({ all: true, cwd: '/x' });
    expect(calls[0]!.args).toEqual(['agents', '--json', '--all', '--cwd', '/x']);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('a');
  });

  it('stop / respawn / rm shell out with the job id', async () => {
    responses = [{}, listing([]), {}, listing([]), {}, listing([])];
    await supervisorService.stop('a1');
    await supervisorService.respawn('a1');
    await supervisorService.remove('a1');
    const verbs = calls.map((c) => c.args.slice(0, 2).join(' '));
    expect(verbs).toContain('stop a1');
    expect(verbs).toContain('respawn a1');
    expect(verbs).toContain('rm a1');
  });

  it('logs prints the raw terminal output of the job', async () => {
    responses = [{ stdout: '\x1b[2J\x1b[Hhello' }];
    expect(await supervisorService.logs('a1')).toBe('\x1b[2J\x1b[Hhello');
    expect(calls[0]!.args).toEqual(['logs', 'a1']);
  });

  it('logs keeps what was printed when the command times out', async () => {
    const timeout = Object.assign(new Error('timed out'), { killed: true });
    responses = [{ error: timeout, stdout: 'partial' }];
    expect(await supervisorService.logs('a1')).toBe('partial');
  });

  it('remove tolerates an already-removed job', async () => {
    responses = [{ error: new Error('exit 1'), stderr: 'No such job: a1' }, listing([])];
    await expect(supervisorService.remove('a1')).resolves.toBeUndefined();
  });
});

describe('SupervisorService.sendToSession', () => {
  const base = { jobId: '7ec72810', sessionId: '7ec72810-aaaa', cwd: '/wt', env: { PATH: '/bin' } };
  const row = (extra: Record<string, unknown>) =>
    ({ id: '7ec72810', cwd: '/wt', kind: 'background', startedAt: 1, ...extra }) as never;
  const woke = {
    stdout: 'note: woke session 7ec72810 with its saved options.\nbackgrounded · 7ec72810 · t\n',
  };
  const args = () => calls.map((c) => c.args);

  it('stops an idle running job, then resumes it with only the message', async () => {
    responses = [{}, woke, listing([])];
    await supervisorService.sendToSession({
      ...base,
      message: '- do this',
      row: row({ pid: 1, status: 'idle', state: 'done' }),
    });
    expect(args().slice(0, 2)).toEqual([
      ['stop', '7ec72810'],
      ['--bg', '--resume', '7ec72810-aaaa', '--', '- do this'],
    ]);
    expect(calls[1]!.opts.cwd).toBe('/wt');
    expect(calls[1]!.opts.env).toEqual({ PATH: '/bin' });
  });

  it('resumes a stopped job without stopping it', async () => {
    responses = [woke, listing([])];
    await supervisorService.sendToSession({ ...base, message: 'go', row: row({ state: 'done' }) });
    expect(args()[0]).toEqual(['--bg', '--resume', '7ec72810-aaaa', '--', 'go']);
    expect(args().some((a) => a[0] === 'stop')).toBe(false);
  });

  it('refuses a busy or waiting job and runs nothing', async () => {
    for (const status of ['busy', 'waiting'] as const) {
      calls.length = 0;
      await expect(
        supervisorService.sendToSession({ ...base, message: 'go', row: row({ pid: 1, status }) }),
      ).rejects.toEqual(new SessionNotIdleError(status));
      expect(calls).toHaveLength(0);
    }
  });

  it('removes a copy the CLI started and fails the send', async () => {
    responses = [
      {
        stdout:
          'note: session 7ec72810 is already running in the background, so this started a copy as 73a3165a.\nbackgrounded · 73a3165a\n',
      },
    ];
    await expect(
      supervisorService.sendToSession({ ...base, message: 'go', row: row({ state: 'stopped' }) }),
    ).rejects.toBeInstanceOf(DispatchError);
    expect(args()).toContainEqual(['stop', '73a3165a']);
    expect(args()).toContainEqual(['rm', '73a3165a']);
  });
});
