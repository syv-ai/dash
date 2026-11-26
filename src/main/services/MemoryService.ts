import * as fs from 'fs';
import * as path from 'path';
import { MEMORY_INDEX_FILE, type MemoryEntry, type ProjectMemory } from '@shared/types';
import { claudeConfigDir, claudeProjectDir, mainRepoRoot } from '../utils/claudePaths';
import { checkMemoryFrontmatter } from '../claudeContract/agentFileSchemas';
import { claudeVersionFor } from '../claudeContract/claudeVersions';
import { reportFindings } from '../claudeContract/driftReporter';
import {
  countNewMemories,
  indexLinkFiles,
  isMemoryFileName,
  newMemoryFile,
  readFrontmatter,
  readIndex,
  readMemoryFields,
  withIndexLine,
  withoutIndexLinks,
  type MemoryIndexLine,
  type NewMemoryType,
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
    // Claude Code wrote it, so its frontmatter is a contract (claudeContract/).
    reportFindings(
      'memory-file',
      checkMemoryFrontmatter(readFrontmatter(content).frontmatter),
      claudeVersionFor(),
    );
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

/**
 * How many memories in `dir` were written or changed after the last look,
 * `seenAt()`. It is asked once the folder has been read, so a look taken while
 * the count runs isn't overwritten by a count from before it. A missing folder
 * has none; an unreadable one is logged and counts none, since this only feeds
 * a badge.
 */
export async function newMemoryCount(dir: string, seenAt: () => number | null): Promise<number> {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (err) {
    if (!isMissing(err)) console.warn('[MemoryService] cannot count new memories', dir, err);
    return 0;
  }
  const files = await Promise.all(
    names.filter(isMemoryFileName).map(async (name) => {
      try {
        return { name, mtimeMs: (await fs.promises.stat(path.join(dir, name))).mtimeMs };
      } catch {
        return null; // deleted between readdir and stat
      }
    }),
  );
  return countNewMemories(
    files.filter((f) => f !== null),
    seenAt(),
  );
}

/** MEMORY.md's text, or null when the folder has none. */
async function readIndexFile(dir: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(path.join(dir, MEMORY_INDEX_FILE), 'utf8');
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/**
 * Make a memory in the project's folder (made if missing) from the Agent
 * tab's "New memory", and point MEMORY.md at it so Claude finds it. Returns
 * the file's absolute path, for the editor.
 */
export async function createMemory(
  projectPath: string,
  name: string,
  type: NewMemoryType,
): Promise<string> {
  const dir = await resolveMemoryDir(projectPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const { file, content } = newMemoryFile(name, type, await fs.promises.readdir(dir));
  const full = path.join(dir, file);
  // `wx`: never over a file that appeared since the listing.
  await fs.promises.writeFile(full, content, { encoding: 'utf8', flag: 'wx' });
  const index = await readIndexFile(dir);
  await fs.promises.writeFile(path.join(dir, MEMORY_INDEX_FILE), withIndexLine(index, name, file));
  return full;
}

/**
 * Remove one memory (`file`, a name in the folder itself, never MEMORY.md)
 * through `remove` (the OS trash), and drop MEMORY.md's lines that point at
 * it alone, so Claude isn't sent to a file that's gone.
 */
export async function deleteMemory(
  projectPath: string,
  file: string,
  remove: (fullPath: string) => Promise<void>,
): Promise<void> {
  if (!isMemoryFileName(file)) throw new Error(`Not a memory file: ${file}`);
  const dir = await resolveMemoryDir(projectPath);
  const full = path.join(dir, file);
  await fs.promises.lstat(full);
  await remove(full);
  const index = await readIndexFile(dir);
  if (index === null) return;
  const next = withoutIndexLinks(index, file);
  if (next !== index) await fs.promises.writeFile(path.join(dir, MEMORY_INDEX_FILE), next);
}
