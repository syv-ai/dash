import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { writeFileAtomic } from '../utils/atomicWrite';
import type { SessionSettings } from './supervisorSession';

/** `<userData>/task-settings/<taskId>.json`: each task's `--settings` file. */
function settingsPath(taskId: string): string {
  return path.join(app.getPath('userData'), 'task-settings', `${taskId}.json`);
}

/**
 * Write the task's settings file and return its path. 0600, since `env`
 * carries the user's env vars. Rewritten on every session start, because the
 * supervisor re-reads it on each respawn of the job.
 */
export function writeTaskSettings(taskId: string, settings: SessionSettings): string {
  const file = settingsPath(taskId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileAtomic(file, JSON.stringify(settings, null, 2), { mode: 0o600 });
  return file;
}

export function removeTaskSettings(taskId: string): void {
  fs.rmSync(settingsPath(taskId), { force: true });
}
