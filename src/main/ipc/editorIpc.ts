import { ipcMain } from 'electron';
import { z } from 'zod';
import { promises as fs, realpathSync } from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { parseArgs, errorResponse, ipcError } from './validate';
import { parseBlameIncremental } from '../services/blameParser';
import type {
  EditorBlameResult,
  EditorCommitListItem,
  EditorReadBranchResult,
  EditorReadCommitResult,
  EditorReadWorkingResult,
  EditorWriteResult,
  FileChange,
  FileChangeStatus,
  IpcResponse,
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
    throw new Error(`Resolved path via symlink escapes cwd: ${real}`);
  }
  return real;
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
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
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

async function listWorkingRepoFiles(cwd: string): Promise<string[]> {
  const tracked = (
    await execFileAsync('git', ['ls-files', '-z'], {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 15000,
    })
  ).stdout
    .split('\0')
    .filter(Boolean);
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
  // Dedup; tracked + untracked are disjoint already, but be defensive.
  return Array.from(new Set([...tracked, ...untracked])).sort();
}

async function listCommitRepoFiles(cwd: string, hash: string): Promise<string[]> {
  const out = (
    await execFileAsync('git', ['ls-tree', '-r', '-z', '--name-only', hash], {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 15000,
    })
  ).stdout;
  return out.split('\0').filter(Boolean).sort();
}

/** Resolve the repo's default base branch.
 *  Preference order:
 *   1. `origin/HEAD` symbolic ref (whatever the remote calls its default)
 *   2. local `main`
 *   3. local `master`
 *  Returns `null` when none of the above can be resolved. */
export async function resolveDefaultBase(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { cwd, timeout: 5000 },
    );
    const ref = stdout.trim();
    if (ref) return ref;
  } catch {
    /* origin/HEAD not set; fall through */
  }
  for (const candidate of ['main', 'master']) {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', candidate], {
        cwd,
        timeout: 5000,
      });
      return candidate;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/** Parse `git diff --name-status -z <base>` output.
 *  Record format alternates: <code>\0<path>\0 for M/A/D, and
 *  <R|C><score>\0<oldPath>\0<newPath>\0 for renames/copies. */
export function parseDiffNameStatusZ(
  raw: string,
): Array<{ status: FileChangeStatus; path: string; oldPath: string | undefined }> {
  const tokens = raw.split('\0').filter((t) => t.length > 0);
  const out: Array<{ status: FileChangeStatus; path: string; oldPath: string | undefined }> = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i++];
    if (code == null) break;
    const isRename = code.startsWith('R') || code.startsWith('C');
    if (isRename) {
      const oldPath = tokens[i++];
      const newPath = tokens[i++];
      if (oldPath == null || newPath == null) break;
      out.push({ status: 'renamed', path: newPath, oldPath });
    } else {
      const path = tokens[i++];
      if (path == null) break;
      out.push({ status: statusFromGitCode(code), path, oldPath: undefined });
    }
  }
  return out;
}

/** Parse `git diff --numstat -z <base>` output into a path → {adds, dels} map.
 *  For renames, numstat emits <adds>\t<dels>\t<old>\0<new>\0 (the stats
 *  apply to the renamed file at its new path). */
export function parseDiffNumstatZ(
  raw: string,
): Map<string, { additions: number; deletions: number }> {
  const tokens = raw.split('\0').filter((t) => t.length > 0);
  const map = new Map<string, { additions: number; deletions: number }>();
  let i = 0;
  while (i < tokens.length) {
    const head = tokens[i++];
    if (head == null) break;
    const tabIdx1 = head.indexOf('\t');
    const tabIdx2 = head.indexOf('\t', tabIdx1 + 1);
    if (tabIdx1 < 0 || tabIdx2 < 0) continue;
    const addsStr = head.slice(0, tabIdx1);
    const delsStr = head.slice(tabIdx1 + 1, tabIdx2);
    const firstPath = head.slice(tabIdx2 + 1);
    const additions = addsStr === '-' ? 0 : parseInt(addsStr, 10) || 0;
    const deletions = delsStr === '-' ? 0 : parseInt(delsStr, 10) || 0;
    // When the next token does NOT contain a tab, this is a rename and the
    // next token is the new path (where the stats apply).
    const next = tokens[i];
    const isRename = next != null && !next.includes('\t');
    if (isRename) {
      const newPath = next;
      i++;
      map.set(newPath, { additions, deletions });
    } else {
      map.set(firstPath, { additions, deletions });
    }
  }
  return map;
}

/** Parse `git log --numstat --format=%x1f%H` into a commit-hash → {adds, dels}
 *  map, summing per-file numstat across each commit. A line beginning with the
 *  unit-separator (\x1f) starts a new commit; numstat rows are `<adds>\t<dels>
 *  \t<path>` (binary files use '-'). Locale-independent (numbers only); merge
 *  commits emit no numstat and stay at 0/0. */
export function parseCommitNumstatLog(
  stdout: string,
): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  let current: { additions: number; deletions: number } | null = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('\x1f')) {
      const hash = line.slice(1).trim();
      if (!hash) {
        current = null;
        continue;
      }
      current = { additions: 0, deletions: 0 };
      map.set(hash, current);
      continue;
    }
    if (!current || !line) continue;
    const t1 = line.indexOf('\t');
    if (t1 < 0) continue;
    const t2 = line.indexOf('\t', t1 + 1);
    if (t2 < 0) continue;
    const addsStr = line.slice(0, t1);
    const delsStr = line.slice(t1 + 1, t2);
    current.additions += addsStr === '-' ? 0 : parseInt(addsStr, 10) || 0;
    current.deletions += delsStr === '-' ? 0 : parseInt(delsStr, 10) || 0;
  }
  return map;
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
        const abs = resolveInsideCwd(args.cwd, args.filePath);
        const cwdAbs = path.resolve(args.cwd);
        let cwdReal = cwdAbs;
        try {
          cwdReal = safeRealpath(cwdAbs);
        } catch {
          /* cwdAbs is fine */
        }
        const relForGit = path.relative(cwdReal, abs);
        const spec = args.ref === 'HEAD' ? `HEAD:${relForGit}` : `:0:${relForGit}`;
        const originalContent = await gitShow(args.cwd, spec);

        let workingContent: string | null = null;
        let mtimeMs = 0;
        let sizeBytes = 0;
        let isBinary = false;
        let isLargeFile = false;

        try {
          const stat = await fs.stat(abs);
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
      args: { cwd: string; filePath: string; hash: string },
    ): Promise<IpcResponse<EditorReadCommitResult>> => {
      try {
        parseArgs(
          'editor:readCommit',
          z.looseObject({ cwd: z.string(), filePath: z.string(), hash: z.string() }),
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
        const relForGit = path.relative(cwdReal, abs);

        // Try parent for original. If the hash has no parent (root commit),
        // gitShow falls through to '' — every file is then an addition.
        const original = await gitShow(args.cwd, `${args.hash}~1:${relForGit}`);
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
        const relForGit = path.relative(cwdReal, abs);
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
        const abs = resolveInsideCwd(args.cwd, args.filePath);

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
      args: { cwd: string; limit?: number },
    ): Promise<IpcResponse<EditorCommitListItem[]>> => {
      try {
        parseArgs(
          'editor:listCommits',
          z.looseObject({ cwd: z.string(), limit: z.number().optional() }),
          args,
        );
        const limit = args.limit ?? 50;
        // -z separates records with NUL; %x1f is a unit-separator between
        // fields. Body can contain newlines, so we keep it last and use the
        // record NUL as its terminator.
        const format = '%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%b';
        const { stdout } = await execFileAsync(
          'git',
          ['log', '-z', `--max-count=${limit}`, `--format=${format}`, 'HEAD'],
          { cwd: args.cwd, maxBuffer: 5 * 1024 * 1024, timeout: 15000 },
        );
        // Second single pass over the same range for per-commit line stats —
        // O(1) git calls, not one numstat call per commit. The \x1f-prefixed
        // hash line delimits each commit's numstat block.
        let lineStats = new Map<string, { additions: number; deletions: number }>();
        try {
          const { stdout: numstatOut } = await execFileAsync(
            'git',
            ['log', '--numstat', `--max-count=${limit}`, '--format=%x1f%H', 'HEAD'],
            { cwd: args.cwd, maxBuffer: 5 * 1024 * 1024, timeout: 15000 },
          );
          lineStats = parseCommitNumstatLog(numstatOut);
        } catch {
          // Stats are best-effort; fall back to 0/0 if the numstat pass fails.
        }
        const commits: EditorCommitListItem[] = [];
        for (const record of stdout.split('\0')) {
          if (!record) continue;
          const parts = record.split('\x1f');
          if (parts.length < 6) continue;
          const hash = parts[0]!;
          const stat = lineStats.get(hash);
          commits.push({
            hash,
            shortHash: parts[1]!,
            authorName: parts[2] || '',
            authorDate: parseInt(parts[3]!, 10) || 0,
            subject: parts[4] || '',
            body: (parts[5] || '').trim(),
            additions: stat?.additions ?? 0,
            deletions: stat?.deletions ?? 0,
          });
        }
        return { success: true, data: commits };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:listFilesInCommit ──────────────────────────────────
  ipcMain.handle(
    'editor:listFilesInCommit',
    async (_event, args: { cwd: string; hash: string }): Promise<IpcResponse<FileChange[]>> => {
      try {
        parseArgs(
          'editor:listFilesInCommit',
          z.looseObject({ cwd: z.string(), hash: z.string() }),
          args,
        );
        let base = `${args.hash}~1`;
        try {
          await execFileAsync('git', ['rev-parse', '--verify', `${args.hash}~1`], {
            cwd: args.cwd,
            timeout: 5000,
          });
        } catch {
          base = EMPTY_TREE;
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
    ): Promise<IpcResponse<string[]>> => {
      try {
        parseArgs(
          'editor:listRepoFiles',
          z.looseObject({ cwd: z.string(), source: z.looseObject({ kind: z.string() }) }),
          args,
        );
        const paths =
          args.source.kind === 'working'
            ? await listWorkingRepoFiles(args.cwd)
            : await listCommitRepoFiles(args.cwd, args.source.hash);
        return { success: true, data: paths };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:resolveDefaultBase ─────────────────────────────────
  ipcMain.handle(
    'editor:resolveDefaultBase',
    async (_event, args: { cwd: string }): Promise<IpcResponse<string | null>> => {
      try {
        parseArgs('editor:resolveDefaultBase', z.looseObject({ cwd: z.string() }), args);
        return { success: true, data: await resolveDefaultBase(args.cwd) };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  // ── editor:listFilesAgainstBase ───────────────────────────────
  // Files that differ between the given base ref and the current working
  // tree (HEAD + index + unstaged), plus untracked.
  ipcMain.handle(
    'editor:listFilesAgainstBase',
    async (_event, args: { cwd: string; base: string }): Promise<IpcResponse<FileChange[]>> => {
      try {
        parseArgs(
          'editor:listFilesAgainstBase',
          z.looseObject({ cwd: z.string(), base: z.string() }),
          args,
        );
        // Sanity-check the base ref upfront so a missing ref returns a clean
        // error instead of confusing diff output.
        try {
          await execFileAsync('git', ['rev-parse', '--verify', args.base], {
            cwd: args.cwd,
            timeout: 5000,
          });
        } catch {
          return ipcError(`Base ref not found: ${args.base}`, 'NOT_FOUND');
        }

        const nameStatusRaw = (
          await execFileAsync('git', ['diff', '--name-status', '-z', args.base], {
            cwd: args.cwd,
            maxBuffer: 5 * 1024 * 1024,
            timeout: 15000,
          })
        ).stdout;

        const numstatRaw = (
          await execFileAsync('git', ['diff', '--numstat', '-z', args.base], {
            cwd: args.cwd,
            maxBuffer: 5 * 1024 * 1024,
            timeout: 15000,
          })
        ).stdout;

        const parsed = parseDiffNameStatusZ(nameStatusRaw);
        const stats = parseDiffNumstatZ(numstatRaw);

        const files: FileChange[] = parsed.map((entry) => {
          const s = stats.get(entry.path) ?? { additions: 0, deletions: 0 };
          return {
            path: entry.path,
            status: entry.status,
            staged: false,
            additions: s.additions,
            deletions: s.deletions,
            oldPath: entry.oldPath,
          };
        });

        // Untracked files are not part of `git diff` against a ref. Merge
        // them in so the user sees brand-new files that don't exist on base.
        let untracked: string[] = [];
        try {
          untracked = (
            await execFileAsync('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
              cwd: args.cwd,
              maxBuffer: 50 * 1024 * 1024,
              timeout: 15000,
            })
          ).stdout
            .split('\0')
            .filter(Boolean);
        } catch {
          /* no untracked */
        }
        for (const path of untracked) {
          files.push({
            path,
            status: 'untracked',
            staged: false,
            additions: 0,
            deletions: 0,
          });
        }

        files.sort((a, b) => a.path.localeCompare(b.path));
        return { success: true, data: files };
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
        const abs = resolveInsideCwd(args.cwd, args.filePath);
        const cwdAbs = path.resolve(args.cwd);
        let cwdReal = cwdAbs;
        try {
          cwdReal = safeRealpath(cwdAbs);
        } catch {
          /* cwdAbs is fine */
        }
        const relForGit = path.relative(cwdReal, abs);
        const originalContent = await gitShow(args.cwd, `${args.base}:${relForGit}`);

        let workingContent: string | null = null;
        let mtimeMs = 0;
        let sizeBytes = 0;
        let isBinary = false;
        let isLargeFile = false;

        try {
          const stat = await fs.stat(abs);
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
