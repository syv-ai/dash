import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { claudeProjectDir } from '../utils/claudePaths';

const execFileAsync = promisify(execFile);

/** Exact-match-only project dir lookup (PR #117/#124: a prefix match used to
 *  pick up sibling projects' transcripts). See `encodeProjectPath` for the
 *  encoding rules. */
function findClaudeProjectDir(cwd: string): string | null {
  try {
    const pathBased = claudeProjectDir(cwd);
    return fs.existsSync(pathBased) ? pathBased : null;
  } catch (err) {
    console.error('[findClaudeProjectDir] Failed to check projects dir:', err);
    return null;
  }
}

/**
 * Pure selection: given a project dir's entries, return the basename (sans
 * `.jsonl`) of the most-recently-modified session file, or null if none.
 *
 * Newest-mtime follows Claude's `/clear` and `/compact` forks (each writes a
 * fresh, newer file) instead of pinning a stale id the way the old
 * SessionStart-hook machinery did (see 32bcdb6).
 */
export function pickLatestSessionId(
  files: Array<{ name: string; mtimeMs: number }>,
): string | null {
  let latest: { name: string; mtimeMs: number } | null = null;
  for (const f of files) {
    if (!f.name.endsWith('.jsonl')) continue;
    if (!latest || f.mtimeMs > latest.mtimeMs) latest = f;
  }
  return latest ? latest.name.slice(0, -'.jsonl'.length) : null;
}

/**
 * Resolve the most recent Claude session id for a cwd, or null if Claude has
 * no jsonl history there yet. Used once per task: the first supervisor
 * dispatch of a task created before Dash recorded session ids passes it as
 * `--bg --resume <id>` so the conversation carries over; from then on the
 * task row holds the id (Task.sessionId).
 *
 * `previousPath` is the task's pre-migration worktree location (Task.previousPath).
 * Claude keys transcripts by the cwd a session started in and keeps writing a
 * resumed session under that original dir, so after a `git worktree move` the
 * newest file can live under either encoding; both dirs are searched and the
 * newest mtime wins, exactly as within one dir.
 */
export function findLatestSessionId(cwd: string, previousPath?: string | null): string | null {
  const files: Array<{ name: string; mtimeMs: number }> = [];
  for (const dirCwd of previousPath ? [cwd, previousPath] : [cwd]) {
    const projDir = findClaudeProjectDir(dirCwd);
    if (!projDir) continue;
    try {
      for (const name of fs.readdirSync(projDir)) {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(path.join(projDir, name)).mtimeMs;
        } catch {
          // Vanished between readdir and stat — treat as oldest; benign race.
        }
        files.push({ name, mtimeMs });
      }
    } catch {
      // Unreadable dir — treat as empty.
    }
  }
  return pickLatestSessionId(files);
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
 * Oldest Claude Code Dash runs task sessions on. Chosen for the session
 * supervisor (`claude --bg` / `claude attach` / `claude agents --json`) plus
 * the worktree-aware resume and reply features that landed by 2.1.257; see
 * docs/specs/2026-09-20-claude-code-supervisor-sessions.md §6.1. Every hook
 * event Dash writes (PostCompact, StopFailure, …) predates this floor, so the
 * per-event version gates that guarded older CLIs (GH #127) are gone.
 */
export const MIN_CLAUDE_VERSION = '2.1.257';

export type ParsedVersion = readonly [major: number, minor: number, patch: number];

/**
 * Parse the leading `M.m.p` of a `claude --version` string ("2.1.278 (Claude
 * Code)"). Null for anything that doesn't start with three dotted numbers.
 */
export function parseClaudeVersion(version: string | null | undefined): ParsedVersion | null {
  if (!version) return null;
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Standard semver-style ordering on the parsed triple: -1, 0 or 1. */
export function compareClaudeVersions(a: ParsedVersion, b: ParsedVersion): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return 0;
}

/**
 * Pure floor check. Unknown/unparseable versions fail — the caller decides
 * whether that means "block" (task spawn) or "can't tell yet" (settings UI).
 */
export function versionMeetsMinimum(
  version: string | null | undefined,
  minimum: string = MIN_CLAUDE_VERSION,
): boolean {
  const parsed = parseClaudeVersion(version);
  const min = parseClaudeVersion(minimum);
  if (!parsed || !min) return false;
  return compareClaudeVersions(parsed, min) >= 0;
}

/**
 * Human-readable reason a task session can't start on this install, or null
 * when the CLI is present and new enough. Shared by the IPC refusal and the
 * renderer's gate panel so the two never disagree on wording.
 */
export function describeUnsupportedClaude(cache: {
  installed: boolean;
  version: string | null;
}): string | null {
  if (!cache.installed) {
    return 'Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code';
  }
  if (versionMeetsMinimum(cache.version)) return null;
  const detected = parseClaudeVersion(cache.version)?.join('.') ?? cache.version ?? 'unknown';
  return `Claude Code ${MIN_CLAUDE_VERSION} or newer is required (found ${detected}). Run: claude update`;
}

function readCachedVersion(): string | null {
  try {
    // Lazy require to avoid the circular import that a static import of main.ts
    // would create (main → ptyManager → claudeCli → main). At call time, main
    // is fully loaded.
    const main = require('../main') as typeof import('../main');
    return main.claudeCliCache.version;
  } catch {
    return null;
  }
}

/**
 * Claude Code rejects an entire settings.local.json if any top-level hook key
 * is unknown to the running CLI version, so a hook event newer than
 * MIN_CLAUDE_VERSION must still be gated here (GH #127).
 *
 * Returns false when the version is unknown, which keeps the new keys out of
 * the file — the safer default. main.ts populates claudeCliCache after the
 * async --version probe; by the time a PTY spawns, it's almost always set.
 */
export function isClaudeVersionAtLeast(major: number, minor: number, patch: number): boolean {
  const parsed = parseClaudeVersion(readCachedVersion());
  if (!parsed) return false;
  return compareClaudeVersions(parsed, [major, minor, patch]) >= 0;
}
