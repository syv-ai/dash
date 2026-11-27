import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import type { BypassAvailability } from '@shared/types';
import { claudeUserSettingsFile, mainRepoRoot } from '../utils/claudePaths';

const execFileAsync = promisify(execFile);

/**
 * Whether Claude Code would let a task's session run in bypassPermissions,
 * read from the settings files that decide it (code.claude.com/docs:
 * permission-modes "Skip all checks with bypassPermissions mode",
 * managed-settings, settings-reference; fetched 2026-11-27 for 2.1.332):
 *
 * - `permissions.disableBypassPermissionsMode: "disable"` is a lock: the
 *   strictest value from any file applies (managed, user, project, local).
 *   Verified live: a session started with `--dangerously-skip-permissions`
 *   under it falls back without a word and reports its fallback mode.
 * - `claude --bg` refuses bypass unless `skipDangerousModePermissionPrompt`
 *   is true in user or managed settings (the accepted warning).
 *
 * Settings files are the user's and the admin's, not Claude Code's output, so
 * there is no drift to report here. Server-managed settings have no
 * documented location on disk and aren't read; a lock from there still shows,
 * as the mode the session reports in its hooks (ActivityInfo.permissionMode).
 */

export type SettingsScope = 'managed' | 'user' | 'project';

export interface SettingsSource {
  scope: SettingsScope;
  /** The parsed file, or anything a broken one parsed to. */
  settings: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function disablesBypass(settings: unknown): boolean {
  return record(record(settings)?.permissions)?.disableBypassPermissionsMode === 'disable';
}

function acceptsBypass(settings: unknown): boolean {
  return record(settings)?.skipDangerousModePermissionPrompt === true;
}

/** The decision, from every source found (pure). */
export function bypassAvailability(sources: readonly SettingsSource[]): BypassAvailability {
  const lock = sources.filter((s) => disablesBypass(s.settings));
  if (lock.length > 0) {
    return {
      available: false,
      reason: 'disabled',
      managed: lock.some((s) => s.scope === 'managed'),
    };
  }
  const accepted = sources.some((s) => s.scope !== 'project' && acceptsBypass(s.settings));
  return accepted ? { available: true } : { available: false, reason: 'not-accepted' };
}

/** The system directory of the file-based managed settings (managed-settings docs). */
function managedDir(): string | null {
  if (process.platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (process.platform === 'linux') return '/etc/claude-code';
  if (process.platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  return null;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf-8')) as unknown;
  } catch {
    return undefined;
  }
}

async function managedFiles(): Promise<string[]> {
  const dir = managedDir();
  if (!dir) return [];
  const dropIns = path.join(dir, 'managed-settings.d');
  let names: string[] = [];
  try {
    names = (await fs.promises.readdir(dropIns)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    // No drop-in directory.
  }
  return [path.join(dir, 'managed-settings.json'), ...names.map((n) => path.join(dropIns, n))];
}

/**
 * The macOS configuration profile (the `com.anthropic.claudecode` managed
 * preferences domain) as JSON, or undefined. Where macOS keeps a managed
 * domain is the OS's convention, not Claude Code's docs [provisional].
 */
async function managedPlist(): Promise<unknown> {
  if (process.platform !== 'darwin') return undefined;
  const file = '/Library/Managed Preferences/com.anthropic.claudecode.plist';
  if (!fs.existsSync(file)) return undefined;
  try {
    const { stdout } = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', file], {
      timeout: 5_000,
    });
    return JSON.parse(String(stdout)) as unknown;
  } catch {
    return undefined;
  }
}

/** Read every source for a session in `cwd` and decide. */
export async function readBypassAvailability(cwd: string): Promise<BypassAvailability> {
  const managed = await Promise.all([...(await managedFiles()).map(readJson), managedPlist()]);
  // The local file sits at the main checkout's root for a worktree session
  // (settings docs, "Where Claude Code keeps the local file"), and an older
  // Claude Code left one in the starting directory, which it still reads.
  const root = (await mainRepoRoot(cwd).catch(() => null)) ?? cwd;
  const projectFiles = [
    path.join(cwd, '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.local.json'),
    ...(root !== cwd ? [path.join(root, '.claude', 'settings.local.json')] : []),
  ];
  const project = await Promise.all(projectFiles.map(readJson));
  const sources: SettingsSource[] = [
    ...managed.map((settings) => ({ scope: 'managed' as const, settings })),
    { scope: 'user', settings: await readJson(claudeUserSettingsFile()) },
    ...project.map((settings) => ({ scope: 'project' as const, settings })),
  ];
  return bypassAvailability(sources);
}
