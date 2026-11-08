import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: Array<{ channel: string; payload: unknown }> = [];
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
        },
      },
    ],
  },
}));

import {
  getSetupLog,
  isSetupRunning,
  listSetupRuns,
  recordSetupFailure,
  runSetupCommand,
  forgetSetupRun,
} from '../setupRuns';

const base = { cwd: process.cwd(), env: process.env, timeoutMs: 10_000 };

describe('setupRuns', () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it('streams stdout and stderr into the log and ends succeeded', async () => {
    const p = runSetupCommand({
      ...base,
      worktreePath: '/wt/ok',
      command: 'echo out; echo err >&2',
    });
    expect(isSetupRunning('/wt/ok')).toBe(true);
    const run = await p;
    expect(run.status).toBe('succeeded');
    expect(run.error).toBeNull();
    expect(isSetupRunning('/wt/ok')).toBe(false);
    const log = getSetupLog('/wt/ok')!.text;
    expect(log).toContain('out');
    expect(log).toContain('err');
    const channels = sent.map((s) => s.channel);
    expect(channels[0]).toBe('worktree:setupChanged');
    expect(channels).toContain('worktree:setupOutput');
    expect(channels[channels.length - 1]).toBe('worktree:setupChanged');
  });

  it('fails with the last line and exit code', async () => {
    const run = await runSetupCommand({
      ...base,
      worktreePath: '/wt/bad',
      command: 'echo "missing lockfile" >&2; exit 3',
    });
    expect(run.status).toBe('failed');
    expect(run.error).toBe('missing lockfile (exited with code 3)');
  });

  it('kills the whole command on timeout', async () => {
    const started = Date.now();
    const run = await runSetupCommand({
      ...base,
      timeoutMs: 300,
      worktreePath: '/wt/slow',
      command: 'sleep 5; echo never',
    });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/^timed out/);
    expect(getSetupLog('/wt/slow')!.text).not.toContain('never');
  });

  it('a new run replaces the previous output', async () => {
    await runSetupCommand({ ...base, worktreePath: '/wt/again', command: 'echo first' });
    await runSetupCommand({ ...base, worktreePath: '/wt/again', command: 'echo second' });
    const log = getSetupLog('/wt/again')!.text;
    expect(log).not.toContain('first');
    expect(log).toContain('second');
  });

  it('records a failure that happened before the command started', () => {
    recordSetupFailure('/wt/config', 'bad .dash/config.json');
    expect(listSetupRuns().find((r) => r.worktreePath === '/wt/config')).toMatchObject({
      status: 'failed',
      error: 'bad .dash/config.json',
    });
    forgetSetupRun('/wt/config');
    expect(getSetupLog('/wt/config')).toBeNull();
  });
});
