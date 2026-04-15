import { ipcMain, dialog, app, shell, BrowserWindow, Notification } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

const execFileAsync = promisify(execFile);

// ── IDE registry ──────────────────────────────────────────────
// Ordered by auto-detect preference. Launching via the CLI bundled inside the
// .app avoids relying on the user having run VS Code's "Install 'code' command
// in PATH" (or equivalents), which is the #1 reason "Open in IDE" silently fails.
interface IdeRegistryEntry {
  id: string;
  label: string;
  macAppNames: string[]; // .app bundle basenames to look for
  macCliInBundle: string; // path to CLI inside the .app bundle
  linuxCommand: string; // command expected on PATH on Linux
  newWindowArgs: string[];
}

const IDE_REGISTRY: IdeRegistryEntry[] = [
  {
    id: 'cursor',
    label: 'Cursor',
    macAppNames: ['Cursor.app'],
    macCliInBundle: 'Contents/Resources/app/bin/cursor',
    linuxCommand: 'cursor',
    newWindowArgs: ['--new-window'],
  },
  {
    id: 'vscode',
    label: 'VS Code',
    macAppNames: ['Visual Studio Code.app', 'Visual Studio Code - Insiders.app'],
    macCliInBundle: 'Contents/Resources/app/bin/code',
    linuxCommand: 'code',
    newWindowArgs: ['--new-window'],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    macAppNames: ['Windsurf.app'],
    macCliInBundle: 'Contents/Resources/app/bin/windsurf',
    linuxCommand: 'windsurf',
    newWindowArgs: ['--new-window'],
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    macAppNames: ['Antigravity.app'],
    macCliInBundle: 'Contents/Resources/app/bin/antigravity',
    linuxCommand: 'antigravity',
    newWindowArgs: ['--new-window'],
  },
  {
    id: 'zed',
    label: 'Zed',
    macAppNames: ['Zed.app', 'Zed Preview.app'],
    macCliInBundle: 'Contents/MacOS/cli',
    linuxCommand: 'zed',
    newWindowArgs: ['--new'],
  },
];

interface DetectedIde {
  id: string;
  label: string;
  launcher: string;
  newWindowArgs: string[];
}

async function detectIdes(): Promise<DetectedIde[]> {
  // No caching: detection is fast (a few existsSync calls on macOS, parallel
  // `which` on Linux) and skipping the cache means install/uninstall changes
  // take effect immediately without an app restart.
  const appSearchRoots =
    process.platform === 'darwin' ? ['/Applications', join(homedir(), 'Applications')] : [];

  const launchers = await Promise.all(
    IDE_REGISTRY.map(async (entry): Promise<string | null> => {
      if (process.platform === 'darwin') {
        for (const root of appSearchRoots) {
          for (const appName of entry.macAppNames) {
            const candidate = join(root, appName, entry.macCliInBundle);
            if (existsSync(candidate)) return candidate;
          }
        }
        return null;
      }
      try {
        const { stdout } = await execFileAsync('which', [entry.linuxCommand]);
        return stdout.trim() || null;
      } catch (err: unknown) {
        // `which` exits 1 when the command isn't found — that's expected.
        // Log anything else so real failures aren't silently swallowed.
        const code =
          err && typeof err === 'object' && 'code' in err
            ? (err as { code: number }).code
            : undefined;
        if (code !== 1) {
          console.warn(`[detectIdes] Unexpected error detecting ${entry.linuxCommand}:`, err);
        }
        return null;
      }
    }),
  );

  const results: DetectedIde[] = [];
  IDE_REGISTRY.forEach((entry, i) => {
    const launcher = launchers[i];
    if (launcher) {
      results.push({
        id: entry.id,
        label: entry.label,
        launcher,
        newWindowArgs: entry.newWindowArgs,
      });
    }
  });

  return results;
}

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
      await execFileAsync('which', [editor]);
      cachedEditor = editor;
      return editor;
    } catch {
      // Not found, try next
    }
  }

  // Fallback to system opener
  cachedEditor = process.platform === 'darwin' ? 'open' : 'xdg-open';
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

  ipcMain.handle('app:pickExecutable', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      // On macOS, treat .app bundles as directories so the user can drill into
      // Contents/MacOS/<binary> if they need the actual executable.
      const properties: Electron.OpenDialogOptions['properties'] =
        process.platform === 'darwin' ? ['openFile', 'treatPackageAsDirectory'] : ['openFile'];
      const options: Electron.OpenDialogOptions = { properties };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null };
      }
      return { success: true, data: result.filePaths[0] };
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
    async (
      _event,
      args: {
        folderPath: string;
        ide?: string;
        // Only used when ide === 'custom'. Args may contain the literal token
        // {path}; if absent, folderPath is appended. SECURITY: keep using
        // execFile (argv-based) — never switch to exec/shell:true, or these
        // user-supplied args become shell-injectable.
        customCommand?: { path: string; args: string[] };
      },
    ) => {
      try {
        if (!existsSync(args.folderPath)) {
          return { success: false, error: `Path not found: ${args.folderPath}` };
        }

        if (args.ide === 'custom') {
          const custom = args.customCommand;
          if (!custom?.path) {
            return { success: false, error: 'No custom IDE configured' };
          }
          if (!existsSync(custom.path)) {
            return { success: false, error: `Custom IDE not found: ${custom.path}` };
          }
          const substituted = custom.args.map((a) => a.split('{path}').join(args.folderPath));
          const finalArgs = custom.args.some((a) => a.includes('{path}'))
            ? substituted
            : [...substituted, args.folderPath];
          await execFileAsync(custom.path, finalArgs);
          return { success: true, data: null };
        }

        const detected = await detectIdes();
        if (detected.length === 0) {
          return { success: false, error: 'No supported IDE found on this machine' };
        }

        const target =
          args.ide && args.ide !== 'auto' ? detected.find((d) => d.id === args.ide) : detected[0];

        if (!target) {
          const entry = IDE_REGISTRY.find((e) => e.id === args.ide);
          const label = entry?.label ?? args.ide;
          return {
            success: false,
            error: `${label} is not installed or its launcher could not be found`,
          };
        }

        await execFileAsync(target.launcher, [...target.newWindowArgs, args.folderPath]);
        return { success: true, data: null };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle('app:detectAvailableIDEs', async () => {
    try {
      const detected = await detectIdes();
      return {
        success: true,
        data: detected.map(({ id, label }) => ({ id, label })),
      };
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
        const gotoEditors = ['code', 'cursor', 'zed'];
        const isGotoEditor = gotoEditors.some((e) => editor === e || editor.endsWith(`/${e}`));

        if (isGotoEditor) {
          const location =
            args.line != null && args.col != null
              ? `${resolved}:${args.line}:${args.col}`
              : args.line != null
                ? `${resolved}:${args.line}`
                : resolved;
          await execFileAsync(editor, ['-g', location]);
        } else if (editor === 'open') {
          await execFileAsync('open', [resolved]);
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
