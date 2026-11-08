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
  killAllSetupRuns,
} from '../setupRuns';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** A file the command touches if it survives long enough to reach it. */
const marker = (name: string) =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-setup-')), name);

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

  it('settles a timed-out run whose command ignores SIGTERM and holds the pipes', async () => {
    const started = Date.now();
    const run = await runSetupCommand({
      ...base,
      timeoutMs: 200,
      worktreePath: '/wt/stubborn',
      // The shell and a backgrounded child both ignore TERM; the child keeps
      // stdout open, so only SIGKILL + cutting the pipes ends the run.
      command: "trap '' TERM; (trap '' TERM; sleep 30) & sleep 30",
    });
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/^timed out/);
    expect(Date.now() - started).toBeLessThan(6000);
  }, 10_000);

  it('on timeout, kills a TERM-ignoring grandchild the exited leader left holding the pipes', async () => {
    const touched = marker('orphan');
    const run = await runSetupCommand({
      ...base,
      timeoutMs: 200,
      worktreePath: '/wt/orphan',
      command: `(trap '' TERM; sleep 1; touch ${touched}) &`,
    });
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/^timed out/);
    await new Promise((r) => setTimeout(r, 1300));
    expect(fs.existsSync(touched)).toBe(false);
  });

  it('forgetting a running run kills it quietly and tells the renderer', async () => {
    const touched = marker('forgot');
    const p = runSetupCommand({
      ...base,
      worktreePath: '/wt/forget',
      command: `sleep 1; touch ${touched}`,
    });
    sent.length = 0;
    forgetSetupRun('/wt/forget');
    const run = await p;
    expect(run.status).toBe('failed');
    expect(sent.map((s) => s.channel)).toEqual(['worktree:setupForgotten']);
    expect(listSetupRuns().some((r) => r.worktreePath === '/wt/forget')).toBe(false);
    await new Promise((r) => setTimeout(r, 1300));
    expect(fs.existsSync(touched)).toBe(false);
  });

  it('killAllSetupRuns ends every run, children included', async () => {
    const touched = marker('quit');
    const p = runSetupCommand({
      ...base,
      worktreePath: '/wt/quit',
      command: `(sleep 1; touch ${touched}) & wait`,
    });
    killAllSetupRuns();
    await p;
    expect(listSetupRuns()).toEqual([]);
    await new Promise((r) => setTimeout(r, 1300));
    expect(fs.existsSync(touched)).toBe(false);
  });
});
