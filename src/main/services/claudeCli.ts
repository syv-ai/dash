import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { encodeProjectPath } from '../utils/jsonlParser';

const execFileAsync = promisify(execFile);

/** Exact-match-only project dir lookup. See SessionWatcherService.findProjectDir
 *  for the rationale (PR #117/#124) and `encodeProjectPath` for the platform rules. */
function findClaudeProjectDir(cwd: string): string | null {
  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    const pathBased = path.join(projectsDir, encodeProjectPath(cwd));
    return fs.existsSync(pathBased) ? pathBased : null;
  } catch (err) {
    console.error('[findClaudeProjectDir] Failed to check projects dir:', err);
    return null;
  }
}

/** Check whether Claude has any jsonl history for this cwd. */
export function hasAnySessionForCwd(cwd: string): boolean {
  const projDir = findClaudeProjectDir(cwd);
  if (!projDir) return false;
  try {
    return fs.readdirSync(projDir).some((f) => f.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

// Cached Claude CLI path
let cachedClaudePath: string | null = null;

/**
 * Resolve the `claude` executable: startup-detected cache (main.ts) →
 * `which`/`where.exe` → direct probe of common install locations. Cached per
 * process after the first successful resolution.
 */
export async function findClaudePath(): Promise<string | null> {
  if (cachedClaudePath) return cachedClaudePath;

  // 1. Check the startup-detected cache from main.ts
  try {
    const { claudeCliCache } = await import('../main');
    if (claudeCliCache.path) {
      cachedClaudePath = claudeCliCache.path;
      return cachedClaudePath;
    }
  } catch {
    // Best effort
  }

  // 2. Try `which`/`where.exe` (works when PATH is correct)
  try {
    const findCmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(findCmd, ['claude']);
    // where.exe may return multiple lines; prefer .cmd on Windows
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const resolved =
      process.platform === 'win32'
        ? (lines.find((l) => l.toLowerCase().endsWith('.cmd')) || lines[0])?.trim()
        : lines[0]?.trim();
    if (resolved) {
      cachedClaudePath = resolved;
      return cachedClaudePath;
    }
  } catch {
    // Not in PATH
  }

  // 3. Direct probe common install locations
  const home = os.homedir();
  const candidates: string[] =
    process.platform === 'win32'
      ? [
          path.join(
            process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
            'npm',
            'claude.cmd',
          ),
          path.join(home, 'AppData', 'Local', 'Programs', 'nodejs', 'claude.cmd'),
          path.join('C:\\Program Files\\nodejs', 'claude.cmd'),
          // Version managers: check their env-var-based directories
          ...(process.env.NVM_SYMLINK ? [path.join(process.env.NVM_SYMLINK, 'claude.cmd')] : []),
          ...(process.env.VOLTA_HOME
            ? [path.join(process.env.VOLTA_HOME, 'bin', 'claude.cmd')]
            : []),
        ]
      : [path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  for (const candidate of candidates) {
    try {
      const accessMode = process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;
      await fs.promises.access(candidate, accessMode);
      cachedClaudePath = candidate;
      return cachedClaudePath;
    } catch {
      // Not found here
    }
  }

  console.error('[findClaudePath] Claude CLI not found in any known location');
  return null;
}

/**
 * Claude Code rejects an entire settings.local.json if any top-level hook key
 * is unknown to the running CLI version. Newer hook events must be gated so
 * older Claude Code installs don't lose ALL Dash hooks (see GH #127).
 *
 * Returns false when the version is unknown, which keeps the new keys out of
 * the file — the safer default. main.ts populates claudeCliCache after the
 * async --version probe; by the time a PTY spawns, it's almost always set.
 */
export function isClaudeVersionAtLeast(major: number, minor: number, patch: number): boolean {
  let version: string | null = null;
  try {
    // Lazy require to avoid the circular import that a static import of main.ts
    // would create (main → ptyManager → claudeCli → main). At call time, main
    // is fully loaded.
    const main = require('../main') as typeof import('../main');
    version = main.claudeCliCache.version;
  } catch {
    return false;
  }
  if (!version) return false;
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a !== major) return a > major;
  if (b !== minor) return b > minor;
  return c >= patch;
}
