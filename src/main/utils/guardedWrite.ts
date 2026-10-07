import { promises as fs } from 'fs';
import * as path from 'path';
import type { EditorWriteResult } from '@shared/types';

/** Replace `abs` via a sibling tmp file + rename, so a reader never sees a half-written file. */
export async function writeFileAtomic(abs: string, content: string): Promise<void> {
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16);
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.dash-tmp-${rand}`);
  await fs.writeFile(tmp, content, { encoding: 'utf8', mode: 0o644 });
  try {
    await fs.rename(tmp, abs);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Write `abs` only if it still has the mtime and size the caller last saw
 * (0/0: the file must not exist yet). Otherwise nothing is written and the
 * result carries the current values, so the caller can offer an overwrite.
 */
export async function writeFileIfUnchanged(
  abs: string,
  content: string,
  expected: { mtimeMs: number; sizeBytes: number },
): Promise<EditorWriteResult> {
  let current = { mtimeMs: 0, sizeBytes: 0 };
  try {
    const stat = await fs.stat(abs);
    current = { mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
  if (current.mtimeMs !== expected.mtimeMs || current.sizeBytes !== expected.sizeBytes) {
    return {
      ok: false,
      stale: true,
      currentMtimeMs: current.mtimeMs,
      currentSizeBytes: current.sizeBytes,
    };
  }
  await writeFileAtomic(abs, content);
  const stat = await fs.stat(abs);
  return { ok: true, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
}
