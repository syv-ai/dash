import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
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
import {
  startWatching,
  stopWatching,
  readHistory,
  resetSession,
  findProjectDir,
} from '../services/SessionWatcherService';
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
          data: readHistory(args.cwd, args.limit, args.beforeIndex),
        };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Watch a JSONL conversation file for new entries
  ipcMain.handle('pty:chatWatch', (event, args: { id: string; cwd: string }) => {
    try {
      const sender = event.sender;
      startWatching(
        args.id,
        args.cwd,
        (messages) => {
          if (!sender.isDestroyed()) sender.send(`pty:chatMessages:${args.id}`, messages);
        },
        (status) => {
          if (!sender.isDestroyed()) sender.send(`pty:chatStatus:${args.id}`, status);
        },
        (metrics) => {
          if (!sender.isDestroyed()) sender.send(`pty:chatMetrics:${args.id}`, metrics);
        },
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.on('pty:chatUnwatch', (_event, id: string) => {
    stopWatching(id);
  });

  // Force session reset (called from SessionStart hook)
  ipcMain.on('pty:chatResetSession', (_event, id: string) => {
    resetSession(id);
  });

  // Read a file (for viewing background task output)
  ipcMain.handle('pty:readFile', async (_event, filePath: string) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, data: content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
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
  return findProjectDir(cwd) !== null;
}
