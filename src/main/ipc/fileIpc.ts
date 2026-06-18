import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';

// Cap the size of files we'll load into the renderer for preview. HTML pages
// large enough to exceed this are almost certainly not single-file previews.
const MAX_PREVIEW_SIZE = 5 * 1024 * 1024; // 5 MB

export function registerFileIpc(): void {
  // Read a UTF-8 text file from within a task worktree. Used by the diff
  // viewer's HTML preview to load the full on-disk file content (the diff
  // itself only carries hunks).
  ipcMain.handle('file:readText', async (_event, args: { cwd: string; filePath: string }) => {
    try {
      // Resolve real paths (following symlinks) on both sides so the guard
      // can't be bypassed by a symlink inside the worktree that points out of
      // it. realpath on `base` also normalizes platform symlinks (e.g. macOS
      // /var → /private/var) so legitimate files still pass.
      const base = await fs.realpath(path.resolve(args.cwd));
      const requested = path.resolve(base, args.filePath);

      let abs: string;
      try {
        abs = await fs.realpath(requested);
      } catch {
        return { success: false, error: 'File not found' };
      }

      // Path-traversal guard: the resolved file must live inside `cwd`.
      if (abs !== base && !abs.startsWith(base + path.sep)) {
        return { success: false, error: 'Path escapes the working directory' };
      }

      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        return { success: false, error: 'Not a file' };
      }
      if (stat.size > MAX_PREVIEW_SIZE) {
        return { success: false, error: 'File too large to preview' };
      }

      const contents = await fs.readFile(abs, 'utf8');
      return { success: true, data: contents };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
