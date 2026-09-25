import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { MEMORY_INDEX_FILE, type MemoryEntry, type ProjectMemory } from '@shared/types';
import { claudeProjectDir } from '../utils/claudePaths';
import { memoryLinkFiles } from '@shared/memoryLinks';
import { parseMemoryFile } from './memoryFiles';

const execFileAsync = promisify(execFile);

/** The one read failure that means "not there": anything else is a real error. */
function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/**
 * The directory Claude Code keys a project's auto-memory by: the main
 * checkout of the git repo `projectPath` lives in, so every linked worktree
 * (and a monorepo subfolder) shares one memory. Outside git, or when there is
 * no main checkout (bare repo, submodule), the path itself.
 */
async function resolveMemoryRoot(projectPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: projectPath },
    );
    const commonDir = stdout.trim();
    if (path.basename(commonDir) === '.git') return path.dirname(commonDir);
    // Bare repo, submodule or --separate-git-dir: no main checkout to key by.
    console.warn('[MemoryService] no main checkout for', projectPath, 'git dir:', commonDir);
    return projectPath;
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

/** A project's auto-memory folder. Every caller goes through this: how the
 *  folder is found (root resolution, encoding, config dir) stays private. */
export async function resolveMemoryDir(projectPath: string): Promise<string> {
  return path.join(claudeProjectDir(await resolveMemoryRoot(projectPath)), 'memory');
}

async function readEntry(
  dir: string,
  file: string,
  indexed: Set<string>,
): Promise<MemoryEntry | null> {
  const full = path.join(dir, file);
  try {
    const [content, stat] = await Promise.all([
      fs.promises.readFile(full, 'utf8'),
      fs.promises.stat(full),
    ]);
    const parsed = parseMemoryFile(content);
    return {
      file,
      name: parsed.name || file.replace(/\.md$/, ''),
      description: parsed.description,
      type: parsed.type,
      body: parsed.body,
      mtimeMs: stat.mtimeMs,
      inIndex: indexed.has(file),
    };
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
  const dir = await resolveMemoryDir(projectPath);
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (err) {
    if (isMissing(err)) return { dir, exists: false, index: null, entries: [] };
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
  const indexed = index ? memoryLinkFiles(index) : new Set<string>();
  const entries = await Promise.all(
    names
      .filter((n) => n.endsWith('.md') && n !== MEMORY_INDEX_FILE)
      .map((file) => readEntry(dir, file, indexed)),
  );
  return {
    dir,
    exists: true,
    index,
    entries: entries.filter((e): e is MemoryEntry => e !== null),
  };
}
