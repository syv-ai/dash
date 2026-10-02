/**
 * Which settings files a Claude Code session reads, and whether the user has
 * trusted the workspace they come from. These are Claude Code's rules, copied:
 * Dash has no way to ask Claude, so the copy lives here once, and a consumer
 * (memory, today) only interprets the keys it cares about.
 *
 * Copied, as documented on 2026-10-02 (code.claude.com/docs/en/settings and
 * /permissions); every version gate below is under `MIN_CLAUDE_VERSION`:
 * - Precedence: managed policy, then the project's local file, then its
 *   shared file, then the user's.
 * - `.claude/settings.local.json` is the user's own unless git tracks it or
 *   `.claude` is a symlink; then the repository supplies it.
 * - The local file lives at the repository root (the main checkout, for a
 *   worktree) and applies to sessions anywhere in the repository; one beside
 *   the session's own directory still applies there (v2.1.211). Which of the
 *   two wins isn't documented: the nearer one is taken first.
 * - Trust is recorded in the state file, keyed on the repository root, or on
 *   the folder itself outside git.
 *
 * Not copied, so Dash can differ from a session there:
 * - `--settings` and other command-line sources.
 * - Trust a folder outside git inherits from a trusted parent: only the
 *   folder's own record counts here, which errs towards ignoring a file.
 * - A shared `.claude/settings.json` is read beside the session's directory
 *   only, not at the repository root above it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { claudeConfigDir, claudeStateFile } from './claudePaths';

const execFileAsync = promisify(execFile);

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** One settings file a session reads. */
export interface ClaudeSettingsFile {
  file: string;
  /** Whether the repository supplies the file, rather than the user or their organisation. */
  fromRepo: boolean;
  /** Its top-level keys, as written: a consumer checks the types of the ones it reads. */
  values: Record<string, unknown>;
}

/** Claude Code's managed (policy) settings file. */
function managedSettingsFile(): string {
  if (process.platform === 'darwin') {
    return '/Library/Application Support/ClaudeCode/managed-settings.json';
  }
  if (process.platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

/**
 * Whether a project's `settings.local.json` comes with the repository rather
 * than from the user: git tracks it, or `.claude` is a symlink.
 */
async function isRepoSupplied(file: string): Promise<boolean> {
  const linked = await fs.promises.lstat(path.dirname(file)).then(
    (stat) => stat.isSymbolicLink(),
    () => false,
  );
  if (linked) return true;
  return execFileAsync('git', ['ls-files', '--error-unmatch', '--', path.basename(file)], {
    cwd: path.dirname(file),
  }).then(
    () => true,
    () => false,
  );
}

/**
 * The settings files a Claude session started in `startDir` reads, first
 * deciding: the file to take a key from is the first one that sets it.
 * `repoRoot` is the repository root the session resolves to (`startDir`
 * itself outside git). Missing and unreadable files are left out.
 */
export async function readClaudeSettings(
  startDir: string,
  repoRoot: string,
): Promise<ClaudeSettingsFile[]> {
  const locals = [...new Set([startDir, repoRoot])].map((dir) =>
    path.join(dir, '.claude', 'settings.local.json'),
  );
  const files = [
    { file: managedSettingsFile(), fromRepo: () => false },
    ...locals.map((file) => ({ file, fromRepo: () => isRepoSupplied(file) })),
    { file: path.join(startDir, '.claude', 'settings.json'), fromRepo: () => true },
    { file: path.join(claudeConfigDir(), 'settings.json'), fromRepo: () => false },
  ];
  const read = await Promise.all(
    files.map(async ({ file, fromRepo }): Promise<ClaudeSettingsFile | null> => {
      try {
        const values: unknown = JSON.parse(await fs.promises.readFile(file, 'utf8'));
        if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
        return { file, fromRepo: await fromRepo(), values: values as Record<string, unknown> };
      } catch (err) {
        if (!isMissing(err)) console.warn('[claudeSettings] unreadable Claude settings', file, err);
        return null;
      }
    }),
  );
  return read.filter((s) => s !== null);
}

/**
 * Whether the user accepted Claude Code's workspace trust dialog for
 * `repoRoot`. What a repository-supplied settings file asks for (see
 * `fromRepo`) counts only once this is true.
 */
export async function isWorkspaceTrusted(repoRoot: string): Promise<boolean> {
  try {
    const state: unknown = JSON.parse(await fs.promises.readFile(claudeStateFile(), 'utf8'));
    const projects = (state as { projects?: Record<string, { hasTrustDialogAccepted?: unknown }> })
      ?.projects;
    return projects?.[repoRoot]?.hasTrustDialogAccepted === true;
  } catch (err) {
    if (!isMissing(err)) console.warn('[claudeSettings] unreadable Claude state file', err);
    return false;
  }
}
