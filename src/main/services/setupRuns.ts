import { spawn } from 'child_process';
import { BrowserWindow } from 'electron';
import { appendCapped, setupFailureMessage, type SetupLog, type SetupRun } from '@shared/setupRuns';

/** Output is pushed to the renderer at most this often per run. */
const OUTPUT_FLUSH_MS = 100;

interface Entry {
  run: SetupRun;
  log: SetupLog;
  pending: string;
  flushTimer: NodeJS.Timeout | null;
}

/** The latest setup run per worktree path, with its output. In memory only:
 *  a restart forgets them. */
const runs = new Map<string, Entry>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(channel, payload);
    } catch (err) {
      console.warn('[setupRuns] broadcast failed', err);
    }
  }
}

function flushOutput(entry: Entry): void {
  if (entry.flushTimer) clearTimeout(entry.flushTimer);
  entry.flushTimer = null;
  if (!entry.pending) return;
  broadcast('worktree:setupOutput', {
    worktreePath: entry.run.worktreePath,
    chunk: entry.pending,
  });
  entry.pending = '';
}

function append(entry: Entry, chunk: string): void {
  entry.log = appendCapped(entry.log, chunk);
  entry.pending += chunk;
  if (!entry.flushTimer) entry.flushTimer = setTimeout(() => flushOutput(entry), OUTPUT_FLUSH_MS);
}

function finish(entry: Entry, error: string | null): void {
  flushOutput(entry);
  entry.run = {
    ...entry.run,
    status: error === null ? 'succeeded' : 'failed',
    endedAt: Date.now(),
    error,
  };
  broadcast('worktree:setupChanged', entry.run);
}

export function isSetupRunning(worktreePath: string): boolean {
  return runs.get(worktreePath)?.run.status === 'running';
}

/** Begin a run in the registry. Replaces the previous run's state and output. */
function begin(worktreePath: string): Entry {
  const entry: Entry = {
    run: { worktreePath, status: 'running', startedAt: Date.now(), endedAt: null, error: null },
    log: { text: '', trimmed: false },
    pending: '',
    flushTimer: null,
  };
  runs.set(worktreePath, entry);
  broadcast('worktree:setupChanged', entry.run);
  return entry;
}

/** Record a run that failed before its command could start (e.g. a bad
 *  `.dash/config.json`), so the failure is as visible as any other. */
export function recordSetupFailure(worktreePath: string, error: string): void {
  const entry = begin(worktreePath);
  append(entry, `${error}\n`);
  finish(entry, error.slice(0, 200));
}

/**
 * Run a setup command through the shell, streaming stdout and stderr into the
 * run's log. Resolves when the run ends; never rejects. The command runs in
 * its own process group so the timeout kills what it started, not just `sh`.
 */
export function runSetupCommand(args: {
  worktreePath: string;
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<SetupRun> {
  const entry = begin(args.worktreePath);
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const done = (error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish(entry, error);
      resolve(entry.run);
    };

    const usesGroup = process.platform !== 'win32';
    const child = spawn(args.command, {
      cwd: args.cwd,
      env: args.env,
      shell: true,
      detached: usesGroup,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (usesGroup && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }, args.timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => append(entry, chunk));
    child.stderr?.on('data', (chunk: string) => append(entry, chunk));
    child.on('error', (err) => {
      append(entry, `${err.message}\n`);
      done(err.message.slice(0, 200));
    });
    child.on('close', (code) => {
      if (code === 0 && !timedOut) return done(null);
      done(
        setupFailureMessage({
          log: entry.log.text,
          code,
          timedOut,
          timeoutMs: args.timeoutMs,
        }),
      );
    });
  });
}

export function listSetupRuns(): SetupRun[] {
  return [...runs.values()].map((e) => e.run);
}

/** A run's output so far. Pending output is pushed first, so a renderer that
 *  ignores events until this answers never sees a chunk twice or misses one. */
export function getSetupLog(worktreePath: string): SetupLog | null {
  const entry = runs.get(worktreePath);
  if (!entry) return null;
  flushOutput(entry);
  return entry.log;
}

/** Drop a removed worktree's run and output. */
export function forgetSetupRun(worktreePath: string): void {
  const entry = runs.get(worktreePath);
  if (entry?.flushTimer) clearTimeout(entry.flushTimer);
  runs.delete(worktreePath);
}
