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
import { deriveScratchpadDir, scratchpadFromPayload } from './scratchpad';

/**
 * Each task's Claude Code scratchpad, for the task sidebar's Agent tab. The
 * dir is the last one the task's session named (SessionStart's inbox hook
 * first, then every statusLine), kept after the session sleeps or ends;
 * before any payload this run, it is derived from the task's recorded
 * session (`scratchpad.ts`). A resumed session keeps its id, so its
 * scratchpad too (checked live, 2.1.332). The renderer names a task, never a
 * path: main resolves the dir itself.
 */

const DEBOUNCE_MS = 200;
const CHANGED = 'agent:scratchpadChanged';

/** The last dir a payload named, per task. */
const named = new Map<string, string>();
/** Dirs this run handed the renderer: the editor lists these as plain files. */
const served = new Set<string>();

interface Watch {
  /** Null until the task has a scratchpad dir (its first session's payload). */
  dir: string | null;
  refs: number;
  close: () => void;
}
const watches = new Map<string, Watch>();

function changed(taskId: string): void {
  broadcast(CHANGED, { taskId });
}

/** The task's scratchpad dir: named by a payload, else derived; null when neither. */
export function taskScratchpadDir(taskId: string): string | null {
  const known = named.get(taskId);
  if (known) return known;
  const task = DatabaseService.getTask(taskId);
  if (!task?.sessionId) return null;
  return deriveScratchpadDir(task.path, task.sessionId, {
    platform: process.platform,
    uid: process.getuid?.(),
    tmpOverride: process.env.CLAUDE_CODE_TMPDIR,
    osTmp: os.tmpdir(),
  });
}

/**
 * A hook or statusLine payload from the task's session: note the scratchpad
 * it names. Checks its shape against the derived layout (claudeContract/);
 * never throws into the hook path.
 */
export function noteScratchpad(taskId: string, payload: Record<string, unknown>): void {
  try {
    reportFindings('scratchpad', checkScratchpadDir(payload), claudeVersionFor(taskId));
    const dir = scratchpadFromPayload(payload);
    if (!dir || named.get(taskId) === dir) return;
    named.set(taskId, dir);
    const watch = watches.get(taskId);
    if (watch && watch.dir !== dir) {
      watch.close();
      watch.dir = dir;
      watch.close = arm(taskId, dir);
    }
    changed(taskId);
  } catch (err) {
    console.warn('[ScratchpadService] note failed:', err);
  }
}

/** The task's scratchpad and its files; null when it has had no session. */
export async function readTaskScratchpad(taskId: string): Promise<TaskScratchpad | null> {
  const dir = taskScratchpadDir(taskId);
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
