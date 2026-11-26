import { ipcMain } from 'electron';
import { z } from 'zod';
import { promises as fs, realpathSync } from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { parseArgs, errorResponse, IpcError } from './validate';
import { parseBlameIncremental } from '../services/blameParser';
import { DatabaseService } from '../services/DatabaseService';
import { isProjectMemoryDir } from '../services/MemoryService';
import { listPlainFolder } from '../services/plainFolder';
import { isServedScratchpad } from '../services/ScratchpadService';
import { outsideRoots } from '../services/editorRoots';
import { unwatchWorkingTree, watchWorkingTree } from '../services/WorkingTreeWatcher';
import type {
  DirEntry,
  EditorBlameResult,
  EditorCommitListItem,
  EditorReadBranchResult,
  EditorReadCommitResult,
  EditorReadWorkingResult,
  EditorWriteResult,
  FileChange,
  FileChangeStatus,
  IpcResponse,
  RepoListing,
  WorkingRef,
} from '@shared/types';

const execFileAsync = promisify(execFile);
const LARGE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function safeRealpath(p: string): string {
  return realpathSync.native ? realpathSync.native(p) : realpathSync(p);
}

function resolveTargetReal(target: string): string {
  try {
    return safeRealpath(target);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
  let ancestor = path.dirname(target);
  let tail = path.basename(target);
  for (;;) {
    try {
      return path.join(safeRealpath(ancestor), tail);
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
      tail = path.join(path.basename(ancestor), tail);
      const next = path.dirname(ancestor);
      if (next === ancestor) return target;
      ancestor = next;
    }
  }
}

/** The path is inside cwd, but a symlink on the way leads out of it. */
class SymlinkEscapeError extends Error {
  constructor(
    /** The path as named, inside cwd. */
    readonly target: string,
    real: string,
  ) {
    super(`Resolved path via symlink escapes cwd: ${real}`);
  }
}

export function resolveInsideCwd(cwd: string, filePath: string): string {
  if (filePath.includes('\0')) {
    throw new Error('Invalid filePath: contains null byte');
  }
  const cwdAbs = path.resolve(cwd);
  const target = path.isAbsolute(filePath) ? filePath : path.resolve(cwdAbs, filePath);
  const rel = path.relative(cwdAbs, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Resolved path escapes cwd: ${target}`);
  }
  let cwdReal: string;
  try {
    cwdReal = safeRealpath(cwdAbs);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
    cwdReal = cwdAbs;
  }
  const real = resolveTargetReal(target);
  const realRel = path.relative(cwdReal, real);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    throw new SymlinkEscapeError(target, real);
  }
  return real;
}

/**
 * For reading only: like `resolveInsideCwd`, but a symlink inside cwd may lead
 * out of it (a worktree's `node_modules` linked to the main checkout's). The
 * path as named must still be inside cwd. Writes keep the stricter rule.
 */
export function resolveReadableInsideCwd(cwd: string, filePath: string): string {
  try {
    return resolveInsideCwd(cwd, filePath);
  } catch (err) {
    if (err instanceof SymlinkEscapeError) return err.target;
    throw err;
  }
}

/** Whether `p` names something strictly inside `dir`, as written (no links followed). */
function namedInside(dir: string, p: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(dir, p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Where an editor file lives, checked (A10): in `cwd`, the task's worktree,
 * where git applies; or, named by its absolute path, in one of `outside`, the
 * task's own Claude Code folders (`outsideRoots`), as a plain file. The path
 * as named and its real path must both stay in that one folder, or this
 * throws. A read in the worktree may follow a symlink out of it
 * (`resolveReadableInsideCwd`); an outside folder's never may.
 */
export function resolveEditorPath(
  cwd: string,
  filePath: string,
  outside: readonly string[],
  access: 'read' | 'write',
): { abs: string; plain: boolean } {
  if (!path.isAbsolute(filePath) || namedInside(cwd, filePath)) {
    const abs =
      access === 'read' ? resolveReadableInsideCwd(cwd, filePath) : resolveInsideCwd(cwd, filePath);
    return { abs, plain: false };
  }
  const root = outside.find((dir) => namedInside(dir, filePath));
  if (!root) throw new Error(`Resolved path escapes cwd: ${filePath}`);
  return { abs: resolveInsideCwd(root, filePath), plain: true };
}

/** Refuse to read a directory as a file (a stale tab, a racing rename). */
function assertNotDirectory(stat: { isDirectory(): boolean }, filePath: string): void {
  if (stat.isDirectory()) throw new IpcError(`${filePath} is a directory`, 'IS_DIRECTORY');
}

export function isBinaryBuffer(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8000);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    pyi: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    jsonc: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    lua: 'lua',
  };
  return map[ext] || '';
}

/** Read a file at a git revision. Returns '' when missing (untracked / new file
 *  in the working tree, or absent from the parent of an added commit). */
async function gitShow(cwd: string, revisionPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['show', revisionPath], {
      cwd,
      maxBuffer: LARGE_FILE_BYTES * 2,
      timeout: 15000,
    });
    return stdout;
  } catch {
    return '';
  }
}

function statusFromGitCode(code: string): FileChangeStatus {
  // git diff-tree --name-status emits A, M, D, R<score>, C<score>, T.
  if (code.startsWith('A')) return 'added';
  if (code.startsWith('D')) return 'deleted';
  if (code.startsWith('R')) return 'renamed';
  if (code.startsWith('C')) return 'renamed'; // treat copy like rename for UX
  return 'modified';
}

// Asked once per folder: the answer only changes when projects come and go.
const memoryFolderChecks = new Map<string, Promise<boolean>>();

/**
 * Whether `cwd` is one of Claude's own folders the editor opens: a project's
 * memory folder (the memory modal, the Agent tab) or a task session's
 * scratchpad (the Agent tab). The editor shows one as plain files, without
 * git, even when the folder sits inside some other repository.
 */
function isPlainFolder(cwd: string): Promise<boolean> {
  if (isServedScratchpad(cwd)) return Promise.resolve(true);
  let check = memoryFolderChecks.get(cwd);
  if (!check) {
    const projectPaths = DatabaseService.getProjects().map((p) => p.path);
    check = isProjectMemoryDir(cwd, projectPaths);
    memoryFolderChecks.set(cwd, check);
  }
  return check;
}

/** Whether `abs` is a directory, following symlinks (a broken link isn't). */
async function isDirectoryFollowingLinks(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isDirectory();
  } catch {
    return false;
  }
}

/** Split `paths` (relative to `cwd`) into files and directories, following
 *  symlinks: git lists a symlinked directory as one file-like entry. */
export async function splitDirectories(cwd: string, paths: string[]): Promise<RepoListing> {
  const isDir = await Promise.all(paths.map((p) => isDirectoryFollowingLinks(path.join(cwd, p))));
  return {
    files: paths.filter((_, i) => !isDir[i]),
    dirs: paths.filter((_, i) => isDir[i]),
  };
}

const SYMLINK_MODE = '120000';

/** Parse `git ls-files -s -z` (`<mode> <object> <stage>\t<path>\0`): each
 *  path once (a conflicted file has a line per stage), flagged when git
 *  stores it as a symlink. */
export function parseLsFilesStageZ(out: string): { path: string; symlink: boolean }[] {
  const seen = new Map<string, boolean>();
  for (const record of out.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const p = record.slice(tab + 1);
    if (!seen.has(p)) seen.set(p, record.startsWith(SYMLINK_MODE));
  }
  return Array.from(seen, ([p, symlink]) => ({ path: p, symlink }));
}

/** The working tree's files: tracked + untracked, not ignored. A symlinked
 *  directory (git lists it as a file) comes back in `dirs`. Only symlinks and
 *  untracked entries are stat'ed; tracked regular files are taken as files. */
export async function listWorkingRepoFiles(cwd: string): Promise<RepoListing> {
  // Claude's own folders aren't repositories: their files are the listing,
  // a session's scratchpad all the way down, a memory folder (flat by
  // design) its own files only.
  if (isServedScratchpad(cwd)) return listPlainFolder(cwd);
  if (await isPlainFolder(cwd)) {
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    return {
      files: entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort(),
      dirs: [],
    };
  }
  const tracked = parseLsFilesStageZ(
    (
      await execFileAsync('git', ['ls-files', '-s', '-z'], {
        cwd,
        maxBuffer: 50 * 1024 * 1024,
        timeout: 15000,
      })
    ).stdout,
  );
  let untracked: string[] = [];
  try {
    untracked = (
      await execFileAsync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
        cwd,
        maxBuffer: 50 * 1024 * 1024,
        timeout: 15000,
      })
    ).stdout
      .split('\0')
      .filter(Boolean);
  } catch {
    /* no untracked */
  }
  const loose = await splitDirectories(cwd, [
    ...tracked.filter((t) => t.symlink).map((t) => t.path),
    ...untracked,
  ]);
  const files = new Set([...tracked.filter((t) => !t.symlink).map((t) => t.path), ...loose.files]);
  return { files: Array.from(files).sort(), dirs: loose.dirs.sort() };
}

/**
 * Gitignored paths in the working tree. `--directory` collapses a fully-ignored
 * directory (e.g. `node_modules/`, `dist/`) to one entry instead of listing every
 * file inside it, so the tree stays usable; those come back in `dirs`, for the
 * tree to list lazily. Best-effort: a repo with no ignores (or a git error)
 * yields an empty listing.
 */
export async function listIgnoredRepoFiles(cwd: string): Promise<RepoListing> {
  let out: string;
  try {
    out = (
      await execFileAsync(
        'git',
        ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'],
        { cwd, maxBuffer: 50 * 1024 * 1024, timeout: 15000 },
      )
    ).stdout;
  } catch {
    return { files: [], dirs: [] };
  }
  const entries = parseIgnoredListingZ(out);
  // An ignored symlink to a directory has no trailing slash: stat those.
  const loose = await splitDirectories(
    cwd,
    entries.filter((e) => !e.dir).map((e) => e.path),
  );
  return {
    files: loose.files,
    dirs: [...entries.filter((e) => e.dir).map((e) => e.path), ...loose.dirs].sort(),
  };
}

/**
 * Parse `git ls-files -z --others --ignored --exclude-standard --directory`.
 * A collapsed directory carries a trailing slash: it's stripped and the entry
 * flagged `dir`. Git lists a collapsed directory *and* its children when the
 * directory holds a nested repository (every Dash project does:
 * `.claude/worktrees/<task>/.git`), which would render `.claude` as both a
 * file row and a folder; entries under an already-listed directory are
 * dropped so each ignored subtree is one entry.
 */
export function parseIgnoredListingZ(out: string): { path: string; dir: boolean }[] {
  const entries = out
    .split('\0')
    .filter(Boolean)
    .map((p) => ({ path: p.replace(/\/$/, ''), dir: p.endsWith('/') }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // Sorted, so a directory always precedes anything under it.
  const kept = new Set<string>();
  const result: { path: string; dir: boolean }[] = [];
  for (const e of entries) {
    let nested = false;
    for (let i = e.path.indexOf('/'); i !== -1; i = e.path.indexOf('/', i + 1)) {
      if (kept.has(e.path.slice(0, i))) {
        nested = true;
        break;
      }
    }
    if (nested || kept.has(e.path)) continue;
    kept.add(e.path);
    result.push(e);
  }
  return result;
}

/** One directory's entries for the tree, `.git` left out. Symlinks are
 *  followed to tell folders from files; nothing below is walked. */
export async function listDirectory(cwd: string, dirPath: string): Promise<DirEntry[]> {
  const abs = resolveReadableInsideCwd(cwd, dirPath);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const listed = await Promise.all(
    entries
      .filter((e) => e.name !== '.git')
      .map(async (e) => ({
        name: e.name,
        dir:
          e.isDirectory() ||
          (e.isSymbolicLink() && (await isDirectoryFollowingLinks(path.join(abs, e.name)))),
      })),
  );
  return listed.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

async function listCommitRepoFiles(cwd: string, hash: string): Promise<RepoListing> {
  const out = (
    await execFileAsync('git', ['ls-tree', '-r', '-z', '--name-only', hash], {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 15000,
    })
  ).stdout;
  // A commit's symlinks are blobs (their target path): files here.
  return { files: out.split('\0').filter(Boolean).sort(), dirs: [] };
}

/** `git log --numstat`'s format for `parseCommitLog`: each commit opens with
 *  \x1e, its fields split by \x1f (the body, which can hold newlines, last),
 *  and \x1d closes them before its numstat rows. */
export const COMMIT_LOG_FORMAT = '%x1e%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%b%x1d';

/** The lines a commit's numstat rows add up to: `<adds>\t<dels>\t<path>`,
 *  binary files ('-') counting 0. Numbers only, so locale-independent. */
function numstatTotals(rows: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of rows.split('\n')) {
    const [adds, dels, path] = line.split('\t');
    if (path === undefined) continue;
    additions += parseInt(adds!, 10) || 0;
    deletions += parseInt(dels!, 10) || 0;
  }
  return { additions, deletions };
}

/** Parse `git log --numstat --format=COMMIT_LOG_FORMAT`: one git call for the
 *  commits and their line totals. A merge carries no numstat and stays 0/0. */
export function parseCommitLog(stdout: string): EditorCommitListItem[] {
  const commits: EditorCommitListItem[] = [];
  for (const record of stdout.split('\x1e')) {
    const end = record.indexOf('\x1d');
    if (end < 0) continue;
    const parts = record.slice(0, end).split('\x1f');
    if (parts.length < 6) continue;
    commits.push({
      hash: parts[0]!,
      shortHash: parts[1]!,
      authorName: parts[2] || '',
      authorDate: parseInt(parts[3]!, 10) || 0,
      subject: parts[4] || '',
      body: parts.slice(5).join('\x1f').trim(),
      ...numstatTotals(record.slice(end + 1)),
    });
  }
  return commits;
}

/** Git object specs (`<rev>:<path>`) and pathspecs require forward slashes.
 *  On Windows, path.relative() yields '\\' separators, which make
 *  `git show HEAD:sub\file` fail and return '' — rendering the whole file as
 *  added in the diff view. Gated to Windows on purpose: there '\\' is never a
 *  legal filename character so converting it is unambiguous, whereas on POSIX a
 *  backslash IS a valid character in a filename and must be left untouched. */
export function toGitPath(relPath: string): string {
  return process.platform === 'win32' ? relPath.replace(/\\/g, '/') : relPath;
}

export function registerEditorIpc(): void {
  // ── editor:readWorking ────────────────────────────────────────
  ipcMain.handle(
    'editor:readWorking',
    async (
      _event,
      args: { cwd: string; filePath: string; ref: WorkingRef },
    ): Promise<IpcResponse<EditorReadWorkingResult>> => {
      try {
        parseArgs(
          'editor:readWorking',
          z.looseObject({
            cwd: z.string(),
            filePath: z.string(),
            ref: z.enum(['HEAD', 'index']),
          }),
          args,
        );
        const { abs, plain } = resolveEditorPath(
          args.cwd,
          args.filePath,
          path.isAbsolute(args.filePath) ? await outsideRoots(args.cwd) : [],
          'read',
        );
        const plainFolder = plain || (await isPlainFolder(args.cwd));
        let originalContent = '';
        if (!plainFolder) {
          const cwdAbs = path.resolve(args.cwd);
          let cwdReal = cwdAbs;
          try {
            cwdReal = safeRealpath(cwdAbs);
          } catch {
            /* cwdAbs is fine */
          }
          const relForGit = toGitPath(path.relative(cwdReal, abs));
          const spec = args.ref === 'HEAD' ? `HEAD:${relForGit}` : `:0:${relForGit}`;
          originalContent = await gitShow(args.cwd, spec);
        }

        let workingContent: string | null = null;
        let mtimeMs = 0;
        let sizeBytes = 0;
        let isBinary = false;
        let isLargeFile = false;

        try {
          const stat = await fs.stat(abs);
          assertNotDirectory(stat, args.filePath);
          mtimeMs = stat.mtimeMs;
          sizeBytes = stat.size;
          if (stat.size > LARGE_FILE_BYTES) {
            isLargeFile = true;
          } else {
            const buf = await fs.readFile(abs);
            if (isBinaryBuffer(buf)) {
              isBinary = true;
            } else {
              workingContent = buf.toString('utf8');
            }
          }
        } catch (err: unknown) {
          if ((err as { code?: string }).code !== 'ENOENT') throw err;
          // workingContent stays null — file deleted on disk.
        }

        // A plain folder (memory, scratchpad) has no HEAD to compare with: the file as it is on
        // disk is the original, so only unsaved edits show as changes.
        if (plainFolder) originalContent = workingContent ?? '';

        return {
          success: true,
          data: {
            originalContent,
            workingContent,
            mtimeMs,
            sizeBytes,
            isBinary,
            isLargeFile,
            language: detectLanguage(args.filePath),
          },
        };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:readCommit ─────────────────────────────────────────
  ipcMain.handle(
    'editor:readCommit',
    async (
      _event,
      args: { cwd: string; filePath: string; hash: string; base?: string },
    ): Promise<IpcResponse<EditorReadCommitResult>> => {
      try {
        parseArgs(
          'editor:readCommit',
          z.looseObject({
            cwd: z.string(),
            filePath: z.string(),
            hash: z.string(),
            base: z.string().optional(),
          }),
          args,
        );
        const abs = resolveInsideCwd(args.cwd, args.filePath);
        const cwdAbs = path.resolve(args.cwd);
        let cwdReal = cwdAbs;
        try {
          cwdReal = safeRealpath(cwdAbs);
        } catch {
          /* cwdAbs is fine */
        }
        const relForGit = toGitPath(path.relative(cwdReal, abs));

        // Try `base` (a PR's merge-base) or else the parent for original. If the
        // hash has no parent (root commit), gitShow falls through to '' — every
        // file is then an addition.
        const original = await gitShow(args.cwd, `${args.base ?? `${args.hash}~1`}:${relForGit}`);
        const modified = await gitShow(args.cwd, `${args.hash}:${relForGit}`);

        const modifiedBuf = Buffer.from(modified, 'utf8');
        const isLargeFile = modifiedBuf.length > LARGE_FILE_BYTES;
        const isBinary = !isLargeFile && isBinaryBuffer(modifiedBuf);

        return {
          success: true,
          data: {
            originalContent: original,
            modifiedContent: modified,
            isBinary,
            isLargeFile,
            language: detectLanguage(args.filePath),
          },
        };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:blame ──────────────────────────────────────────────
  ipcMain.handle(
    'editor:blame',
    async (
      _event,
      args: { cwd: string; filePath: string; ref: string | null },
    ): Promise<IpcResponse<EditorBlameResult>> => {
      try {
        parseArgs(
          'editor:blame',
          z.looseObject({
            cwd: z.string(),
            filePath: z.string(),
            ref: z.string().nullable(),
          }),
          args,
        );
        const abs = resolveInsideCwd(args.cwd, args.filePath);
        const cwdAbs = path.resolve(args.cwd);
        let cwdReal = cwdAbs;
        try {
          cwdReal = safeRealpath(cwdAbs);
        } catch {
          /* cwdAbs is fine */
        }
        const relForGit = toGitPath(path.relative(cwdReal, abs));
        const blameArgs = [
          'blame',
          '--incremental',
          ...(args.ref ? [args.ref] : []),
          '--',
          relForGit,
        ];

        let stdout = '';
        try {
          ({ stdout } = await execFileAsync('git', blameArgs, {
            cwd: args.cwd,
            maxBuffer: LARGE_FILE_BYTES,
            timeout: 15000,
          }));
        } catch {
          // Untracked / new / binary / unreadable files have no blame.
          return { success: true, data: { lines: [] } };
        }
        return { success: true, data: { lines: parseBlameIncremental(stdout) } };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:writeWorking ───────────────────────────────────────
  ipcMain.handle(
    'editor:writeWorking',
    async (
      _event,
      args: {
        cwd: string;
        filePath: string;
        content: string;
        expectedMtimeMs: number;
        expectedSizeBytes: number;
      },
    ): Promise<IpcResponse<EditorWriteResult>> => {
      try {
        parseArgs(
          'editor:writeWorking',
          z.looseObject({
            cwd: z.string(),
            filePath: z.string(),
            content: z.string(),
            expectedMtimeMs: z.number(),
            expectedSizeBytes: z.number(),
          }),
          args,
        );
        const { abs } = resolveEditorPath(
          args.cwd,
          args.filePath,
          path.isAbsolute(args.filePath) ? await outsideRoots(args.cwd) : [],
          'write',
        );

        try {
          const stat = await fs.stat(abs);
          if (stat.mtimeMs !== args.expectedMtimeMs || stat.size !== args.expectedSizeBytes) {
            return {
              success: true,
              data: {
                ok: false,
                stale: true,
                currentMtimeMs: stat.mtimeMs,
                currentSizeBytes: stat.size,
              },
            };
          }
        } catch (err: unknown) {
          if ((err as { code?: string }).code !== 'ENOENT') throw err;
          if (args.expectedMtimeMs !== 0 || args.expectedSizeBytes !== 0) {
            return {
              success: true,
              data: {
                ok: false,
                stale: true,
                currentMtimeMs: 0,
                currentSizeBytes: 0,
              },
            };
          }
        }

        const dir = path.dirname(abs);
        const base = path.basename(abs);
        const rand = Math.floor(Math.random() * 0xffffffff).toString(16);
        const tmp = path.join(dir, `.${base}.dash-tmp-${rand}`);
        await fs.writeFile(tmp, args.content, { encoding: 'utf8', mode: 0o644 });
        try {
          await fs.rename(tmp, abs);
        } catch (err) {
          await fs.unlink(tmp).catch(() => {});
          throw err;
        }

        const stat = await fs.stat(abs);
        return {
          success: true,
          data: { ok: true, mtimeMs: stat.mtimeMs, sizeBytes: stat.size },
        };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:listCommits ────────────────────────────────────────
  ipcMain.handle(
    'editor:listCommits',
    async (
      _event,
      args: { cwd: string; limit?: number; range?: { base: string; head: string } },
    ): Promise<IpcResponse<EditorCommitListItem[]>> => {
      try {
        const sha = z.string().regex(/^[0-9a-f]{4,64}$/i);
        parseArgs(
          'editor:listCommits',
          z.looseObject({
            cwd: z.string(),
            limit: z.number().optional(),
            range: z.object({ base: sha, head: sha }).optional(),
          }),
          args,
        );
        const limit = args.limit ?? 50;
        // HEAD's history, or a PR's commits (base..head, both present locally).
        const rev = args.range ? `${args.range.base}..${args.range.head}` : 'HEAD';
        const { stdout } = await execFileAsync(
          'git',
          ['log', '--numstat', `--max-count=${limit}`, `--format=${COMMIT_LOG_FORMAT}`, rev],
          { cwd: args.cwd, maxBuffer: 5 * 1024 * 1024, timeout: 15000 },
        );
        return { success: true, data: parseCommitLog(stdout) };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:listFilesInCommit ──────────────────────────────────
  ipcMain.handle(
    'editor:listFilesInCommit',
    async (
      _event,
      args: { cwd: string; hash: string; base?: string },
    ): Promise<IpcResponse<FileChange[]>> => {
      try {
        parseArgs(
          'editor:listFilesInCommit',
          z.looseObject({ cwd: z.string(), hash: z.string(), base: z.string().optional() }),
          args,
        );
        // Against `base` when given (a PR's merge-base), else the parent.
        let base = args.base ?? `${args.hash}~1`;
        if (!args.base) {
          try {
            await execFileAsync('git', ['rev-parse', '--verify', `${args.hash}~1`], {
              cwd: args.cwd,
              timeout: 5000,
            });
          } catch {
            base = EMPTY_TREE;
          }
        }

        const nameStatusOut = (
          await execFileAsync(
            'git',
            ['diff-tree', '--no-commit-id', '-r', '--name-status', base, args.hash],
            { cwd: args.cwd, maxBuffer: 5 * 1024 * 1024, timeout: 15000 },
          )
        ).stdout;

        const numStatOut = (
          await execFileAsync(
            'git',
            ['diff-tree', '--no-commit-id', '-r', '--numstat', base, args.hash],
            { cwd: args.cwd, maxBuffer: 5 * 1024 * 1024, timeout: 15000 },
          )
        ).stdout;

        const stats = new Map<string, { additions: number; deletions: number }>();
        for (const line of numStatOut.split('\n')) {
          if (!line.trim()) continue;
          const [adds, dels, ...pathParts] = line.split('\t');
          const p = pathParts.join('\t');
          if (!p) continue;
          stats.set(p, {
            additions: adds === '-' ? 0 : parseInt(adds ?? '', 10) || 0,
            deletions: dels === '-' ? 0 : parseInt(dels ?? '', 10) || 0,
          });
        }

        const files: FileChange[] = [];
        for (const line of nameStatusOut.split('\n')) {
          if (!line.trim()) continue;
          const parts = line.split('\t');
          const code = parts[0]!;
          const status = statusFromGitCode(code);
          const filePath = parts[parts.length - 1]!;
          const oldPath = code.startsWith('R') || code.startsWith('C') ? parts[1] : undefined;
          const stat = stats.get(filePath) ?? { additions: 0, deletions: 0 };
          files.push({
            path: filePath,
            status,
            staged: true,
            additions: stat.additions,
            deletions: stat.deletions,
            oldPath,
          });
        }
        return { success: true, data: files };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:listRepoFiles ──────────────────────────────────────
  // Every file in the repo for the given source (used to render a full repo
  // tree with diff indicators overlaid). Working: tracked + untracked
  // (excluding gitignored). Commit: every file at that revision.
  ipcMain.handle(
    'editor:listRepoFiles',
    async (
      _event,
      args: { cwd: string; source: { kind: 'working' } | { kind: 'commit'; hash: string } },
    ): Promise<IpcResponse<RepoListing>> => {
      try {
        parseArgs(
          'editor:listRepoFiles',
          z.looseObject({ cwd: z.string(), source: z.looseObject({ kind: z.string() }) }),
          args,
        );
        const listing =
          args.source.kind === 'working'
            ? await listWorkingRepoFiles(args.cwd)
            : await listCommitRepoFiles(args.cwd, args.source.hash);
        return { success: true, data: listing };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:listIgnoredFiles ───────────────────────────────────
  // Gitignored paths in the working tree, fully-ignored directories collapsed
  // to a single entry (listed lazily through editor:listDir).
  ipcMain.handle(
    'editor:listIgnoredFiles',
    async (_event, args: { cwd: string }): Promise<IpcResponse<RepoListing>> => {
      try {
        parseArgs('editor:listIgnoredFiles', z.looseObject({ cwd: z.string() }), args);
        return { success: true, data: await listIgnoredRepoFiles(args.cwd) };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:watchTree / editor:unwatchTree ─────────────────────
  // The all-files tree is showing `cwd`: 'editor:treeChanged' tells it when a
  // file or folder under it comes, goes or is renamed, so its listings reload.
  ipcMain.handle('editor:watchTree', (_event, args: { cwd: string }): IpcResponse<void> => {
    try {
      parseArgs('editor:watchTree', z.looseObject({ cwd: z.string() }), args);
      watchWorkingTree(args.cwd);
      return { success: true };
    } catch (err) {
      return errorResponse(err);
    }
  });
  ipcMain.handle('editor:unwatchTree', (_event, args: { cwd: string }): IpcResponse<void> => {
    try {
      parseArgs('editor:unwatchTree', z.looseObject({ cwd: z.string() }), args);
      unwatchWorkingTree(args.cwd);
      return { success: true };
    } catch (err) {
      return errorResponse(err);
    }
  });

  // ── editor:listDir ────────────────────────────────────────────
  // One directory's entries, when the tree expands a folder git lists as one
  // entry (ignored, or a symlink).
  ipcMain.handle(
    'editor:listDir',
    async (_event, args: { cwd: string; dirPath: string }): Promise<IpcResponse<DirEntry[]>> => {
      try {
        parseArgs('editor:listDir', z.looseObject({ cwd: z.string(), dirPath: z.string() }), args);
        return { success: true, data: await listDirectory(args.cwd, args.dirPath) };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:readAgainstBase ────────────────────────────────────
  // Left = git show <base>:<path>; right = working tree on disk. Edits to
  // the right side go through editor:writeWorking unchanged.
  ipcMain.handle(
    'editor:readAgainstBase',
    async (
      _event,
      args: { cwd: string; filePath: string; base: string },
    ): Promise<IpcResponse<EditorReadBranchResult>> => {
      try {
        parseArgs(
          'editor:readAgainstBase',
          z.looseObject({ cwd: z.string(), filePath: z.string(), base: z.string() }),
          args,
        );
        const abs = resolveReadableInsideCwd(args.cwd, args.filePath);
        const cwdAbs = path.resolve(args.cwd);
        let cwdReal = cwdAbs;
        try {
          cwdReal = safeRealpath(cwdAbs);
        } catch {
          /* cwdAbs is fine */
        }
        const relForGit = toGitPath(path.relative(cwdReal, abs));
        const originalContent = await gitShow(args.cwd, `${args.base}:${relForGit}`);

        let workingContent: string | null = null;
        let mtimeMs = 0;
        let sizeBytes = 0;
        let isBinary = false;
        let isLargeFile = false;

        try {
          const stat = await fs.stat(abs);
          assertNotDirectory(stat, args.filePath);
          mtimeMs = stat.mtimeMs;
          sizeBytes = stat.size;
          if (stat.size > LARGE_FILE_BYTES) {
            isLargeFile = true;
          } else {
            const buf = await fs.readFile(abs);
            if (isBinaryBuffer(buf)) {
              isBinary = true;
            } else {
              workingContent = buf.toString('utf8');
            }
          }
        } catch (err: unknown) {
          if ((err as { code?: string }).code !== 'ENOENT') throw err;
          // workingContent stays null — file deleted on disk relative to base.
        }

        return {
          success: true,
          data: {
            originalContent,
            workingContent,
            mtimeMs,
            sizeBytes,
            isBinary,
            isLargeFile,
            language: detectLanguage(args.filePath),
          },
        };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );
}
