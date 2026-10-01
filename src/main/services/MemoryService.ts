import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  MEMORY_INDEX_FILE,
  type MemoryEntry,
  type MemoryFields,
  type MemoryUpdateResult,
  type ProjectMemory,
} from '@shared/types';
import { claudeProjectDir } from '../utils/claudePaths';
import { writeFileAtomic, writeFileIfUnchanged } from '../utils/guardedWrite';
import { mapMemoryRefs, memoryLinkFiles } from '@shared/memoryLinks';
import {
  memoryFileName,
  parseMemoryFile,
  removeIndexLines,
  serializeMemoryFile,
  setIndexLine,
} from './memoryFiles';

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
      sizeBytes: stat.size,
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

/** Read `full`, with a missing file as the empty string. */
async function readOrEmpty(full: string): Promise<string> {
  return fs.promises.readFile(full, 'utf8').catch((err: unknown) => {
    if (isMissing(err)) return '';
    throw err;
  });
}

/** Rewrite MEMORY.md through `edit`; a missing index is edited as empty. */
async function editIndex(dir: string, edit: (index: string) => string): Promise<void> {
  const full = path.join(dir, MEMORY_INDEX_FILE);
  const before = await readOrEmpty(full);
  const after = edit(before);
  if (after !== before) await writeFileAtomic(full, after);
}

/**
 * Write a new memory and index it, creating the folder if Claude hasn't yet.
 * The file is named after the memory; an existing one is never replaced.
 */
export async function createMemory(projectPath: string, fields: MemoryFields): Promise<string> {
  const dir = await resolveMemoryDir(projectPath);
  const file = memoryFileName(fields.name);
  await fs.promises.mkdir(dir, { recursive: true });
  const written = await writeFileIfUnchanged(path.join(dir, file), serializeMemoryFile(fields), {
    mtimeMs: 0,
    sizeBytes: 0,
  });
  if (!written.ok) throw new Error(`A memory file named ${file} already exists`);
  // Unindexed, Claude never loads it: the index line is part of creating it.
  await editIndex(dir, (index) => setIndexLine(index, file, fields));
  return file;
}

/**
 * Point the other memories' `[[oldName]]` links at `newName`, so a rename
 * doesn't strand them. Resolves with the files it rewrote.
 */
async function relinkMemories(
  dir: string,
  renamed: string,
  oldName: string,
  newName: string,
): Promise<string[]> {
  const names = (await fs.promises.readdir(dir)).filter(
    (n) => n.endsWith('.md') && n !== MEMORY_INDEX_FILE && n !== renamed,
  );
  const others = await Promise.all(
    names.map(async (file) => {
      const full = path.join(dir, file);
      try {
        const [content, stat] = await Promise.all([
          fs.promises.readFile(full, 'utf8'),
          fs.promises.stat(full),
        ]);
        return { file, full, content, expected: { mtimeMs: stat.mtimeMs, sizeBytes: stat.size } };
      } catch (err) {
        if (!isMissing(err)) console.warn('[MemoryService] cannot relink', full, err);
        return null;
      }
    }),
  );
  const readable = others.filter((o) => o !== null);
  // Another memory still answers to the old name: those links are its own now.
  if (readable.some((o) => parseMemoryFile(o.content).name === oldName)) return [];

  const relinked: string[] = [];
  for (const other of readable) {
    const content = mapMemoryRefs(other.content, (ref, match) =>
      ref.trim() === oldName ? `[[${newName}]]` : match,
    );
    if (content === other.content) continue;
    // Guarded like any save: a memory Claude is rewriting right now is skipped.
    const written = await writeFileIfUnchanged(other.full, content, other.expected);
    if (written.ok) relinked.push(other.file);
    else console.warn('[MemoryService] changed while relinking; left as is', other.full);
  }
  return relinked;
}

/**
 * Save `fields` into an existing memory, keeping the rest of its frontmatter,
 * keep its MEMORY.md line in step, and move other memories' links on a rename.
 * `expected` is the mtime and size the caller edited from: if the file has
 * changed since (Claude rewrites memories mid-session) nothing is written.
 */
export async function updateMemory(
  projectPath: string,
  file: string,
  fields: MemoryFields,
  expected: { mtimeMs: number; sizeBytes: number },
): Promise<MemoryUpdateResult> {
  const dir = await resolveMemoryDir(projectPath);
  const full = path.join(dir, file);
  const existing = await readOrEmpty(full);
  const result = await writeFileIfUnchanged(full, serializeMemoryFile(fields, existing), expected);
  if (!result.ok) return result;
  // The index line is how Claude finds the memory, so it follows a rename or a
  // new description, and a memory the index never linked gets its line. A body
  // edit leaves an existing line alone: its hook may be Claude's own wording.
  const before = parseMemoryFile(existing);
  // What it answered to, in the list and in `[[links]]`: its name, or its basename when it had none.
  const oldName = before.name || file.replace(/\.md$/, '');
  const relabelled = oldName !== fields.name || before.description !== fields.description;
  await editIndex(dir, (index) =>
    relabelled || !memoryLinkFiles(index).has(file) ? setIndexLine(index, file, fields) : index,
  );
  // A name with `]` can't be written as a link, so there is nothing to move to.
  const renamed = oldName !== fields.name && !fields.name.includes(']');
  const relinked = renamed ? await relinkMemories(dir, file, oldName, fields.name) : [];
  return { ...result, relinked };
}

/**
 * Remove a memory and its MEMORY.md pointer. `remove` disposes of the file
 * (the IPC layer moves it to the OS trash).
 */
export async function deleteMemory(
  projectPath: string,
  file: string,
  remove: (full: string) => Promise<void> = (full) => fs.promises.unlink(full),
): Promise<void> {
  const dir = await resolveMemoryDir(projectPath);
  await remove(path.join(dir, file));
  await editIndex(dir, (index) => removeIndexLines(index, file));
}
