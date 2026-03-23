import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  startDirectPty,
  startPty,
  writePty,
  resizePty,
  killPty,
  killByOwner,
  writeTaskContext,
  sendRemoteControl,
} from '../services/ptyManager';
import { terminalSnapshotService } from '../services/TerminalSnapshotService';
import { activityMonitor } from '../services/ActivityMonitor';
import { remoteControlService } from '../services/remoteControlService';
import { TelemetryService } from '../services/TelemetryService';

export function registerPtyIpc(): void {
  ipcMain.handle(
    'pty:startDirect',
    async (
      event,
      args: {
        id: string;
        cwd: string;
        cols: number;
        rows: number;
        autoApprove?: boolean;
        resume?: boolean;
        isDark?: boolean;
      },
    ) => {
      try {
        const result = await startDirectPty({
          ...args,
          sender: event.sender,
        });
        TelemetryService.capture('terminal_started', { source: 'direct' });
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'pty:start',
    async (event, args: { id: string; cwd: string; cols: number; rows: number }) => {
      try {
        const result = await startPty({
          ...args,
          sender: event.sender,
        });
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Fire-and-forget channels (ipcMain.on instead of handle)
  ipcMain.on('pty:input', (_event, args: { id: string; data: string }) => {
    writePty(args.id, args.data);
  });

  ipcMain.on('pty:resize', (_event, args: { id: string; cols: number; rows: number }) => {
    resizePty(args.id, args.cols, args.rows);
  });

  ipcMain.on('pty:kill', (_event, id: string) => {
    killPty(id);
  });

  // Snapshot handlers
  ipcMain.handle('pty:snapshot:get', async (_event, id: string) => {
    try {
      const data = await terminalSnapshotService.getSnapshot(id);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.on('pty:snapshot:save', (_event, id: string, payload: unknown) => {
    try {
      terminalSnapshotService.saveSnapshot(id, payload as any);
    } catch {
      // Best effort — fire-and-forget from beforeunload
    }
  });

  ipcMain.handle('pty:snapshot:clear', async (_event, id: string) => {
    try {
      await terminalSnapshotService.deleteSnapshot(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Check if a Claude session exists for a given working directory
  ipcMain.handle('pty:hasClaudeSession', async (_event, cwd: string) => {
    try {
      return { success: true, data: hasClaudeSession(cwd) };
    } catch (error) {
      return { success: false, data: false, error: String(error) };
    }
  });

  // Read conversation history from Claude's JSONL files
  ipcMain.handle(
    'pty:chatHistory',
    async (_event, args: { cwd: string; limit?: number; beforeIndex?: number }) => {
      try {
        return {
          success: true,
          data: readConversationHistory(args.cwd, args.limit, args.beforeIndex),
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Watch a JSONL conversation file for new entries
  ipcMain.handle('pty:chatWatch', (event, args: { id: string; cwd: string }) => {
    try {
      startChatWatcher(args.id, args.cwd, event.sender);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.on('pty:chatUnwatch', (_event, id: string) => {
    stopChatWatcher(id);
  });

  // Discover dynamic slash commands (skills, plugins, MCP prompts)
  ipcMain.handle('pty:discoverCommands', async (_event, projectCwd: string) => {
    try {
      return { success: true, data: discoverDynamicCommands(projectCwd) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Write task context for SessionStart hook
  ipcMain.handle(
    'pty:writeTaskContext',
    (
      _event,
      args: {
        cwd: string;
        prompt: string;
        meta?: import('@shared/types').TaskContextMeta;
      },
    ) => {
      try {
        writeTaskContext(args.cwd, args.prompt, args.meta);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Activity monitor
  ipcMain.handle('pty:activity:getAll', () => {
    return { success: true, data: activityMonitor.getAll() };
  });

  // Remote control
  ipcMain.handle('pty:remoteControl:enable', (_event, ptyId: string) => {
    try {
      sendRemoteControl(ptyId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('pty:remoteControl:getAllStates', () => {
    return { success: true, data: remoteControlService.getAllStates() };
  });
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

// ── JSONL Chat Watcher ──────────────────────────────────────

interface ChatWatcher {
  interval: ReturnType<typeof setInterval>;
  fsWatcher: fs.FSWatcher | null;
  filePath: string;
  byteOffset: number;
  lineBuffer: string;
  /** Timer for delayed tool_result flush. */
  toolResultTimer: ReturnType<typeof setTimeout> | null;
}

const chatWatchers = new Map<string, ChatWatcher>();

function startChatWatcher(id: string, cwd: string, sender: Electron.WebContents): void {
  // Stop existing watcher for this id
  stopChatWatcher(id);

  const projectDir = findClaudeProjectDir(cwd);
  if (!projectDir) return;

  const filePath = findNewestJsonl(projectDir);
  if (!filePath) return;

  // Start tailing from end of file
  let byteOffset = 0;
  try {
    const stat = fs.statSync(filePath);
    byteOffset = stat.size;
  } catch {
    // File may not exist yet
  }

  const readNewEntries = () => {
    try {
      const watcher = chatWatchers.get(id);
      if (!watcher) return;

      const stat = fs.statSync(filePath);
      if (stat.size <= byteOffset) return;

      const newBytes = stat.size - byteOffset;
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(newBytes);
      fs.readSync(fd, buf, 0, buf.length, byteOffset);
      fs.closeSync(fd);
      byteOffset = stat.size;

      const newText = (watcher.lineBuffer || '') + buf.toString('utf-8');
      const lines = newText.split('\n');
      // Keep the last (possibly incomplete) line in the buffer — but if
      // it's valid JSON, include it (the file may not end with \n yet)
      const lastLine = lines.pop() || '';
      if (lastLine.trim()) {
        try {
          JSON.parse(lastLine);
          // Valid JSON — include it as a complete line
          lines.push(lastLine);
          watcher.lineBuffer = '';
        } catch {
          // Incomplete — keep in buffer for next read
          watcher.lineBuffer = lastLine;
        }
      } else {
        watcher.lineBuffer = '';
      }

      const messages: ChatHistoryMessage[] = [];
      const toolResultMessages: ChatHistoryMessage[] = [];
      let counter = Date.now();
      let latestStatus: string | null = null;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const msg = parseConversationEntry(entry, counter++);
          if (msg) {
            // Separate tool_result messages so tool_use blocks render first
            const isToolResultOnly =
              msg.role === 'user' && msg.content.every((b) => b.type === 'tool_result');
            if (isToolResultOnly) {
              toolResultMessages.push(msg);
            } else {
              messages.push(msg);
            }
          }

          // Extract status from assistant tool_use blocks
          if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
            for (const block of entry.message.content) {
              if (block?.type === 'tool_use' && block.name) {
                latestStatus = formatToolStatus(block.name, block.input);
              }
            }
          }
          // Clear status on result/progress indicating turn end
          if (entry.type === 'result') {
            latestStatus = null;
          }
        } catch {
          // Skip malformed lines
        }
      }

      if (!sender.isDestroyed()) {
        if (messages.length > 0) {
          sender.send(`pty:chatMessages:${id}`, messages);
        }
        if (latestStatus !== undefined) {
          sender.send(`pty:chatStatus:${id}`, latestStatus);
        }
        // Send tool_results after a delay so the UI renders tool_use with
        // amber spinner first, then updates to green dot when results arrive.
        if (toolResultMessages.length > 0) {
          if (watcher.toolResultTimer) clearTimeout(watcher.toolResultTimer);
          watcher.toolResultTimer = setTimeout(() => {
            if (!sender.isDestroyed()) {
              sender.send(`pty:chatMessages:${id}`, toolResultMessages);
            }
            if (watcher) watcher.toolResultTimer = null;
          }, 400);
        }
      }
    } catch {
      // File may have been deleted/rotated
    }
  };

  // Use fs.watch for immediate notification, plus a polling fallback
  let fsWatcher: fs.FSWatcher | null = null;
  try {
    fsWatcher = fs.watch(filePath, () => readNewEntries());
  } catch {
    // fs.watch not available on some platforms
  }

  // Poll every 500ms as fallback (fs.watch can miss events)
  const interval = setInterval(readNewEntries, 500);

  chatWatchers.set(id, {
    interval,
    fsWatcher,
    filePath,
    byteOffset,
    lineBuffer: '',
    toolResultTimer: null,
  });
}

function stopChatWatcher(id: string): void {
  const watcher = chatWatchers.get(id);
  if (watcher) {
    clearInterval(watcher.interval);
    if (watcher.toolResultTimer) clearTimeout(watcher.toolResultTimer);
    watcher.fsWatcher?.close();
    chatWatchers.delete(id);
  }
}

/** Parse a single JSONL entry into a ChatHistoryMessage, or null if not relevant. */
function parseConversationEntry(entry: any, counter: number): ChatHistoryMessage | null {
  const type = entry.type;
  const msg = entry.message;

  if (type === 'user' && msg?.role === 'user') {
    if (entry.isMeta) return null;
    const rawContent = msg.content;
    // Allow <command-name> messages through — rendered as cards in the chat UI
    const content = normalizeContent(rawContent);
    if (content.length === 0) return null;
    return {
      id: entry.uuid || `live-user-${counter}`,
      role: 'user',
      content,
      timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
    };
  }

  // System entries: local command output and slash command entries
  if (type === 'system' && typeof entry.content === 'string') {
    const content = entry.content.trim();
    if (content) {
      return {
        id: entry.uuid || `live-sys-${counter}`,
        role: 'system',
        content: [{ type: 'text', text: content }],
        timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
      };
    }
  }

  if (type === 'assistant' && msg?.role === 'assistant') {
    const content = normalizeContent(msg.content);
    if (content.length === 0) return null;
    return {
      id: entry.uuid || `live-asst-${counter}`,
      role: 'assistant',
      content,
      timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
      model: msg.model,
    };
  }

  return null;
}

function findNewestJsonl(projectDir: string): string | null {
  const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
  if (files.length === 0) return null;

  let newest = '';
  let newestMtime = 0;
  for (const file of files) {
    const stat = fs.statSync(path.join(projectDir, file));
    if (stat.mtimeMs > newestMtime) {
      newestMtime = stat.mtimeMs;
      newest = file;
    }
  }
  return newest ? path.join(projectDir, newest) : null;
}

// ── Chat History ────────────────────────────────────────────

interface ChatHistoryMessage {
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

/**
 * Find the Claude projects directory for a given cwd.
 * Returns the path if found, null otherwise.
 */
function findClaudeProjectDir(cwd: string): string | null {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  // Check path-based directory name (slashes replaced with hyphens)
  const pathBasedName = cwd.replace(/\//g, '-');
  const pathBased = path.join(projectsDir, pathBasedName);
  if (fs.existsSync(pathBased)) return pathBased;

  // Check hash-based directory name
  const cwdHash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16);
  const hashBased = path.join(projectsDir, cwdHash);
  if (fs.existsSync(hashBased)) return hashBased;

  return null;
}

/**
 * Read conversation history from Claude's JSONL files for the given cwd.
 *
 * @param limit - Max messages to return (from the end). Default: 100.
 * @param beforeIndex - If provided, return messages before this index in the
 *   full message list (for loading older pages). 0-based.
 * @returns { messages, totalCount, startIndex } where startIndex is the
 *   index of the first returned message in the full list.
 */
function readConversationHistory(
  cwd: string,
  limit = 100,
  beforeIndex?: number,
): { messages: ChatHistoryMessage[]; totalCount: number; startIndex: number } {
  const projectDir = findClaudeProjectDir(cwd);
  if (!projectDir) return { messages: [], totalCount: 0, startIndex: 0 };

  const filePath = findNewestJsonl(projectDir);
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
 * Normalize Claude JSONL message content into ChatContentBlock[].
 */
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

interface DynamicCommand {
  command: string;
  description: string;
  source: 'skill' | 'plugin' | 'mcp';
  interactive?: boolean;
}

/**
 * Discover dynamic slash commands from skills, plugins, and MCP servers.
 */
function discoverDynamicCommands(projectCwd: string): DynamicCommand[] {
  const commands: DynamicCommand[] = [];
  const home = os.homedir();
  const claudeDir = path.join(home, '.claude');

  // 1. User skills (~/.claude/skills/*/SKILL.md)
  const userSkillsDir = path.join(claudeDir, 'skills');
  if (fs.existsSync(userSkillsDir)) {
    try {
      for (const dir of fs.readdirSync(userSkillsDir)) {
        const skillFile = path.join(userSkillsDir, dir, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          const desc = parseSkillDescription(skillFile);
          commands.push({
            command: `/${dir}`,
            description: desc || 'User skill',
            source: 'skill',
          });
        }
      }
    } catch {
      // Best effort
    }
  }

  // 2. Project skills (.claude/skills/*/SKILL.md)
  const projectSkillsDir = path.join(projectCwd, '.claude', 'skills');
  if (fs.existsSync(projectSkillsDir)) {
    try {
      for (const dir of fs.readdirSync(projectSkillsDir)) {
        const skillFile = path.join(projectSkillsDir, dir, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          const desc = parseSkillDescription(skillFile);
          // Don't duplicate if already added from user skills
          if (!commands.some((c) => c.command === `/${dir}`)) {
            commands.push({
              command: `/${dir}`,
              description: desc || 'Project skill',
              source: 'skill',
            });
          }
        }
      }
    } catch {
      // Best effort
    }
  }

  // 3. Enabled plugin skills/commands
  const settingsFile = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(settingsFile)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      const enabledPlugins = settings.enabledPlugins || {};
      for (const pluginKey of Object.keys(enabledPlugins)) {
        if (!enabledPlugins[pluginKey]) continue;
        const [pluginName, marketplace] = pluginKey.split('@');
        if (!marketplace) continue;

        // Find the plugin's latest cache dir
        const cacheDir = path.join(claudeDir, 'plugins', 'cache', marketplace, pluginName);
        if (!fs.existsSync(cacheDir)) continue;

        // Get the most recently modified version
        const versions = fs.readdirSync(cacheDir).map((v) => ({
          name: v,
          mtime: fs.statSync(path.join(cacheDir, v)).mtimeMs,
        }));
        versions.sort((a, b) => b.mtime - a.mtime);
        if (versions.length === 0) continue;

        const pluginDir = path.join(cacheDir, versions[0].name);

        // Scan for commands/*.md
        const commandsDir = path.join(pluginDir, 'commands');
        if (fs.existsSync(commandsDir)) {
          for (const file of fs.readdirSync(commandsDir)) {
            if (!file.endsWith('.md')) continue;
            const cmdName = file.replace(/\.md$/, '');
            const desc = parseSkillDescription(path.join(commandsDir, file));
            commands.push({
              command: `/${pluginName}:${cmdName}`,
              description: desc || `Plugin command`,
              source: 'plugin',
            });
          }
        }

        // Scan for skills/*/SKILL.md
        const skillsDir = path.join(pluginDir, 'skills');
        if (fs.existsSync(skillsDir)) {
          for (const dir of fs.readdirSync(skillsDir)) {
            const skillFile = path.join(skillsDir, dir, 'SKILL.md');
            if (fs.existsSync(skillFile)) {
              const desc = parseSkillDescription(skillFile);
              commands.push({
                command: `/${pluginName}:${dir}`,
                description: desc || `Plugin skill`,
                source: 'plugin',
              });
            }
          }
        }
      }
    } catch {
      // Best effort
    }
  }

  // 4. MCP server prompts (listed by server name, prompts aren't discoverable without connecting)
  for (const mcpFile of [path.join(claudeDir, 'mcp.json'), path.join(projectCwd, '.mcp.json')]) {
    if (fs.existsSync(mcpFile)) {
      try {
        const mcpConfig = JSON.parse(fs.readFileSync(mcpFile, 'utf-8'));
        for (const serverName of Object.keys(mcpConfig.mcpServers || {})) {
          commands.push({
            command: `/mcp__${serverName.replace(/\s+/g, '_')}`,
            description: `MCP server: ${serverName}`,
            source: 'mcp',
            interactive: true,
          });
        }
      } catch {
        // Best effort
      }
    }
  }

  return commands;
}

/** Extract description from SKILL.md or command .md YAML frontmatter. */
function parseSkillDescription(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const descMatch = fmMatch[1].match(/description:\s*["']?(.*?)["']?\s*$/m);
      if (descMatch) return descMatch[1].slice(0, 100);
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Check if Claude Code has an existing session for the given working directory.
 * Claude stores sessions in ~/.claude/projects/ with various naming schemes.
 */
function hasClaudeSession(cwd: string): boolean {
  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return false;

    // Check hash-based directory name
    const cwdHash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16);
    if (fs.existsSync(path.join(projectsDir, cwdHash))) return true;

    // Check path-based directory name (slashes replaced with hyphens)
    const pathBasedName = cwd.replace(/\//g, '-');
    if (fs.existsSync(path.join(projectsDir, pathBasedName))) return true;

    // Scan for partial path match (last 3 segments)
    const cwdParts = cwd.split('/').filter((p) => p.length > 0);
    const lastParts = cwdParts.slice(-3).join('-');
    const dirs = fs.readdirSync(projectsDir);
    return dirs.some((dir) => dir.includes(lastParts));
  } catch {
    return false;
  }
}
