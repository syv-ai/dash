import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import type {
  ParsedSessionMessage,
  SessionMetrics,
  SessionUpdate,
} from '../../shared/sessionTypes';
import {
  parseJsonlLine,
  calculateMetrics,
  encodeProjectPath,
  getProjectsDir,
  parseSessionFile,
} from '../utils/jsonlParser';

const DEBOUNCE_MS = 300;

interface WatchEntry {
  taskId: string;
  projectDir: string;
  sessionFilePath: string | null;
  watcher: fs.FSWatcher | null;
  dirWatcher: fs.FSWatcher | null;
  bytesRead: number;
  partialLine: string;
  messages: ParsedSessionMessage[];
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

const watchers = new Map<string, WatchEntry>();

/**
 * Resolve Claude's project dir for a cwd by exact path encoding only.
 * SHA-prefix and partial-segment fallbacks were intentionally removed (PR #117/#124):
 * shared trailing segments across worktrees would otherwise return a foreign
 * project's dir and surface another task's sessions.
 */
function findProjectDir(taskPath: string): string | null {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) return null;
  const pathBased = path.join(projectsDir, encodeProjectPath(taskPath));
  return fs.existsSync(pathBased) ? pathBased : null;
}

function findLatestSessionFile(projectDir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(projectDir);
  } catch (err) {
    console.warn('[SessionWatcher.findLatestSessionFile] readdir failed', { projectDir, err });
    return null;
  }

  let latestFile: string | null = null;
  let latestMtime = 0;

  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;
    const fullPath = path.join(projectDir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestFile = fullPath;
      }
    } catch {
      // File vanished between readdir and stat — race is benign, skip.
    }
  }

  return latestFile;
}

function parseFullFile(filePath: string): { messages: ParsedSessionMessage[]; bytesRead: number } {
  return parseSessionFile(filePath) ?? { messages: [], bytesRead: 0 };
}

function parseIncrementalBytes(entry: WatchEntry): ParsedSessionMessage[] {
  if (!entry.sessionFilePath) return [];

  let stat: fs.Stats;
  try {
    stat = fs.statSync(entry.sessionFilePath);
  } catch (err) {
    console.warn('[SessionWatcher.parseIncrementalBytes] stat failed', {
      file: entry.sessionFilePath,
      err,
    });
    return [];
  }
  if (stat.size <= entry.bytesRead) return [];

  // Read with a try/finally so the fd is always released, even if the read
  // itself throws. Advance bytesRead BEFORE parsing so a parse error doesn't
  // cause us to re-read the same bytes on the next watcher tick.
  let rawData: string;
  let fd: number | null = null;
  try {
    fd = fs.openSync(entry.sessionFilePath, 'r');
    const bytesToRead = stat.size - entry.bytesRead;
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, entry.bytesRead);
    rawData = entry.partialLine + buffer.toString('utf8');
  } catch (err) {
    console.warn('[SessionWatcher.parseIncrementalBytes] read failed', {
      file: entry.sessionFilePath,
      err,
    });
    return [];
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // fd may already be closed if readSync threw post-open
      }
    }
  }

  const lines = rawData.split('\n');
  entry.partialLine = lines.pop() ?? '';
  entry.bytesRead = stat.size - Buffer.byteLength(entry.partialLine, 'utf8');

  const newMessages: ParsedSessionMessage[] = [];
  for (const line of lines) {
    const parsed = parseJsonlLine(line);
    if (parsed) newMessages.push(parsed);
  }
  return newMessages;
}

function notifyRenderers(update: SessionUpdate): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send('session:update', update);
    } catch (err) {
      // Window destroyed between isDestroyed check and send — race is benign.
      console.warn('[SessionWatcher.notifyRenderers] send failed', err);
    }
  }
}

function buildUpdate(
  entry: WatchEntry,
  newMessages: ParsedSessionMessage[],
  isIncremental: boolean,
): SessionUpdate {
  const sessionId = entry.sessionFilePath ? path.basename(entry.sessionFilePath, '.jsonl') : '';
  return {
    sessionId,
    taskId: entry.taskId,
    messages: isIncremental ? newMessages : entry.messages,
    metrics: calculateMetrics(entry.messages),
    isIncremental,
  };
}

function startFileWatcher(entry: WatchEntry): void {
  if (!entry.sessionFilePath) return;

  if (entry.watcher) {
    try {
      entry.watcher.close();
    } catch {
      // already closed
    }
  }

  try {
    entry.watcher = fs.watch(entry.sessionFilePath, () => {
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);

      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        const newMessages = parseIncrementalBytes(entry);
        if (newMessages.length === 0) return;

        const existingByRequestId = new Map<string, number>();
        for (let i = 0; i < entry.messages.length; i++) {
          const rid = entry.messages[i].requestId;
          if (rid) existingByRequestId.set(rid, i);
        }

        const toAppend: ParsedSessionMessage[] = [];
        for (const msg of newMessages) {
          if (msg.requestId && existingByRequestId.has(msg.requestId)) {
            const idx = existingByRequestId.get(msg.requestId)!;
            entry.messages[idx] = msg;
          } else {
            toAppend.push(msg);
            if (msg.requestId) {
              existingByRequestId.set(msg.requestId, entry.messages.length + toAppend.length - 1);
            }
          }
        }

        entry.messages.push(...toAppend);
        notifyRenderers(buildUpdate(entry, newMessages, true));
      }, DEBOUNCE_MS);
    });

    entry.watcher.on('error', (err) => {
      console.warn('[SessionWatcher] file watcher error', { taskId: entry.taskId, err });
    });
  } catch (err) {
    console.warn('[SessionWatcher] failed to attach file watcher', {
      file: entry.sessionFilePath,
      err,
    });
  }
}

function startDirWatcher(entry: WatchEntry): void {
  if (!entry.projectDir) return;

  if (entry.dirWatcher) {
    try {
      entry.dirWatcher.close();
    } catch {
      // already closed
    }
  }

  try {
    entry.dirWatcher = fs.watch(entry.projectDir, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return;

      const newFile = path.join(entry.projectDir, filename);
      if (newFile === entry.sessionFilePath) return;

      let newStat: fs.Stats;
      try {
        newStat = fs.statSync(newFile);
      } catch {
        return; // file vanished or permission denied — benign
      }
      if (entry.sessionFilePath) {
        try {
          const currentStat = fs.statSync(entry.sessionFilePath);
          if (newStat.mtimeMs <= currentStat.mtimeMs) return;
        } catch {
          // current file vanished — fall through and switch
        }
      }

      entry.sessionFilePath = newFile;
      entry.bytesRead = 0;
      entry.partialLine = '';

      const { messages, bytesRead } = parseFullFile(newFile);
      entry.messages = messages;
      entry.bytesRead = bytesRead;

      startFileWatcher(entry);
      notifyRenderers(buildUpdate(entry, [], false));
    });

    entry.dirWatcher.on('error', (err) => {
      console.warn('[SessionWatcher] dir watcher error', { taskId: entry.taskId, err });
    });
  } catch (err) {
    console.warn('[SessionWatcher] failed to attach dir watcher', {
      projectDir: entry.projectDir,
      err,
    });
  }
}

export type StartWatchingResult = { ok: true } | { ok: false; error: string };

export function startWatching(taskId: string, taskPath: string): StartWatchingResult {
  if (watchers.has(taskId)) return { ok: true };

  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) {
    return {
      ok: false,
      error:
        'Claude Code projects directory not found at ~/.claude/projects. Has Claude Code been run yet?',
    };
  }

  const projectDir = findProjectDir(taskPath);

  const entry: WatchEntry = {
    taskId,
    projectDir: projectDir ?? '',
    sessionFilePath: null,
    watcher: null,
    dirWatcher: null,
    bytesRead: 0,
    partialLine: '',
    messages: [],
    debounceTimer: null,
  };

  watchers.set(taskId, entry);

  if (!projectDir) {
    // Encoded folder doesn't exist yet — wait for it to appear via the projects-root watcher.
    const encodedName = encodeProjectPath(taskPath);
    try {
      entry.dirWatcher = fs.watch(projectsDir, (_eventType, filename) => {
        if (filename !== encodedName) return;

        entry.projectDir = path.join(projectsDir, encodedName);
        if (entry.dirWatcher) {
          try {
            entry.dirWatcher.close();
          } catch {
            // already closed
          }
          entry.dirWatcher = null;
        }

        const sessionFile = findLatestSessionFile(entry.projectDir);
        if (sessionFile) {
          entry.sessionFilePath = sessionFile;
          const { messages, bytesRead } = parseFullFile(sessionFile);
          entry.messages = messages;
          entry.bytesRead = bytesRead;
          startFileWatcher(entry);
          notifyRenderers(buildUpdate(entry, [], false));
        }

        startDirWatcher(entry);
      });
    } catch (err) {
      watchers.delete(taskId);
      return {
        ok: false,
        error: `Failed to watch projects dir: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return { ok: true };
  }

  const sessionFile = findLatestSessionFile(projectDir);
  if (sessionFile) {
    entry.sessionFilePath = sessionFile;
    const { messages, bytesRead } = parseFullFile(sessionFile);
    entry.messages = messages;
    entry.bytesRead = bytesRead;
    startFileWatcher(entry);
  }

  startDirWatcher(entry);
  return { ok: true };
}

export function stopWatching(taskId: string): void {
  const entry = watchers.get(taskId);
  if (!entry) return;

  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  if (entry.watcher) {
    try {
      entry.watcher.close();
    } catch {
      // already closed
    }
  }
  if (entry.dirWatcher) {
    try {
      entry.dirWatcher.close();
    } catch {
      // already closed
    }
  }

  watchers.delete(taskId);
}

export function stopAll(): void {
  for (const [id] of watchers) {
    stopWatching(id);
  }
}

export function getSessionData(
  taskId: string,
): { messages: ParsedSessionMessage[]; metrics: SessionMetrics } | null {
  const entry = watchers.get(taskId);
  if (!entry) return null;
  return {
    messages: entry.messages,
    metrics: calculateMetrics(entry.messages),
  };
}
