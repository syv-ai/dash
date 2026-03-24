/**
 * SessionWatcherService — watches Claude Code's conversation JSONL files
 * for live updates and forwards parsed messages to the renderer.
 *
 * Improvements over inline ptyIpc watcher:
 * - Watches project directory for new session files (handles /clear, session rotation)
 * - Watches ~/.claude/projects/ for project dir creation (first-time tasks)
 * - Debounces fs.watch events (300ms) to avoid redundant reads
 * - Tracks partial line byte offset correctly
 * - Deduplicates entries by requestId (Claude writes multiple entries per streaming response)
 * - Clean standalone service with start/stop/getHistory API
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ── Types ───────────────────────────────────────────────────

export interface ChatHistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  >;
  timestamp: number;
  model?: string;
}

export type MessageCallback = (messages: ChatHistoryMessage[]) => void;
export type StatusCallback = (status: string | null) => void;

// ── Watcher State ───────────────────────────────────────────

const DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 500;

interface WatchEntry {
  id: string;
  cwd: string;
  projectDir: string | null;
  sessionFilePath: string | null;
  fileWatcher: fs.FSWatcher | null;
  dirWatcher: fs.FSWatcher | null;
  pollInterval: ReturnType<typeof setInterval> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  toolResultTimer: ReturnType<typeof setTimeout> | null;
  bytesRead: number;
  partialLine: string;
  /** Set of requestIds already seen — for dedup of streaming entries. */
  seenRequestIds: Set<string>;
  onMessages: MessageCallback;
  onStatus: StatusCallback;
}

const watchers = new Map<string, WatchEntry>();

// ── Project Directory Discovery ─────────────────────────────

function getProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/\//g, '-');
}

export function findProjectDir(taskPath: string): string | null {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) return null;

  // Strategy 1: path-based (slashes → hyphens)
  const pathBased = path.join(projectsDir, encodeProjectPath(taskPath));
  if (fs.existsSync(pathBased)) return pathBased;

  // Strategy 2: SHA-256 hash prefix
  const hashBased = path.join(
    projectsDir,
    crypto.createHash('sha256').update(taskPath).digest('hex').slice(0, 16),
  );
  if (fs.existsSync(hashBased)) return hashBased;

  // Strategy 3: partial path match (last 3 segments)
  try {
    const parts = taskPath.split('/').filter((p) => p.length > 0);
    const suffix = parts.slice(-3).join('-');
    const dirs = fs.readdirSync(projectsDir);
    for (const dir of dirs) {
      if (dir.includes(suffix)) return path.join(projectsDir, dir);
    }
  } catch {
    // Ignore
  }

  return null;
}

function findLatestSessionFile(projectDir: string): string | null {
  try {
    let latest: string | null = null;
    let latestMtime = 0;
    for (const file of fs.readdirSync(projectDir)) {
      if (!file.endsWith('.jsonl')) continue;
      const fullPath = path.join(projectDir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latest = fullPath;
        }
      } catch {
        // Skip inaccessible
      }
    }
    return latest;
  } catch {
    return null;
  }
}

// ── JSONL Parsing ───────────────────────────────────────────

function parseConversationEntry(entry: any, counter: number): ChatHistoryMessage | null {
  const type = entry.type;
  const msg = entry.message;

  if (type === 'user' && msg?.role === 'user') {
    if (entry.isMeta) return null;
    const content = normalizeContent(msg.content);
    if (content.length === 0) return null;
    return {
      id: entry.uuid || `msg-user-${counter}`,
      role: 'user',
      content,
      timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
    };
  }

  if (type === 'system' && typeof entry.content === 'string') {
    const text = entry.content.trim();
    if (text) {
      return {
        id: entry.uuid || `msg-sys-${counter}`,
        role: 'system',
        content: [{ type: 'text', text }],
        timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
      };
    }
  }

  if (type === 'assistant' && msg?.role === 'assistant') {
    const content = normalizeContent(msg.content);
    if (content.length === 0) return null;
    return {
      id: entry.uuid || `msg-asst-${counter}`,
      role: 'assistant',
      content,
      timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
      model: msg.model,
    };
  }

  return null;
}

function normalizeContent(raw: unknown): ChatHistoryMessage['content'] {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    return [{ type: 'text', text: trimmed }];
  }
  if (Array.isArray(raw)) {
    const blocks: ChatHistoryMessage['content'] = [];
    for (const block of raw) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        blocks.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        blocks.push({
          type: 'tool_use',
          id: block.id || '',
          name: block.name || '',
          input: block.input || {},
        });
      } else if (block.type === 'tool_result') {
        const content =
          typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content
                  .filter((c: any) => c?.type === 'text')
                  .map((c: any) => c.text)
                  .join('\n')
              : '';
        blocks.push({
          type: 'tool_result',
          tool_use_id: block.tool_use_id || '',
          content,
          is_error: block.is_error,
        });
      }
    }
    return blocks;
  }
  return [];
}

/** Format a human-readable status string from a tool_use block. */
function formatToolStatus(name: string, input: any): string {
  const fileName = (p: string) => p.split('/').pop() || p;
  switch (name) {
    case 'Read':
      return input?.file_path ? `Reading ${fileName(input.file_path)}` : 'Reading';
    case 'Edit':
      return input?.file_path ? `Editing ${fileName(input.file_path)}` : 'Editing';
    case 'Write':
      return input?.file_path ? `Writing ${fileName(input.file_path)}` : 'Writing';
    case 'Bash':
      return input?.command ? `Running \`${input.command.slice(0, 60)}\`` : 'Running command';
    case 'Glob':
      return input?.pattern ? `Searching for ${input.pattern}` : 'Searching files';
    case 'Grep':
      return input?.pattern ? `Searching for "${input.pattern}"` : 'Searching content';
    case 'Agent':
      return input?.description || 'Running subagent';
    case 'WebFetch':
      return input?.url ? `Fetching ${input.url.slice(0, 50)}` : 'Fetching web page';
    case 'WebSearch':
      return input?.query ? `Searching "${input.query.slice(0, 50)}"` : 'Searching web';
    case 'TaskCreate':
      return input?.subject ? `Creating task: ${input.subject.slice(0, 50)}` : 'Creating task';
    case 'TaskUpdate':
      return input?.status ? `Updating task #${input.taskId} → ${input.status}` : 'Updating task';
    case 'ToolSearch':
      return input?.query ? `Searching tools: "${input.query.slice(0, 50)}"` : 'Searching tools';
    default:
      return `Running ${name}`;
  }
}

// ── Incremental Reading ─────────────────────────────────────

function readIncrementalBytes(entry: WatchEntry): void {
  if (!entry.sessionFilePath) return;

  try {
    const stat = fs.statSync(entry.sessionFilePath);
    if (stat.size <= entry.bytesRead) return;

    const bytesToRead = stat.size - entry.bytesRead;
    const fd = fs.openSync(entry.sessionFilePath, 'r');
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, entry.bytesRead);
    fs.closeSync(fd);

    const rawData = entry.partialLine + buffer.toString('utf-8');
    const lines = rawData.split('\n');

    // Last element may be a partial line — buffer it
    entry.partialLine = lines.pop() ?? '';
    // Adjust bytesRead to account for the buffered partial line
    entry.bytesRead = stat.size - Buffer.byteLength(entry.partialLine, 'utf-8');

    const messages: ChatHistoryMessage[] = [];
    const toolResultMessages: ChatHistoryMessage[] = [];
    let counter = Date.now();
    let latestStatus: string | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line);

        // Deduplicate by requestId — Claude writes multiple entries during streaming
        if (raw.requestId && entry.seenRequestIds.has(raw.requestId)) continue;
        if (raw.requestId) entry.seenRequestIds.add(raw.requestId);

        const msg = parseConversationEntry(raw, counter++);
        if (msg) {
          // Separate tool_result messages for delayed delivery
          const isToolResultOnly =
            msg.role === 'user' && msg.content.every((b) => b.type === 'tool_result');
          if (isToolResultOnly) {
            toolResultMessages.push(msg);
          } else {
            messages.push(msg);
          }
        }

        // Extract status from assistant tool_use blocks (JSONL fallback for status)
        if (raw.type === 'assistant' && Array.isArray(raw.message?.content)) {
          for (const block of raw.message.content) {
            if (block?.type === 'tool_use' && block.name) {
              latestStatus = formatToolStatus(block.name, block.input);
            }
          }
        }
        if (raw.type === 'result') {
          latestStatus = null;
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (messages.length > 0) entry.onMessages(messages);
    if (latestStatus !== undefined) entry.onStatus(latestStatus);

    // Send tool_results after a delay so tool_use blocks render with amber spinner first
    if (toolResultMessages.length > 0) {
      if (entry.toolResultTimer) clearTimeout(entry.toolResultTimer);
      entry.toolResultTimer = setTimeout(() => {
        entry.onMessages(toolResultMessages);
        entry.toolResultTimer = null;
      }, 400);
    }
  } catch {
    // File may have been deleted/rotated
  }
}

// ── File & Directory Watching ───────────────────────────────

function startFileWatcher(entry: WatchEntry): void {
  if (!entry.sessionFilePath) return;

  if (entry.fileWatcher) {
    try {
      entry.fileWatcher.close();
    } catch {
      // Already closed
    }
  }

  try {
    entry.fileWatcher = fs.watch(entry.sessionFilePath, () => {
      // Debounce to avoid redundant reads on rapid writes
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        readIncrementalBytes(entry);
      }, DEBOUNCE_MS);
    });
    entry.fileWatcher.on('error', () => {});
  } catch {
    // Can't watch file
  }
}

function startDirWatcher(entry: WatchEntry): void {
  if (!entry.projectDir) return;

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

      const newFile = path.join(entry.projectDir!, filename);
      if (newFile === entry.sessionFilePath) return;

      // Check if this is a newer session file
      try {
        const newStat = fs.statSync(newFile);
        if (entry.sessionFilePath) {
          const currentStat = fs.statSync(entry.sessionFilePath);
          if (newStat.mtimeMs <= currentStat.mtimeMs) return;
        }
      } catch {
        return;
      }

      // Switch to the new session file
      entry.sessionFilePath = newFile;
      entry.bytesRead = 0;
      entry.partialLine = '';
      entry.seenRequestIds.clear();
      startFileWatcher(entry);
    });
    entry.dirWatcher.on('error', () => {});
  } catch {
    // Can't watch directory
  }
}

// ── Public API ──────────────────────────────────────────────

export function startWatching(
  id: string,
  cwd: string,
  onMessages: MessageCallback,
  onStatus: StatusCallback,
): void {
  stopWatching(id);

  const projectDir = findProjectDir(cwd);

  const entry: WatchEntry = {
    id,
    cwd,
    projectDir,
    sessionFilePath: null,
    fileWatcher: null,
    dirWatcher: null,
    pollInterval: null,
    debounceTimer: null,
    toolResultTimer: null,
    bytesRead: 0,
    partialLine: '',
    seenRequestIds: new Set(),
    onMessages,
    onStatus,
  };

  watchers.set(id, entry);

  if (!projectDir) {
    // No project dir yet — watch ~/.claude/projects/ for it to appear
    const projectsDir = getProjectsDir();
    if (!fs.existsSync(projectsDir)) return;

    const encodedName = encodeProjectPath(cwd);
    try {
      entry.dirWatcher = fs.watch(projectsDir, (_eventType, filename) => {
        if (filename !== encodedName) return;

        entry.projectDir = path.join(projectsDir, encodedName);
        if (entry.dirWatcher) {
          try {
            entry.dirWatcher.close();
          } catch {
            // Already closed
          }
        }

        const sessionFile = findLatestSessionFile(entry.projectDir);
        if (sessionFile) {
          entry.sessionFilePath = sessionFile;
          const stat = fs.statSync(sessionFile);
          entry.bytesRead = stat.size;
          startFileWatcher(entry);
        }
        startDirWatcher(entry);
      });
    } catch {
      // Can't watch projects dir
    }
    return;
  }

  // Find latest session file and start tailing from end
  const sessionFile = findLatestSessionFile(projectDir);
  if (sessionFile) {
    entry.sessionFilePath = sessionFile;
    try {
      entry.bytesRead = fs.statSync(sessionFile).size;
    } catch {
      // File may not exist yet
    }
    startFileWatcher(entry);
  }

  // Watch directory for new session files (e.g. after /clear)
  startDirWatcher(entry);

  // Polling fallback — fs.watch can miss events on some platforms
  entry.pollInterval = setInterval(() => readIncrementalBytes(entry), POLL_INTERVAL_MS);
}

export function stopWatching(id: string): void {
  const entry = watchers.get(id);
  if (!entry) return;

  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  if (entry.toolResultTimer) clearTimeout(entry.toolResultTimer);
  if (entry.pollInterval) clearInterval(entry.pollInterval);
  if (entry.fileWatcher) {
    try {
      entry.fileWatcher.close();
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
  watchers.delete(id);
}

export function stopAll(): void {
  for (const id of watchers.keys()) {
    stopWatching(id);
  }
}

/**
 * Read full conversation history from the latest JSONL file.
 * Supports pagination via limit/beforeIndex for lazy loading.
 */
export function readHistory(
  cwd: string,
  limit = 100,
  beforeIndex?: number,
): { messages: ChatHistoryMessage[]; totalCount: number; startIndex: number } {
  const projectDir = findProjectDir(cwd);
  if (!projectDir) return { messages: [], totalCount: 0, startIndex: 0 };

  const filePath = findLatestSessionFile(projectDir);
  if (!filePath) return { messages: [], totalCount: 0, startIndex: 0 };

  const content = fs.readFileSync(filePath, 'utf-8');
  const allMessages: ChatHistoryMessage[] = [];
  let counter = 0;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const msg = parseConversationEntry(entry, counter++);
      if (msg) allMessages.push(msg);
    } catch {
      // Skip malformed lines
    }
  }

  const totalCount = allMessages.length;
  const endIndex = beforeIndex !== undefined ? Math.min(beforeIndex, totalCount) : totalCount;
  const startIndex = Math.max(0, endIndex - limit);

  return {
    messages: allMessages.slice(startIndex, endIndex),
    totalCount,
    startIndex,
  };
}

/**
 * Force the watcher for the given id to switch to a new session file.
 * Called from SessionStart hook when /clear or new session is detected.
 */
export function resetSession(id: string): void {
  const entry = watchers.get(id);
  if (!entry || !entry.projectDir) return;

  const sessionFile = findLatestSessionFile(entry.projectDir);
  if (sessionFile && sessionFile !== entry.sessionFilePath) {
    entry.sessionFilePath = sessionFile;
    entry.bytesRead = 0;
    entry.partialLine = '';
    entry.seenRequestIds.clear();
    startFileWatcher(entry);
  }
}
