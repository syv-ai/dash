import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TaskScratchpad } from '@shared/agent';
import { checkScratchpadDir } from '../claudeContract/agentFileSchemas';
import { claudeVersionFor } from '../claudeContract/claudeVersions';
import { reportFindings } from '../claudeContract/driftReporter';
import { broadcast } from '../utils/broadcast';
import { watchFolder } from '../utils/watchFolder';
import { DatabaseService } from './DatabaseService';
import { listPlainFolder } from './plainFolder';
import { claudeConfigDir } from '../utils/claudePaths';
import { deriveScratchpadDir, jobScratchDir, scratchpadFromPayload } from './scratchpad';

/**
 * Each task's Claude Code scratchpad, for the task sidebar's Agent tab: the
 * folder its session writes scratch files to (`scratchpad.ts`). A task's
 * session runs in the background, so that is its job's `tmp/` while the job
 * exists (a sleeping task keeps it; `claude rm` removes it). Otherwise the
 * session scratchpad its payloads last named (SessionStart's inbox hook
 * first, then every statusLine), or, before any payload this run, the one
 * derived from the task's recorded session. A resumed session keeps its id,
 * so its scratchpad too (checked live, 2.1.332). The renderer names a task,
 * never a path: main resolves the folder itself.
 */

const DEBOUNCE_MS = 200;
const CHANGED = 'agent:scratchpadChanged';

/** The last scratchpad a payload named, per task. */
const named = new Map<string, string>();
/** The folder each task's watch is on, and the renderer was last told of. */
const current = new Map<string, string | null>();
/** Dirs this run handed the renderer: the editor lists these as plain files. */
const served = new Set<string>();

interface Watch {
  /** Null while the task has no folder (no session yet). */
  dir: string | null;
  refs: number;
  close: () => void;
}
const watches = new Map<string, Watch>();

function changed(taskId: string): void {
  broadcast(CHANGED, { taskId });
}

/** The task's scratch folder (see above); null when it has had no session. */
export function taskScratchpadDir(taskId: string): string | null {
  const task = DatabaseService.getTask(taskId);
  const job = task?.jobId ? jobScratchDir(claudeConfigDir(), task.jobId) : null;
  if (job && fs.existsSync(path.dirname(job))) return job;
  const known = named.get(taskId);
  if (known) return known;
  if (!task?.sessionId) return null;
  return deriveScratchpadDir(task.path, task.sessionId, {
    platform: process.platform,
    uid: process.getuid?.(),
    tmpOverride: process.env.CLAUDE_CODE_TMPDIR,
    osTmp: os.tmpdir(),
  });
}

/** Point the task's watch at `dir`; true when that moved it. */
function follow(taskId: string, dir: string | null): boolean {
  if (current.has(taskId) && current.get(taskId) === dir) return false;
  current.set(taskId, dir);
  const watch = watches.get(taskId);
  if (watch && watch.dir !== dir) {
    watch.close();
    watch.dir = dir;
    watch.close = arm(taskId, dir);
  }
  return true;
}

/**
 * A hook or statusLine payload from the task's session: note the scratchpad
 * it names, and follow the task to a new folder (a new job, a new session).
 * Checks the dir's shape (claudeContract/); never throws into the hook path.
 */
export function noteScratchpad(taskId: string, payload: Record<string, unknown>): void {
  try {
    reportFindings('scratchpad', checkScratchpadDir(payload), claudeVersionFor(taskId));
    const dir = scratchpadFromPayload(payload);
    if (dir) named.set(taskId, dir);
    if (follow(taskId, taskScratchpadDir(taskId))) changed(taskId);
  } catch (err) {
    console.warn('[ScratchpadService] note failed:', err);
  }
}

/** The task's scratchpad and its files; null when it has had no session. */
export async function readTaskScratchpad(taskId: string): Promise<TaskScratchpad | null> {
  const dir = taskScratchpadDir(taskId);
  follow(taskId, dir);
  if (!dir) return null;
  served.add(dir);
  const exists = fs.existsSync(dir);
  return { dir, exists, listing: exists ? await listPlainFolder(dir) : { files: [], dirs: [] } };
}

/** Whether `dir` is a scratchpad this run showed (the editor opens it as plain files). */
export function isServedScratchpad(dir: string): boolean {
  return served.has(path.resolve(dir));
}

function arm(taskId: string, dir: string | null): () => void {
  if (!dir) return () => {};
  return watchFolder(dir, { debounceMs: DEBOUNCE_MS, onChange: () => changed(taskId) });
}

/** The Agent tab shows the task's scratchpad: tell it of changes until it unwatches. */
export function watchTaskScratchpad(taskId: string): void {
  const watch = watches.get(taskId);
  if (watch) {
    watch.refs++;
    return;
  }
  const dir = taskScratchpadDir(taskId);
  current.set(taskId, dir);
  watches.set(taskId, { dir, refs: 1, close: arm(taskId, dir) });
}

export function unwatchTaskScratchpad(taskId: string): void {
  const watch = watches.get(taskId);
  if (!watch || --watch.refs > 0) return;
  watch.close();
  watches.delete(taskId);
}

/** Close every watch (quit). */
export function stopScratchpadWatches(): void {
  for (const watch of watches.values()) watch.close();
  watches.clear();
}
