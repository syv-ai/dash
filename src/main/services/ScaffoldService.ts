import * as fs from 'fs';
import { join } from 'path';
import { BrowserWindow } from 'electron';
import type { IPty } from 'node-pty';
import type { DetectStrategy } from './cloneMethods';

/**
 * Given the directory listing before and after a generator ran, return the
 * single newly-created entry name, or null when there is no unambiguous new
 * folder (zero new, or more than one new — caller falls back to a folder picker).
 */
export function detectCreatedFolder(before: string[], after: string[]): string | null {
  const beforeSet = new Set(before);
  const added = after.filter((entry) => !beforeSet.has(entry));
  return added.length === 1 ? added[0]! : null;
}

interface ScaffoldSession {
  proc: IPty;
  cwd: string;
  detect: DetectStrategy;
  dest: string | null;
  before: string[];
}

const sessions = new Map<string, ScaffoldSession>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export interface StartScaffoldArgs {
  sessionId: string;
  command: string[]; // [file, ...args]
  cwd: string;
  detect: DetectStrategy;
  dest: string | null;
  cols: number;
  rows: number;
}

/** Spawn the generator in a pty. Streams `scaffold:data` and finally `scaffold:exit`
 *  with the resolved result path (or null if it couldn't be determined). node-pty is
 *  loaded lazily via dynamic import so a broken native binding degrades gracefully. */
export async function startScaffold(args: StartScaffoldArgs): Promise<void> {
  const { sessionId, command, cwd, detect, dest, cols, rows } = args;
  if (sessions.has(sessionId)) return;
  if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

  let pty: typeof import('node-pty');
  try {
    pty = await import('node-pty');
  } catch (err) {
    broadcast('scaffold:data', {
      sessionId,
      data: `\r\nFailed to load terminal backend (node-pty): ${String(err)}\r\n`,
    });
    broadcast('scaffold:exit', { sessionId, exitCode: 1, resultPath: null });
    return;
  }

  const before = detect === 'diff' ? listDir(cwd) : [];
  const [file, ...rest] = command;
  const proc = pty.spawn(file!, rest, {
    cwd,
    cols,
    rows,
    env: process.env as { [key: string]: string },
  });
  sessions.set(sessionId, { proc, cwd, detect, dest, before });

  proc.onData((data) => broadcast('scaffold:data', { sessionId, data }));
  proc.onExit(({ exitCode }) => {
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    let resultPath: string | null = null;
    if (exitCode === 0 && session) {
      if (session.detect === 'dest') {
        resultPath = session.dest && fs.existsSync(session.dest) ? session.dest : null;
      } else {
        const created = detectCreatedFolder(session.before, listDir(session.cwd));
        resultPath = created ? join(session.cwd, created) : null;
      }
    }
    broadcast('scaffold:exit', { sessionId, exitCode, resultPath });
  });
}

export function writeScaffold(sessionId: string, data: string): void {
  sessions.get(sessionId)?.proc.write(data);
}

export function resizeScaffold(sessionId: string, cols: number, rows: number): void {
  try {
    sessions.get(sessionId)?.proc.resize(cols, rows);
  } catch {
    /* pty may have exited */
  }
}

export function killScaffold(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  try {
    session.proc.kill();
  } catch {
    /* already gone */
  }
}
