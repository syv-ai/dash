import { ipcMain } from 'electron';
import { z } from 'zod';
import type { Database, Statement } from 'better-sqlite3';
import { getRawDb } from '../db/client';
import { parseArgs, errorResponse } from './validate';
import { diffCommentInputSchema } from './schemas';
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

const COLS = 'id, task_id, file_path, start_line, end_line, text, sent, created_at, updated_at';

interface Stmts {
  listByTask: Statement;
  upsert: Statement;
  getById: Statement;
  deleteById: Statement;
  listPathsByTask: Statement;
  /** Held so prune's transaction stays bound to the same Database instance. */
  db: Database;
}

let stmts: Stmts | null = null;

/** better-sqlite3 caches query plans on `Statement` instances; preparing
 *  once at first use beats re-parsing SQL on every IPC round-trip. */
function getStmts(): Stmts {
  if (stmts) return stmts;
  const db = getRawDb();
  if (!db) throw new Error('db unavailable');
  stmts = {
    db,
    listByTask: db.prepare(
      `SELECT ${COLS} FROM diff_editor_comments
        WHERE task_id = ? ORDER BY file_path, start_line`,
    ),
    upsert: db.prepare(
      `INSERT INTO diff_editor_comments
          (${COLS})
        VALUES (@id, @taskId, @filePath, @startLine, @endLine, @text, @sent, @now, @now)
        ON CONFLICT(id) DO UPDATE SET
          file_path  = excluded.file_path,
          start_line = excluded.start_line,
          end_line   = excluded.end_line,
          text       = excluded.text,
          sent       = excluded.sent,
          updated_at = excluded.updated_at`,
    ),
    getById: db.prepare(`SELECT ${COLS} FROM diff_editor_comments WHERE id = ?`),
    deleteById: db.prepare(`DELETE FROM diff_editor_comments WHERE id = ?`),
    listPathsByTask: db.prepare(`SELECT id, file_path FROM diff_editor_comments WHERE task_id = ?`),
  };
  return stmts;
}

export function registerDiffCommentsIpc(): void {
  ipcMain.handle(
    'diffComments:list',
    (_e, args: { taskId: string }): IpcResponse<DiffComment[]> => {
      try {
        parseArgs('diffComments:list', z.looseObject({ taskId: z.string() }), args);
        const rows = getStmts().listByTask.all(args.taskId) as DiffCommentRow[];
        return { success: true, data: rows.map(rowToComment) };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  ipcMain.handle('diffComments:upsert', (_e, c: DiffCommentInput): IpcResponse<DiffComment> => {
    try {
      parseArgs('diffComments:upsert', diffCommentInputSchema, c);
      const s = getStmts();
      s.upsert.run({ ...c, sent: c.sent ? 1 : 0, now: new Date().toISOString() });
      const row = s.getById.get(c.id) as DiffCommentRow | undefined;
      if (!row) throw new Error('row missing after upsert');
      return { success: true, data: rowToComment(row) };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle('diffComments:delete', (_e, args: { id: string }): IpcResponse<void> => {
    try {
      parseArgs('diffComments:delete', z.looseObject({ id: z.string() }), args);
      getStmts().deleteById.run(args.id);
      return { success: true };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle(
    'diffComments:pruneForTask',
    (
      _e,
      args: { taskId: string; existingFilePaths: string[] },
    ): IpcResponse<{ deleted: number }> => {
      try {
        parseArgs(
          'diffComments:pruneForTask',
          z.looseObject({ taskId: z.string(), existingFilePaths: z.array(z.string()) }),
          args,
        );
        const s = getStmts();
        const rows = s.listPathsByTask.all(args.taskId) as Array<{
          id: string;
          file_path: string;
        }>;
        const orphans = computeOrphans(rows, new Set(args.existingFilePaths));
        if (orphans.length === 0) return { success: true, data: { deleted: 0 } };
        const tx = s.db.transaction((ids: string[]) => {
          for (const id of ids) s.deleteById.run(id);
        });
        tx(orphans);
        return { success: true, data: { deleted: orphans.length } };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );
}
