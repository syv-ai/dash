import { ipcMain, dialog, app, shell, BrowserWindow, Notification } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

const execFileAsync = promisify(execFile);

const FIND_CMD = process.platform === 'win32' ? 'where.exe' : 'which';

let cachedEditor: string | null = null;

async function detectEditor(): Promise<string> {
  if (cachedEditor) return cachedEditor;

  // Check environment variables first
  for (const envVar of ['VISUAL', 'EDITOR']) {
    const val = process.env[envVar];
    if (val) {
      cachedEditor = val;
      return val;
    }
  }

  // Probe for known editors
  for (const editor of ['cursor', 'code', 'zed']) {
    try {
      await execFileAsync(FIND_CMD, [editor]);
      cachedEditor = editor;
      return editor;
    } catch {
      // Not found, try next
    }
  }

  // Fallback to system opener
  if (process.platform === 'darwin') {
    cachedEditor = 'open';
  } else if (process.platform === 'win32') {
    cachedEditor = 'start';
  } else {
    cachedEditor = 'xdg-open';
  }
  return cachedEditor;
}

export function registerAppIpc(): void {
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle('app:showOpenDialog', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
        : await dialog.showOpenDialog({ properties: ['openDirectory'] });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: [] };
      }

      return { success: true, data: result.filePaths };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('app:detectGit', async (_event, folderPath: string) => {
    try {
      const gitDir = join(folderPath, '.git');
      if (!existsSync(gitDir)) {
        return { success: true, data: { isGitRepo: false, remote: null, branch: null } };
      }

      let remote: string | null = null;
      let branch: string | null = null;

      try {
        const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
          cwd: folderPath,
        });
        remote = stdout.trim() || null;
      } catch {
        // No remote
      }

      try {
        const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
          cwd: folderPath,
        });
        branch = stdout.trim() || null;
      } catch {
        // No branch
      }

      return { success: true, data: { isGitRepo: true, remote, branch } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('git:init', async (_event, folderPath: string) => {
    try {
      await execFileAsync('git', ['init'], { cwd: folderPath, timeout: 10000 });
      return { success: true, data: null };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.on('app:setDesktopNotification', async (_event, opts: { enabled: boolean }) => {
    try {
      const { setDesktopNotification } = await import('../services/ptyManager');
      setDesktopNotification(opts);

      // Fire a test notification when newly enabled so macOS prompts for permission
      if (opts.enabled) {
        try {
          const n = new Notification({
            title: 'Dash',
            body: 'Notifications enabled!',
          });
          n.show();
        } catch (err) {
          console.error(
            '[app:setDesktopNotification] Test notification failed (permission denied?):',
            err,
          );
        }
      }
    } catch (err) {
      console.error('[app:setDesktopNotification] Failed:', err);
    }
  });

  // Read effective commit attribution from Claude Code settings hierarchy
  ipcMain.handle(
    'app:getClaudeAttribution',
    (_event, projectPath?: string): { success: boolean; data: string | null } => {
      try {
        // Check project-level settings first (higher precedence)
        if (projectPath) {
          const repoSettings = join(projectPath, '.claude', 'settings.json');
          if (existsSync(repoSettings)) {
            const parsed = JSON.parse(readFileSync(repoSettings, 'utf-8'));
            if (parsed?.attribution?.commit !== undefined) {
              return { success: true, data: parsed.attribution.commit };
            }
          }
        }

        // Fall back to global settings
        const globalSettings = join(process.env.HOME || homedir(), '.claude', 'settings.json');
        if (existsSync(globalSettings)) {
          const parsed = JSON.parse(readFileSync(globalSettings, 'utf-8'));
          if (parsed?.attribution?.commit !== undefined) {
            return { success: true, data: parsed.attribution.commit };
          }
        }

        // No custom attribution configured — Claude uses its built-in default
        return { success: true, data: null };
      } catch (err) {
        console.error('[app:getClaudeAttribution] Failed to read settings:', err);
        return { success: true, data: null };
      }
    },
  );

  ipcMain.on('app:setCommitAttribution', async (_event, value: string | undefined) => {
    try {
      const { setCommitAttribution } = await import('../services/ptyManager');
      setCommitAttribution(value);
    } catch (err) {
      console.error('[app:setCommitAttribution] Failed:', err);
    }
  });

  ipcMain.on('app:setClaudeEnvVars', async (_event, vars: Record<string, string>) => {
    try {
      const { setClaudeEnvVars } = await import('../services/ptyManager');
      setClaudeEnvVars(vars);
    } catch (err) {
      console.error('[app:setClaudeEnvVars] Failed:', err);
    }
  });

  ipcMain.on('app:setSyncShellEnv', async (_event, enabled: boolean) => {
    try {
      const { setSyncShellEnv } = await import('../services/ptyManager');
      setSyncShellEnv(enabled);
    } catch (err) {
      console.error('[app:setSyncShellEnv] Failed:', err);
    }
  });

  ipcMain.handle('app:detectClaude', async () => {
    try {
      // Import cached result from main
      const { claudeCliCache } = await import('../main');
      return { success: true, data: claudeCliCache };
    } catch (error) {
      console.error('[app:detectClaude] Failed to import main module:', error);
      return {
        success: false,
        error: String(error),
        data: { installed: false, version: null, path: null },
      };
    }
  });

  ipcMain.handle(
    'app:openInIDE',
    async (_event, args: { folderPath: string; ide?: 'cursor' | 'code' }) => {
      try {
        if (!existsSync(args.folderPath)) {
          return { success: false, error: `Path not found: ${args.folderPath}` };
        }

        let ide = args.ide;
        if (!ide) {
          // Auto-detect: prefer cursor, then code
          for (const candidate of ['cursor', 'code'] as const) {
            try {
              await execFileAsync(FIND_CMD, [candidate]);
              ide = candidate;
              break;
            } catch {
              // Not found, try next
            }
          }
        }

        if (!ide) {
          return { success: false, error: 'No supported IDE found (cursor, code)' };
        }

        // On Windows, IDE binaries are typically .cmd wrappers that must run via cmd.exe
        if (process.platform === 'win32') {
          await execFileAsync('cmd.exe', ['/c', ide, args.folderPath]);
        } else {
          await execFileAsync(ide, [args.folderPath]);
        }
        return { success: true, data: null };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle('app:detectAvailableIDEs', async () => {
    try {
      const available: string[] = [];
      for (const ide of ['cursor', 'code']) {
        try {
          await execFileAsync(FIND_CMD, [ide]);
          available.push(ide);
        } catch {
          // Not found
        }
      }
      return { success: true, data: available };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'app:openInEditor',
    async (_event, args: { cwd: string; filePath: string; line?: number; col?: number }) => {
      try {
        const resolved = resolve(args.cwd, args.filePath);
        if (!existsSync(resolved)) {
          return { success: false, error: `File not found: ${resolved}` };
        }

        const editor = await detectEditor();

        // Build location string with line:col for editors that support -g
        const isGotoEditor = /[\\/]?(cursor|code|zed)(\.cmd|\.exe)?$/i.test(editor);

        if (isGotoEditor) {
          const location =
            args.line != null && args.col != null
              ? `${resolved}:${args.line}:${args.col}`
              : args.line != null
                ? `${resolved}:${args.line}`
                : resolved;
          if (process.platform === 'win32') {
            await execFileAsync('cmd.exe', ['/c', editor, '-g', location]);
          } else {
            await execFileAsync(editor, ['-g', location]);
          }
        } else if (editor === 'open') {
          await execFileAsync('open', [resolved]);
        } else if (editor === 'start') {
          // Windows fallback — empty title arg keeps `start` from treating the path as a window title
          await execFileAsync('cmd.exe', ['/c', 'start', '', resolved]);
        } else {
          // Generic editor (vim, nano, etc.) — just open the file
          await execFileAsync(editor, [resolved]);
        }

        return { success: true, data: null };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );
}
