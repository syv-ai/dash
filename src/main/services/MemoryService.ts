import * as fs from 'fs';
import * as path from 'path';
import { MEMORY_INDEX_FILE, type MemoryEntry, type ProjectMemory } from '@shared/types';
import { claudeConfigDir, claudeProjectDir, mainRepoRoot } from '../utils/claudePaths';
import {
  indexLinkFiles,
  isMemoryFileName,
  readIndex,
  readMemoryFields,
  type MemoryIndexLine,
} from './memoryFiles';

/** The one read failure that means "not there": anything else is a real error. */
function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/**
 * A project's auto-memory folder. Claude keys it on the repository's main
 * checkout, so every linked worktree (and a monorepo subfolder) shares one
 * memory; outside git, on the path itself.
 */
export async function resolveMemoryDir(projectPath: string): Promise<string> {
  const root = (await mainRepoRoot(projectPath)) ?? projectPath;
  return path.join(claudeProjectDir(root), 'memory');
}

/**
 * Whether `dir` is the memory folder of one of `projectPaths`. A folder not
 * shaped like one (`<config dir>/projects/<name>/memory`) is turned away
 * without asking git, so the check costs nothing for any other folder.
 */
export async function isProjectMemoryDir(dir: string, projectPaths: string[]): Promise<boolean> {
  const resolved = path.resolve(dir);
  const projectsDir = path.join(claudeConfigDir(), 'projects');
  if (path.dirname(path.dirname(resolved)) !== projectsDir) return false;
  if (path.basename(resolved) !== 'memory') return false;
  const dirs = await Promise.all(projectPaths.map(resolveMemoryDir));
  return dirs.includes(resolved);
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
  const dir = await resolveMemoryDir(projectPath);
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (err) {
    if (isMissing(err)) {
      return { dir, exists: false, hasIndex: false, entries: [], dangling: [] };
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
  };
}

/** The memory files `index` links to that aren't among `names`, the folder's files. */
function danglingLinks(index: string, names: string[]): string[] {
  const present = new Set(names);
  return [...new Set(indexLinkFiles(index).flat())].filter(
    (f) => f !== MEMORY_INDEX_FILE && !present.has(f),
  );
}
