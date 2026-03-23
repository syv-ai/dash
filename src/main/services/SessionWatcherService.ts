import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { BrowserWindow } from 'electron';
import type {
  ParsedSessionMessage,
  SessionMetrics,
  SessionUpdate,
} from '../../shared/sessionTypes';
import {
  parseJsonlLine,
  deduplicateByRequestId,
  calculateMetrics,
  encodeProjectPath,
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

// =============================================================================
// Session File Discovery
// =============================================================================

function getProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Find the Claude projects directory for a given working directory path.
 * Tries multiple encoding strategies matching Claude Code's behavior.
 */
function findProjectDir(taskPath: string): string | null {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) return null;

  // Strategy 1: path-based directory name (slashes replaced with hyphens)
  const pathBasedName = encodeProjectPath(taskPath);
  const pathBased = path.join(projectsDir, pathBasedName);
  if (fs.existsSync(pathBased)) return pathBased;

  // Strategy 2: SHA-256 hash prefix
  const cwdHash = crypto.createHash('sha256').update(taskPath).digest('hex').slice(0, 16);
  const hashBased = path.join(projectsDir, cwdHash);
  if (fs.existsSync(hashBased)) return hashBased;

  // Strategy 3: Partial path match (last 3 segments)
  const cwdParts = taskPath.split('/').filter((p) => p.length > 0);
  const lastParts = cwdParts.slice(-3).join('-');
  try {
    const dirs = fs.readdirSync(projectsDir);
    for (const dir of dirs) {
      if (dir.includes(lastParts)) {
        return path.join(projectsDir, dir);
      }
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Find the most recently modified .jsonl session file in a project directory.
 */
function findLatestSessionFile(projectDir: string): string | null {
  try {
    const entries = fs.readdirSync(projectDir);
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
        // Skip inaccessible files
      }
    }

    return latestFile;
  } catch {
    return null;
  }
}

// =============================================================================
// Parsing
// =============================================================================

function parseFullFile(filePath: string): { messages: ParsedSessionMessage[]; bytesRead: number } {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    const lines = data.split('\n');
    const messages: ParsedSessionMessage[] = [];

    for (const line of lines) {
      const parsed = parseJsonlLine(line);
      if (parsed) {
        messages.push(parsed);
      }
    }

    return {
      messages: deduplicateByRequestId(messages),
      bytesRead: Buffer.byteLength(data, 'utf8'),
    };
  } catch {
    return { messages: [], bytesRead: 0 };
  }
}

function parseIncrementalBytes(entry: WatchEntry): ParsedSessionMessage[] {
  if (!entry.sessionFilePath) return [];

  try {
    const stat = fs.statSync(entry.sessionFilePath);
    if (stat.size <= entry.bytesRead) return [];

    const fd = fs.openSync(entry.sessionFilePath, 'r');
    const bytesToRead = stat.size - entry.bytesRead;
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, entry.bytesRead);
    fs.closeSync(fd);

    const rawData = entry.partialLine + buffer.toString('utf8');
    const lines = rawData.split('\n');

    // Last element may be a partial line — buffer it
    entry.partialLine = lines.pop() ?? '';
    entry.bytesRead = stat.size - Buffer.byteLength(entry.partialLine, 'utf8');

    const newMessages: ParsedSessionMessage[] = [];
    for (const line of lines) {
      const parsed = parseJsonlLine(line);
      if (parsed) {
        newMessages.push(parsed);
      }
    }

    return newMessages;
  } catch {
    return [];
  }
}

// =============================================================================
// Notification
// =============================================================================

function notifyRenderers(update: SessionUpdate): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('session:update', update);
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

// =============================================================================
// File Watching
// =============================================================================

function startFileWatcher(entry: WatchEntry): void {
  if (!entry.sessionFilePath) return;

  // Close existing file watcher
  if (entry.watcher) {
    try {
      entry.watcher.close();
    } catch {
      // Already closed
    }
  }

  try {
    entry.watcher = fs.watch(entry.sessionFilePath, () => {
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
      }

      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        const newMessages = parseIncrementalBytes(entry);
        if (newMessages.length > 0) {
          // Deduplicate: remove earlier entries with same requestId
          const existingByRequestId = new Map<string, number>();
          for (let i = 0; i < entry.messages.length; i++) {
            const rid = entry.messages[i].requestId;
            if (rid) existingByRequestId.set(rid, i);
          }

          const toAppend: ParsedSessionMessage[] = [];
          for (const msg of newMessages) {
            if (msg.requestId && existingByRequestId.has(msg.requestId)) {
              // Replace the existing entry in-place
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
        }
      }, DEBOUNCE_MS);
    });

    entry.watcher.on('error', () => {
      // Watcher errored — try to recover silently
    });
  } catch {
    // Can't watch file
  }
}

function startDirWatcher(entry: WatchEntry): void {
  if (!entry.projectDir) return;

  // Close existing dir watcher
  if (entry.dirWatcher) {
    try {
      entry.dirWatcher.close();
    } catch {
      // Already closed
    }
  }

  try {
    entry.dirWatcher = fs.watch(entry.projectDir, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return;

      // A new session file appeared — check if it's newer
      const newFile = path.join(entry.projectDir, filename);
      if (newFile === entry.sessionFilePath) return;

      try {
        const newStat = fs.statSync(newFile);
        if (entry.sessionFilePath) {
          const currentStat = fs.statSync(entry.sessionFilePath);
          if (newStat.mtimeMs <= currentStat.mtimeMs) return;
        }

        // Switch to the new session file
        entry.sessionFilePath = newFile;
        entry.bytesRead = 0;
        entry.partialLine = '';

        const { messages, bytesRead } = parseFullFile(newFile);
        entry.messages = messages;
        entry.bytesRead = bytesRead;

        startFileWatcher(entry);
        notifyRenderers(buildUpdate(entry, [], false));
      } catch {
        // Ignore
      }
    });

    entry.dirWatcher.on('error', () => {
      // Dir watcher errored
    });
  } catch {
    // Can't watch directory
  }
}

// =============================================================================
// Public API
// =============================================================================

export function startWatching(taskId: string, taskPath: string): void {
  // Don't double-watch
  if (watchers.has(taskId)) return;

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
    // No project dir yet — watch the projects root for it to appear
    const projectsDir = getProjectsDir();
    if (fs.existsSync(projectsDir)) {
      const encodedName = encodeProjectPath(taskPath);
      try {
        entry.dirWatcher = fs.watch(projectsDir, (_eventType, filename) => {
          if (filename === encodedName) {
            // Project dir appeared
            entry.projectDir = path.join(projectsDir, encodedName);

            // Close root watcher, start proper watchers
            if (entry.dirWatcher) {
              try {
                entry.dirWatcher.close();
              } catch {
                // Already closed
              }
              entry.dirWatcher = null;
            }

            // Look for session files
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
          }
        });
      } catch {
        // Can't watch projects dir
      }
    }
    return;
  }

  // Find latest session file
  const sessionFile = findLatestSessionFile(projectDir);
  if (sessionFile) {
    entry.sessionFilePath = sessionFile;
    const { messages, bytesRead } = parseFullFile(sessionFile);
    entry.messages = messages;
    entry.bytesRead = bytesRead;
    startFileWatcher(entry);
  }

  // Also watch directory for new session files
  startDirWatcher(entry);

  // Send initial data
  notifyRenderers(buildUpdate(entry, [], false));
}

export function stopWatching(taskId: string): void {
  const entry = watchers.get(taskId);
  if (!entry) return;

  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  if (entry.watcher) {
    try {
      entry.watcher.close();
    } catch {
      // Already closed
    }
  }
  if (entry.dirWatcher) {
    try {
      entry.dirWatcher.close();
    } catch {
      // Already closed
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

/**
 * Parse a subagent JSONL file for a given session.
 */
export function getSubagentData(
  taskId: string,
  agentId: string,
): { messages: ParsedSessionMessage[]; metrics: SessionMetrics } | null {
  const entry = watchers.get(taskId);
  if (!entry || !entry.sessionFilePath) return null;

  const sessionId = path.basename(entry.sessionFilePath, '.jsonl');
  const sessionDir = path.join(entry.projectDir, sessionId);

  // Try new structure: {sessionId}/subagents/agent_{agentId}.jsonl
  const subagentsDir = path.join(sessionDir, 'subagents');
  let agentFile = path.join(subagentsDir, `agent_${agentId}.jsonl`);

  if (!fs.existsSync(agentFile)) {
    // Try alternate: {sessionId}/agent_{agentId}.jsonl
    agentFile = path.join(sessionDir, `agent_${agentId}.jsonl`);
  }

  if (!fs.existsSync(agentFile)) {
    // Try: agent-{agentId}.jsonl pattern
    agentFile = path.join(subagentsDir, `agent-${agentId}.jsonl`);
    if (!fs.existsSync(agentFile)) {
      agentFile = path.join(sessionDir, `agent-${agentId}.jsonl`);
    }
  }

  if (!fs.existsSync(agentFile)) return null;

  const { messages } = parseFullFile(agentFile);
  return { messages, metrics: calculateMetrics(messages) };
}
