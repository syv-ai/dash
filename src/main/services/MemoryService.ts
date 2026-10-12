import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { MEMORY_INDEX_FILE, type MemoryEntry, type ProjectMemory } from '@shared/types';
import { claudeProjectDir, isWorkspaceTrusted } from '../utils/claudePaths';
import { readClaudeSettings, type ClaudeSettingsFile } from '../utils/claudeSettings';
import { isMemoryFileName, memoryLinkFiles } from '@shared/memoryLinks';
import { readIndex, readMemoryFields, type MemoryIndexLine } from './memoryFiles';

const execFileAsync = promisify(execFile);

/** The one read failure that means "not there": anything else is a real error. */
function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/**
 * The directory Claude Code keys a project's auto-memory by: the main
 * checkout of the git repo `projectPath` lives in, so every linked worktree
 * (and a monorepo subfolder) shares one memory. With no main checkout, a bare
 * repo's worktrees share its git dir and a submodule or --separate-git-dir
 * checkout is its own root. Outside git, the path itself.
 */
async function resolveMemoryRoot(projectPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir', '--git-dir', '--show-toplevel'],
      { cwd: projectPath },
    );
    const [commonDir = '', gitDir, toplevel] = stdout.trim().split('\n');
    if (path.basename(commonDir) === '.git') return path.dirname(commonDir);
    return gitDir !== commonDir ? commonDir : toplevel || projectPath;
  } catch (err) {
    // Only "not a repo" is the expected outside-git case; a missing git, an
    // unsafe directory or an old git would otherwise show the wrong folder.
    const stderr = (err as { stderr?: unknown }).stderr;
    if (typeof stderr !== 'string' || !/not a git repository/i.test(stderr)) {
      console.warn('[MemoryService] git root lookup failed; using', projectPath, err);
    }
    return projectPath;
  }
}

/**
 * The `autoMemoryDirectory` Claude would use, or null when no settings file
 * sets one. Like Claude, a folder the repository itself names is only taken
 * once the user has trusted the workspace: a checkout can't point memory
 * reads somewhere of its choosing unasked.
 */
async function configuredMemoryDir(
  settings: ClaudeSettingsFile[],
  root: string,
): Promise<string | null> {
  for (const { values, fromRepo, file } of settings) {
    const dir = values.autoMemoryDirectory;
    if (typeof dir !== 'string') continue;
    if (fromRepo && !(await isWorkspaceTrusted(root))) {
      console.warn('[MemoryService] untrusted workspace; ignoring autoMemoryDirectory in', file);
      continue;
    }
    // Claude accepts an absolute path or one under the home directory, nothing else.
    if (dir.startsWith('~/')) return path.join(os.homedir(), dir.slice(2));
    if (path.isAbsolute(dir)) return dir;
  }
  return null;
}

const DISABLE_ENV = 'CLAUDE_CODE_DISABLE_AUTO_MEMORY';
const isSet = (value: unknown): boolean => value === '1' || value === 'true' || value === 1;

/**
 * What turns auto memory off for a session with these settings, or null while
 * it is on (the default): the environment variable, in Dash's own environment
 * (which the sessions it starts inherit) or a settings file's `env`, or the
 * `autoMemoryEnabled` setting, where the first file to set it decides.
 */
function memoryDisabledBy(settings: ClaudeSettingsFile[]): string | null {
  if (isSet(process.env[DISABLE_ENV])) return DISABLE_ENV;
  const env = settings.find(({ values }) => {
    const vars = values.env;
    return isSet(
      vars && typeof vars === 'object' && (vars as Record<string, unknown>)[DISABLE_ENV],
    );
  });
  if (env) return `${DISABLE_ENV} in ${env.file}`;
  const decides = settings.find((s) => typeof s.values.autoMemoryEnabled === 'boolean');
  return decides?.values.autoMemoryEnabled === false
    ? `autoMemoryEnabled in ${decides.file}`
    : null;
}

/**
 * Where a project's memory is and what its sessions' settings say about it.
 * The memory rules here are Claude Code's, copied as documented on 2026-10-02
 * (code.claude.com/docs/en/memory): the folder is keyed on the repository,
 * `autoMemoryDirectory` moves it from any settings file (an absolute path or
 * `~/…`, a repository's own file only once trusted), and `autoMemoryEnabled`
 * or `CLAUDE_CODE_DISABLE_AUTO_MEMORY` turns it off. Which files a session
 * reads and what trust is belong to `claudeSettings`. Not copied: the
 * `permissions.blockReadsOutsideWorkingDirectories` refusal of a
 * repository-chosen folder, and self-hosted sessions starting with memory off.
 */
async function resolveMemory(
  projectPath: string,
): Promise<{ dir: string; settings: ClaudeSettingsFile[] }> {
  const root = await resolveMemoryRoot(projectPath);
  const settings = await readClaudeSettings(projectPath, root);
  const dir =
    (await configuredMemoryDir(settings, root)) ?? path.join(claudeProjectDir(root), 'memory');
  return { dir, settings };
}

/** A project's auto-memory folder. Every caller goes through this: how the
 *  folder is found (settings, root resolution, encoding, config dir) stays private. */
export async function resolveMemoryDir(projectPath: string): Promise<string> {
  return (await resolveMemory(projectPath)).dir;
}

async function readEntry(
  dir: string,
  file: string,
  indexLine: (file: string) => MemoryIndexLine,
): Promise<MemoryEntry | null> {
  const full = path.join(dir, file);
  try {
    const [content, stat] = await Promise.all([
      fs.promises.readFile(full, 'utf8'),
      fs.promises.stat(full),
    ]);
    return { file, ...readMemoryFields(content, file), mtimeMs: stat.mtimeMs, ...indexLine(file) };
  } catch (err) {
    // ENOENT: deleted between readdir and read (Claude rewrites memories
    // mid-session). Anything else hides a memory that exists, so say so.
    if (!isMissing(err)) console.warn('[MemoryService] unreadable memory', full, err);
    return null;
  }
}

/**
 * Read the project's memory folder. A missing folder (or MEMORY.md) is a normal
 * state, not an error; any other read failure throws, so the modal reports it
 * instead of showing an empty or unindexed memory.
 */
export async function readProjectMemory(projectPath: string): Promise<ProjectMemory> {
  const { dir, settings } = await resolveMemory(projectPath);
  const disabledBy = memoryDisabledBy(settings);
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (err) {
    if (isMissing(err)) {
      return { dir, exists: false, hasIndex: false, entries: [], dangling: [], disabledBy };
    }
    console.error('[MemoryService] cannot read memory folder', dir, err);
    throw err;
  }
  const index = names.includes(MEMORY_INDEX_FILE)
    ? await fs.promises
        .readFile(path.join(dir, MEMORY_INDEX_FILE), 'utf8')
        .catch((err: unknown) => {
          if (isMissing(err)) return null;
          console.error('[MemoryService] cannot read', MEMORY_INDEX_FILE, dir, err);
          throw err;
        })
    : null;
  const indexLine = readIndex(index ?? '');
  const entries = await Promise.all(
    names.filter(isMemoryFileName).map((file) => readEntry(dir, file, indexLine)),
  );
  return {
    dir,
    exists: true,
    hasIndex: index !== null,
    entries: entries.filter((e): e is MemoryEntry => e !== null),
    dangling: danglingLinks(index ?? '', names),
    disabledBy,
  };
}

/** The memory files `index` links to that aren't among `names`, the folder's files. */
function danglingLinks(index: string, names: string[]): string[] {
  const present = new Set(names);
  return [...memoryLinkFiles(index)].filter((f) => f !== MEMORY_INDEX_FILE && !present.has(f));
}
