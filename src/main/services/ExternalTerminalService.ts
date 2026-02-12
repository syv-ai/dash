import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { activityMonitor } from './ActivityMonitor';
import { hookServer } from './HookServer';

const execAsync = promisify(exec);

/** Terminals that support AppleScript command execution on macOS. */
const APPLESCRIPT_TERMINALS = new Set(['Terminal', 'iTerm', 'iTerm2']);

/** Escape single quotes for shell/AppleScript strings. */
function escapeShellSingleQuote(s: string): string {
  return s.replace(/'/g, "'\\''");
}

/** Escape double quotes for AppleScript strings. */
function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Write .claude/settings.local.json hooks so activity monitoring works
 * regardless of which terminal emulator runs Claude CLI.
 */
function writeHookSettings(cwd: string, ptyId: string): void {
  const port = hookServer.port;
  if (port === 0) return;

  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.local.json');
  const curlBase = `curl -s --connect-timeout 2 http://127.0.0.1:${port}`;

  const hookSettings = {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: `${curlBase}/hook/stop?ptyId=${ptyId}` }] }],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: `${curlBase}/hook/busy?ptyId=${ptyId}` }] },
      ],
    },
  };

  try {
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    let existing: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        // Corrupted — overwrite
      }
    }

    const merged = {
      ...existing,
      hooks: {
        ...(existing.hooks && typeof existing.hooks === 'object'
          ? (existing.hooks as Record<string, unknown>)
          : {}),
        ...hookSettings.hooks,
      },
    };

    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');
  } catch (err) {
    console.error('[ExternalTerminalService] Failed to write hook settings:', err);
  }
}

/**
 * Build the Claude CLI command string for a task.
 */
function buildClaudeCommand(options: {
  cwd: string;
  autoApprove?: boolean;
  resume?: boolean;
}): string {
  const parts = ['claude'];
  if (options.resume) {
    parts.push('-c', '-r');
  }
  if (options.autoApprove) {
    parts.push('--dangerously-skip-permissions');
  }
  return parts.join(' ');
}

/**
 * Launch a task in an external terminal emulator.
 *
 * For Terminal.app and iTerm2: uses AppleScript to open a new window and run the command.
 * For other terminals: opens the app and returns the command for the user to paste.
 */
export async function launchExternalTerminal(options: {
  id: string;
  cwd: string;
  terminalApp: string;
  autoApprove?: boolean;
  resume?: boolean;
}): Promise<{ launched: boolean; command: string; autoLaunched: boolean }> {
  const claudeCommand = buildClaudeCommand(options);
  const fullCommand = `cd '${escapeShellSingleQuote(options.cwd)}' && ${claudeCommand}`;

  // Write hook settings for activity monitoring
  writeHookSettings(options.cwd, options.id);

  // Register with activity monitor (use Electron's own PID since we don't
  // have the external terminal's PID; isDirectSpawn=true means state is
  // driven by hooks, not process polling)
  activityMonitor.register(options.id, process.pid, true);

  const app = options.terminalApp;
  const platform = process.platform;

  if (platform === 'darwin') {
    try {
      if (app === 'Terminal' || app === 'Terminal.app') {
        await launchTerminalApp(options.cwd, claudeCommand);
        return { launched: true, command: fullCommand, autoLaunched: true };
      }

      if (app === 'iTerm' || app === 'iTerm2' || app === 'iTerm.app' || app === 'iTerm2.app') {
        await launchITerm(options.cwd, claudeCommand);
        return { launched: true, command: fullCommand, autoLaunched: true };
      }

      // Generic: open the app (it may not support running a command directly)
      await execAsync(`open -a '${escapeShellSingleQuote(app)}'`);
      return { launched: true, command: fullCommand, autoLaunched: false };
    } catch (err) {
      console.error(`[ExternalTerminalService] Failed to launch ${app}:`, err);
      return { launched: false, command: fullCommand, autoLaunched: false };
    }
  }

  if (platform === 'linux') {
    try {
      // Try to launch with common Linux terminal patterns
      await launchLinuxTerminal(app, options.cwd, claudeCommand);
      return { launched: true, command: fullCommand, autoLaunched: true };
    } catch {
      return { launched: false, command: fullCommand, autoLaunched: false };
    }
  }

  // Unsupported platform — return the command for the user
  return { launched: false, command: fullCommand, autoLaunched: false };
}

/**
 * Unregister a task from activity monitoring when it's no longer tracked.
 */
export function unregisterExternalTerminal(id: string): void {
  activityMonitor.unregister(id);
}

/**
 * Check if a terminal app supports auto-launching commands.
 */
export function supportsAutoLaunch(terminalApp: string): boolean {
  const normalized = terminalApp.replace(/\.app$/, '');
  if (process.platform === 'darwin') {
    return APPLESCRIPT_TERMINALS.has(normalized);
  }
  // Most Linux terminals support -e flag
  if (process.platform === 'linux') {
    return true;
  }
  return false;
}

// ── macOS Launch Strategies ─────────────────────────────────

async function launchTerminalApp(cwd: string, command: string): Promise<void> {
  const escapedCwd = escapeAppleScriptString(cwd);
  const escapedCmd = escapeAppleScriptString(command);
  const script = [
    'tell application "Terminal"',
    '  activate',
    `  do script "cd \\"${escapedCwd}\\" && ${escapedCmd}"`,
    'end tell',
  ].join('\n');

  await execAsync(`osascript -e '${escapeShellSingleQuote(script)}'`);
}

async function launchITerm(cwd: string, command: string): Promise<void> {
  const escapedCwd = escapeAppleScriptString(cwd);
  const escapedCmd = escapeAppleScriptString(command);
  const script = [
    'tell application "iTerm2"',
    '  activate',
    `  create window with default profile command "cd \\"${escapedCwd}\\" && ${escapedCmd}"`,
    'end tell',
  ].join('\n');

  await execAsync(`osascript -e '${escapeShellSingleQuote(script)}'`);
}

// ── Linux Launch Strategy ───────────────────────────────────

async function launchLinuxTerminal(app: string, cwd: string, command: string): Promise<void> {
  // Most Linux terminals support: terminal-app --working-directory=DIR -e COMMAND
  const fullCmd = `cd '${escapeShellSingleQuote(cwd)}' && ${command}`;

  // Common patterns for popular Linux terminals
  const strategies: Record<string, string> = {
    'gnome-terminal': `gnome-terminal --working-directory='${escapeShellSingleQuote(cwd)}' -- bash -c '${escapeShellSingleQuote(command + '; exec $SHELL')}'`,
    konsole: `konsole --workdir '${escapeShellSingleQuote(cwd)}' -e bash -c '${escapeShellSingleQuote(command + '; exec $SHELL')}'`,
    kitty: `kitty --directory '${escapeShellSingleQuote(cwd)}' bash -c '${escapeShellSingleQuote(command + '; exec $SHELL')}'`,
    alacritty: `alacritty --working-directory '${escapeShellSingleQuote(cwd)}' -e bash -c '${escapeShellSingleQuote(command + '; exec $SHELL')}'`,
    xterm: `xterm -e 'cd ${escapeShellSingleQuote(cwd)} && ${command}; exec $SHELL'`,
  };

  const normalized = app.toLowerCase();
  const strategy = strategies[normalized];
  if (strategy) {
    await execAsync(strategy);
  } else {
    // Generic fallback: try -e flag
    await execAsync(`${app} -e bash -c '${escapeShellSingleQuote(fullCmd + '; exec $SHELL')}'`);
  }
}
