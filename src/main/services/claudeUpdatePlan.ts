import type { ActivityInfo } from '@shared/types';
import { compareClaudeVersions, parseClaudeVersion } from './claudeCli';

/**
 * Pure decisions behind ClaudeUpdateService: which live sessions run an older
 * Claude Code than the installed one, which tasks are active, and the next
 * step of a "restart when done" request. Free of I/O so the rules are pinned
 * by unit tests.
 */

export interface LiveSessionVersion {
  taskId: string;
  /** The version the session's process runs; null when unknown. */
  version: string | null;
}

/**
 * Live sessions on a version older than `installed`. A session whose version
 * can't be read, or one newer than the install (a downgrade), is left alone:
 * restarting it would not land it on a newer Claude Code.
 */
export function findOutdated(
  installed: string | null,
  sessions: readonly LiveSessionVersion[],
): { taskId: string; version: string }[] {
  const target = parseClaudeVersion(installed);
  if (!target) return [];
  const outdated: { taskId: string; version: string }[] = [];
  for (const s of sessions) {
    const parsed = parseClaudeVersion(s.version);
    if (parsed && compareClaudeVersions(parsed, target) < 0) {
      outdated.push({ taskId: s.taskId, version: s.version! });
    }
  }
  return outdated;
}

/**
 * Tasks that aren't done: working (a turn, or background subagents, which
 * ActivityMonitor folds into `busy`) or waiting on a prompt. A pending
 * question isn't done, so `waiting` counts.
 */
export function activeTaskIds(activity: Record<string, ActivityInfo>): string[] {
  return Object.entries(activity)
    .filter(([, a]) => a.state === 'busy' || a.state === 'waiting')
    .map(([id]) => id);
}

export type DeferredStep =
  | { kind: 'wait'; active: string[] }
  | { kind: 'restart'; taskIds: string[] }
  | { kind: 'finished' };

/**
 * The next step of a "restart when done" request. It fires only when no task
 * in the whole app is active, and restarts each outdated session at most once
 * per request (`restarted`), so a session that comes back on the same version
 * can't loop. It finishes once no outdated session is left to restart.
 */
export function nextDeferredStep(input: {
  outdated: readonly string[];
  active: readonly string[];
  restarted: ReadonlySet<string>;
}): DeferredStep {
  const remaining = input.outdated.filter((id) => !input.restarted.has(id));
  if (remaining.length === 0) return { kind: 'finished' };
  if (input.active.length > 0) return { kind: 'wait', active: [...input.active] };
  return { kind: 'restart', taskIds: remaining };
}

/**
 * The version in a native-installer executable path (`…/versions/2.1.331`),
 * or null for any other executable (an npm install runs `node`). The
 * installer never rewrites a `versions/<v>` file; an update adds a new one
 * and swaps the `claude` symlink, so a running process keeps its path.
 */
export function versionFromExecutablePath(executable: string): string | null {
  const m = executable.match(/[\\/]versions[\\/](\d+\.\d+\.\d+)$/);
  return m ? m[1]! : null;
}

/** The executable in `lsof -a -p <pid> -d txt -Fn` output: its first file. */
export function parseLsofExecutable(stdout: string): string | null {
  const line = stdout.split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : null;
}

/**
 * The Claude Code version from a background job's `state.json` (`cliVersion`).
 * Only a fallback: the job writes it once it takes a turn (observed on
 * 2.1.332), so a freshly started job has none, and a respawned one keeps its
 * old process's until then. Null for anything that isn't a version.
 */
export function parseSessionCliVersion(stateJson: string): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stateJson);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = (raw as { cliVersion?: unknown }).cliVersion;
  return typeof v === 'string' && parseClaudeVersion(v) ? v : null;
}
