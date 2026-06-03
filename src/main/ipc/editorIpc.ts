import { ipcMain } from 'electron';
import { promises as fs, realpathSync } from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import type {
  EditorCommitListItem,
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

export function registerEditorIpc(): void {
  // ── editor:readWorking ────────────────────────────────────────
  ipcMain.handle(
    'editor:readWorking',
    async (
      _event,
      args: { cwd: string; filePath: string; ref: WorkingRef },
    ): Promise<IpcResponse<EditorReadWorkingResult>> => {
      try {
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
        return { success: false, error: err instanceof Error ? err.message : String(err) };
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
        return { success: false, error: err instanceof Error ? err.message : String(err) };
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
        return { success: false, error: err instanceof Error ? err.message : String(err) };
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
        const commits: EditorCommitListItem[] = [];
        for (const record of stdout.split('\0')) {
          if (!record) continue;
          const parts = record.split('\x1f');
          if (parts.length < 6) continue;
          commits.push({
            hash: parts[0],
            shortHash: parts[1],
            authorName: parts[2] || '',
            authorDate: parseInt(parts[3], 10) || 0,
            subject: parts[4] || '',
            body: (parts[5] || '').trim(),
          });
        }
        return { success: true, data: commits };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ── editor:listFilesInCommit ──────────────────────────────────
  ipcMain.handle(
    'editor:listFilesInCommit',
    async (_event, args: { cwd: string; hash: string }): Promise<IpcResponse<FileChange[]>> => {
      try {
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
            additions: adds === '-' ? 0 : parseInt(adds, 10) || 0,
            deletions: dels === '-' ? 0 : parseInt(dels, 10) || 0,
          });
        }

        const files: FileChange[] = [];
        for (const line of nameStatusOut.split('\n')) {
          if (!line.trim()) continue;
          const parts = line.split('\t');
          const code = parts[0];
          const status = statusFromGitCode(code);
          const filePath = parts[parts.length - 1];
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
        return { success: false, error: err instanceof Error ? err.message : String(err) };
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
        const paths =
          args.source.kind === 'working'
            ? await listWorkingRepoFiles(args.cwd)
            : await listCommitRepoFiles(args.cwd, args.source.hash);
        return { success: true, data: paths };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
