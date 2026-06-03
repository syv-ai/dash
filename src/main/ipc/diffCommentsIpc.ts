import { ipcMain } from 'electron';
import { getRawDb } from '../db/client';
import type { DiffComment, DiffCommentInput, IpcResponse } from '@shared/types';

interface DiffCommentRow {
  id: string;
  task_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  text: string;
  sent: number;
  created_at: string;
  updated_at: string;
}

function rowToComment(r: DiffCommentRow): DiffComment {
  return {
    id: r.id,
    taskId: r.task_id,
    filePath: r.file_path,
    startLine: r.start_line,
    endLine: r.end_line,
    text: r.text,
    sent: r.sent === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Returns the ids of comment rows whose file_path is not in `existing`.
 *  Pure so we can test it without touching SQLite. Used by
 *  `diffComments:pruneForTask` to hard-delete dropped paths between sessions. */
export function computeOrphans(
  rows: ReadonlyArray<{ id: string; file_path: string }>,
  existing: ReadonlySet<string>,
): string[] {
  return rows.filter((r) => !existing.has(r.file_path)).map((r) => r.id);
}

export function registerDiffCommentsIpc(): void {
  ipcMain.handle(
    'diffComments:list',
    (_e, args: { taskId: string }): IpcResponse<DiffComment[]> => {
      try {
        const db = getRawDb();
        if (!db) throw new Error('db unavailable');
        const rows = db
          .prepare(
            `SELECT id, task_id, file_path, start_line, end_line, text, sent, created_at, updated_at
               FROM diff_editor_comments WHERE task_id = ?
              ORDER BY file_path, start_line`,
          )
          .all(args.taskId) as DiffCommentRow[];
        return { success: true, data: rows.map(rowToComment) };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('diffComments:upsert', (_e, c: DiffCommentInput): IpcResponse<DiffComment> => {
    try {
      const db = getRawDb();
      if (!db) throw new Error('db unavailable');
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO diff_editor_comments
              (id, task_id, file_path, start_line, end_line, text, sent, created_at, updated_at)
            VALUES (@id, @task_id, @file_path, @start_line, @end_line, @text, @sent, @now, @now)
            ON CONFLICT(id) DO UPDATE SET
              file_path  = excluded.file_path,
              start_line = excluded.start_line,
              end_line   = excluded.end_line,
              text       = excluded.text,
              sent       = excluded.sent,
              updated_at = excluded.updated_at`,
      ).run({
        id: c.id,
        task_id: c.taskId,
        file_path: c.filePath,
        start_line: c.startLine,
        end_line: c.endLine,
        text: c.text,
        sent: c.sent ? 1 : 0,
        now,
      });
      const row = db
        .prepare(
          `SELECT id, task_id, file_path, start_line, end_line, text, sent, created_at, updated_at
               FROM diff_editor_comments WHERE id = ?`,
        )
        .get(c.id) as DiffCommentRow | undefined;
      if (!row) throw new Error('row missing after upsert');
      return { success: true, data: rowToComment(row) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('diffComments:delete', (_e, args: { id: string }): IpcResponse<void> => {
    try {
      const db = getRawDb();
      if (!db) throw new Error('db unavailable');
      db.prepare(`DELETE FROM diff_editor_comments WHERE id = ?`).run(args.id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'diffComments:pruneForTask',
    (
      _e,
      args: { taskId: string; existingFilePaths: string[] },
    ): IpcResponse<{ deleted: number }> => {
      try {
        const db = getRawDb();
        if (!db) throw new Error('db unavailable');
        const rows = db
          .prepare(`SELECT id, file_path FROM diff_editor_comments WHERE task_id = ?`)
          .all(args.taskId) as Array<{ id: string; file_path: string }>;
        const orphans = computeOrphans(rows, new Set(args.existingFilePaths));
        if (orphans.length === 0) return { success: true, data: { deleted: 0 } };
        const stmt = db.prepare(`DELETE FROM diff_editor_comments WHERE id = ?`);
        const tx = db.transaction((ids: string[]) => {
          for (const id of ids) stmt.run(id);
        });
        tx(orphans);
        return { success: true, data: { deleted: orphans.length } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
