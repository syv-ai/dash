import { spawn, type ChildProcess } from 'child_process';
import { BrowserWindow } from 'electron';
import { appendCapped, setupFailureMessage, type SetupLog, type SetupRun } from '@shared/setupRuns';

/** Output is pushed to the renderer at most this often per run. */
const OUTPUT_FLUSH_MS = 100;
/** After SIGTERM, how long a run gets before SIGKILL. */
const KILL_GRACE_MS = 2000;

interface Entry {
  run: SetupRun;
  log: SetupLog;
  pending: string;
  flushTimer: NodeJS.Timeout | null;
  /** The running command; null once it has ended. */
  child: ChildProcess | null;
  /** Forgotten (task archived or deleted, app quitting): the run ends silently. */
  dead: boolean;
  /** Pending SIGKILL after a SIGTERM; settled runs fire it early and clear it. */
  forceTimer: NodeJS.Timeout | null;
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
  if (!entry.pending || entry.dead) {
    entry.pending = '';
    return;
  }
  broadcast('worktree:setupOutput', {
    worktreePath: entry.run.worktreePath,
    chunk: entry.pending,
  });
  entry.pending = '';
}

function append(entry: Entry, chunk: string): void {
  entry.log = appendCapped(entry.log, chunk);
  if (entry.dead) return;
  entry.pending += chunk;
  if (!entry.flushTimer) entry.flushTimer = setTimeout(() => flushOutput(entry), OUTPUT_FLUSH_MS);
}

function finish(entry: Entry, error: string | null): void {
  entry.child = null;
  flushOutput(entry);
  entry.run = {
    ...entry.run,
    status: error === null ? 'succeeded' : 'failed',
    endedAt: Date.now(),
    error,
  };
  if (!entry.dead) broadcast('worktree:setupChanged', entry.run);
}

/**
 * Kill a run's whole process tree: its process group on macOS/Linux (the
 * command runs detached in its own group), `taskkill /T` on Windows, where
 * killing the child would only end cmd.exe.
 */
function killTree(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' }).on(
        'error',
        () => {},
      );
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    // Already gone.
  }
}

/**
 * SIGTERM the tree, then SIGKILL the group after `graceMs` (at once for 0).
 * The SIGKILL doesn't wait on the leader's `exit`: a grandchild holding the
 * pipes outlives it, and that grandchild is what has to go. When the run
 * settles first, `settleStop` sends the SIGKILL early and clears the timer.
 */
function stop(entry: Entry, child: ChildProcess, graceMs: number): void {
  killTree(child, 'SIGTERM');
  if (process.platform === 'win32') return; // taskkill /F already forced it.
  if (graceMs === 0) {
    if (entry.forceTimer) clearTimeout(entry.forceTimer);
    entry.forceTimer = null;
    killTree(child, 'SIGKILL');
    return;
  }
  if (entry.forceTimer) return;
  entry.forceTimer = setTimeout(() => {
    entry.forceTimer = null;
    killTree(child, 'SIGKILL');
  }, graceMs);
}

/** The run ended after a stop: kill what is left of its group now. */
function settleStop(entry: Entry, child: ChildProcess): void {
  if (!entry.forceTimer) return;
  clearTimeout(entry.forceTimer);
  entry.forceTimer = null;
  killTree(child, 'SIGKILL');
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
    child: null,
    dead: false,
    forceTimer: null,
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
 * run's log. Resolves when the run ends; never rejects. On timeout the tree
 * is killed and the pipes are closed, and the run settles on whichever of
 * `exit`/`close` comes first, so a child that keeps a pipe open can't leave
 * it "running".
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
    let timer: NodeJS.Timeout | null = null;
    const done = (error: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      settleStop(entry, child);
      finish(entry, error);
      resolve(entry.run);
    };
    const ended = (code: number | null) => {
      if (code === 0 && !timedOut) return done(null);
      done(setupFailureMessage({ log: entry.log.text, code, timedOut, timeoutMs: args.timeoutMs }));
    };

    const child = spawn(args.command, {
      cwd: args.cwd,
      env: args.env,
      shell: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    entry.child = child;
    timer = setTimeout(() => {
      timedOut = true;
      child.stdout?.destroy();
      child.stderr?.destroy();
      stop(entry, child, KILL_GRACE_MS);
    }, args.timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => append(entry, chunk));
    child.stderr?.on('data', (chunk: string) => append(entry, chunk));
    child.on('error', (err) => {
      append(entry, `${err.message}\n`);
      done(err.message.slice(0, 200));
    });
    // `close` normally (all output read); `exit` only once the pipes were cut
    // on timeout, since a backgrounded grandchild may hold them open forever.
    child.on('close', (code) => ended(code));
    child.on('exit', (code) => {
      if (timedOut) ended(code);
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

function kill(entry: Entry, graceMs: number): void {
  entry.dead = true;
  if (entry.flushTimer) clearTimeout(entry.flushTimer);
  entry.flushTimer = null;
  entry.pending = '';
  if (entry.child) stop(entry, entry.child, graceMs);
}

/** Drop a worktree's run (task archived or deleted): kill it if it is still
 *  going, quietly, and tell the renderer to forget it. */
export function forgetSetupRun(worktreePath: string): void {
  const entry = runs.get(worktreePath);
  if (!entry) return;
  kill(entry, KILL_GRACE_MS);
  runs.delete(worktreePath);
  broadcast('worktree:setupForgotten', { worktreePath });
}

/** App quit: the runs are detached, so they would outlive Dash otherwise.
 *  SIGKILL straight away; there is no time left for a grace period. */
export function killAllSetupRuns(): void {
  for (const entry of runs.values()) kill(entry, 0);
  runs.clear();
}
