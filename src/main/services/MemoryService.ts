import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  MEMORY_INDEX_FILE,
  type MemoryCreateResult,
  type MemoryDeleteResult,
  type MemoryEntry,
  type MemoryFields,
  type MemoryUpdateResult,
  type ProjectMemory,
} from '@shared/types';
import { claudeProjectDir } from '../utils/claudePaths';
import {
  isWorkspaceTrusted,
  readClaudeSettings,
  type ClaudeSettingsFile,
} from '../utils/claudeSettings';
import { writeFileIfUnchanged } from '../utils/guardedWrite';
import { mapMemoryRefs, memoryLinkFiles } from '@shared/memoryLinks';
import {
  indexHook,
  loadedIndex,
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

/**
 * The `autoMemoryDirectory` Claude would use, or null when no settings file
 * sets one. Like Claude, a folder the repository itself names is only taken
 * once the user has trusted the workspace: a checkout can't point memory
 * reads and writes somewhere of its choosing unasked.
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
  index: string,
  indexed: Set<string>,
  loaded: Set<string>,
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
      pastIndexLimit: indexed.has(file) && !loaded.has(file),
      hook: indexHook(index, file),
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
  const { dir, settings } = await resolveMemory(projectPath);
  const disabledBy = memoryDisabledBy(settings);
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (err) {
    if (isMissing(err)) {
      return { dir, exists: false, index: null, entries: [], dangling: [], disabledBy };
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
  const indexed = memoryLinkFiles(index ?? '');
  const loaded = memoryLinkFiles(loadedIndex(index ?? ''));
  const entries = await Promise.all(
    names
      .filter((n) => n.endsWith('.md') && n !== MEMORY_INDEX_FILE)
      .map((file) => readEntry(dir, file, index ?? '', indexed, loaded)),
  );
  return {
    dir,
    exists: true,
    index,
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

/** Read `full`, with a missing file as the empty string. */
async function readOrEmpty(full: string): Promise<string> {
  return fs.promises.readFile(full, 'utf8').catch((err: unknown) => {
    if (isMissing(err)) return '';
    throw err;
  });
}

/**
 * Rewrite MEMORY.md through `edit`; a missing index is edited as empty. Claude
 * adds its own line right after writing a memory, so the write is guarded like
 * any save and the edit redone on whatever landed in between.
 */
async function editIndex(dir: string, edit: (index: string) => string): Promise<void> {
  const full = path.join(dir, MEMORY_INDEX_FILE);
  for (let attempt = 0; attempt < 3; attempt++) {
    const stat = await fs.promises.stat(full).catch((err: unknown) => {
      if (isMissing(err)) return null;
      throw err;
    });
    const before = await readOrEmpty(full);
    const after = edit(before);
    if (after === before) return;
    const expected = { mtimeMs: stat?.mtimeMs ?? 0, sizeBytes: stat?.size ?? 0 };
    if ((await writeFileIfUnchanged(full, after, expected)).ok) return;
  }
  throw new Error(`${MEMORY_INDEX_FILE} kept changing while it was being updated`);
}

/**
 * Run what follows a memory's own write or removal (its index line, other
 * memories' links). The memory is saved or gone by then (`done` says which),
 * so a failure here is told, not thrown: a thrown one would have the act
 * retried against a file it already changed.
 */
async function afterSave<T>(
  what: string,
  fallback: T,
  step: () => Promise<T>,
  done = 'Saved',
): Promise<{ value: T; warning?: string }> {
  try {
    return { value: await step() };
  } catch (err) {
    console.error(`[MemoryService] ${done.toLowerCase()}, but could not update`, what, err);
    const reason = err instanceof Error ? err.message : String(err);
    return { value: fallback, warning: `${done}, but ${what} could not be updated: ${reason}` };
  }
}

/**
 * Drop MEMORY.md's pointers to memories that no longer exist (Claude or the
 * user deleted the file and left the line). Resolves with the files whose
 * lines went; a line shared with another link is kept.
 */
export async function pruneIndex(projectPath: string): Promise<string[]> {
  const dir = await resolveMemoryDir(projectPath);
  let removed: string[] = [];
  await editIndex(dir, (index) => {
    // Checked against the folder as it is now, not as the caller last saw it.
    const dangling = danglingLinks(index, fs.readdirSync(dir));
    const pruned = dangling.reduce(removeIndexLines, index);
    const left = memoryLinkFiles(pruned);
    removed = dangling.filter((f) => !left.has(f));
    return pruned;
  });
  return removed;
}

/**
 * Write a new memory and index it, creating the folder if Claude hasn't yet.
 * The file is named after the memory; an existing one is never replaced.
 * `hook` is its line's text in MEMORY.md: the description unless given.
 */
export async function createMemory(
  projectPath: string,
  fields: MemoryFields,
  hook?: string,
): Promise<MemoryCreateResult> {
  const dir = await resolveMemoryDir(projectPath);
  const file = memoryFileName(fields.name);
  await fs.promises.mkdir(dir, { recursive: true });
  const written = await writeFileIfUnchanged(path.join(dir, file), serializeMemoryFile(fields), {
    mtimeMs: 0,
    sizeBytes: 0,
  });
  if (!written.ok) throw new Error(`A memory file named ${file} already exists`);
  // Unindexed, Claude never loads it: the index line is part of creating it.
  const { warning } = await afterSave(MEMORY_INDEX_FILE, undefined, () =>
    editIndex(dir, (index) => setIndexLine(index, file, fields, { hook })),
  );
  return { file, warning };
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
 * `hook` rewords its MEMORY.md line; without one the line's hook is kept.
 */
export async function updateMemory(
  projectPath: string,
  file: string,
  fields: MemoryFields,
  expected: { mtimeMs: number; sizeBytes: number },
  hook?: string,
): Promise<MemoryUpdateResult> {
  const dir = await resolveMemoryDir(projectPath);
  const full = path.join(dir, file);
  const existing = await readOrEmpty(full);
  const result = await writeFileIfUnchanged(full, serializeMemoryFile(fields, existing), expected);
  if (!result.ok) return result;
  const before = parseMemoryFile(existing);
  // What it answered to, in the list and in `[[links]]`: its name, or its basename when it had none.
  const oldName = before.name || file.replace(/\.md$/, '');
  // The index line is how Claude finds the memory: one the index never linked
  // gets its line, and an existing line follows the edit (see setIndexLine).
  const indexed = await afterSave(MEMORY_INDEX_FILE, undefined, () =>
    editIndex(dir, (index) => setIndexLine(index, file, fields, { wasName: oldName, hook })),
  );
  // A name with `]` can't be written as a link, so there is nothing to move to.
  const renamed = oldName !== fields.name && !fields.name.includes(']');
  const relinked = await afterSave('links to its old name', [], async () =>
    renamed ? relinkMemories(dir, file, oldName, fields.name) : [],
  );
  return { ...result, relinked: relinked.value, warning: indexed.warning ?? relinked.warning };
}

/**
 * Remove a memory and its MEMORY.md pointer. `remove` disposes of the file
 * (the IPC layer moves it to the OS trash). A file that can't be removed
 * throws and leaves the index alone; a pointer that can't be dropped after
 * the file went is a `warning`, like a save's.
 */
export async function deleteMemory(
  projectPath: string,
  file: string,
  remove: (full: string) => Promise<void> = (full) => fs.promises.unlink(full),
): Promise<MemoryDeleteResult> {
  const dir = await resolveMemoryDir(projectPath);
  const full = path.join(dir, file);
  // Already gone (Claude deleted it meanwhile): its pointer is still there to drop.
  if (fs.existsSync(full)) await remove(full);
  const { warning } = await afterSave(
    MEMORY_INDEX_FILE,
    undefined,
    () => editIndex(dir, (index) => removeIndexLines(index, file)),
    'Moved to the trash',
  );
  return { warning };
}
