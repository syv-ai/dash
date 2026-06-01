import { ipcMain } from 'electron';
import { promises as fs, realpathSync } from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import type {
  FileRef,
  IpcResponse,
  ReadFileForEditResult,
  WriteFileWorkingCopyResult,
} from '@shared/types';

const execFileAsync = promisify(execFile);
const LARGE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

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

async function gitShow(cwd: string, ref: FileRef, relPath: string): Promise<string> {
  const spec = ref === 'HEAD' ? `HEAD:${relPath}` : `:0:${relPath}`;
  try {
    const { stdout } = await execFileAsync('git', ['show', spec], {
      cwd,
      maxBuffer: LARGE_FILE_BYTES * 2,
      timeout: 15000,
    });
    return stdout;
  } catch {
    // Untracked or new file — no HEAD/index version.
    return '';
  }
}

export function registerFileIpc(): void {
  ipcMain.handle(
    'files:readForEdit',
    async (
      _event,
      args: { cwd: string; filePath: string; ref: FileRef },
    ): Promise<IpcResponse<ReadFileForEditResult>> => {
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

        const headContent = await gitShow(args.cwd, args.ref, relForGit);

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
            headContent,
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

  ipcMain.handle(
    'files:writeWorkingCopy',
    async (
      _event,
      args: {
        cwd: string;
        filePath: string;
        content: string;
        expectedMtimeMs: number;
        expectedSizeBytes: number;
      },
    ): Promise<IpcResponse<WriteFileWorkingCopyResult>> => {
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
          // File didn't exist when caller loaded it (mtime=0, size=0): allow
          // the write only if the caller indicated that explicitly.
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
}
