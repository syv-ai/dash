import type { Database, Statement } from 'better-sqlite3';
import { getRawDb } from '../db/client';
import { isPrScope, prScope } from '@shared/prScope';
import { isReplyDraft } from '@shared/diffComments';
import type { DiffComment, DiffCommentInput, PrProvider } from '@shared/types';

interface DiffCommentRow {
  id: string;
  task_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  text: string;
  sent: number;
  view_scope: string;
  side: string;
  reply_to: string | null;
  author: string;
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
    viewScope: r.view_scope,
    side: r.side === 'LEFT' ? 'LEFT' : 'RIGHT',
    replyTo: r.reply_to,
    author: r.author === 'agent' ? 'agent' : 'user',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Ids of the rows whose file no longer exists. Pure, so it's testable without
 *  SQLite. PR drafts are kept: a PR's files needn't exist in the task's checkout. */
export function computeOrphans(
  rows: ReadonlyArray<{ id: string; file_path: string; view_scope: string }>,
  existing: ReadonlySet<string>,
): string[] {
  return rows
    .filter((r) => !isPrScope(r.view_scope) && !existing.has(r.file_path))
    .map((r) => r.id);
}

const COLS =
  'id, task_id, file_path, start_line, end_line, text, sent, view_scope, side, reply_to, author, created_at, updated_at';

/** A draft an agent writes through the control API. */
export interface AgentDraft {
  id: string;
  taskId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  viewScope: string;
  replyTo: string | null;
}

export interface DiffCommentsRepo {
  listByTask(taskId: string): DiffComment[];
  get(id: string): DiffComment | undefined;
  /** A write from the diff editor. New rows are the user's; an existing row
   *  becomes the user's only when its text changes (range snapshots and the
   *  sent flag keep an agent's draft the agent's). */
  upsertFromUser(input: DiffCommentInput): DiffComment;
  /** A draft written or edited by an agent; it stays the agent's. */
  upsertFromAgent(draft: AgentDraft): DiffComment;
  delete(id: string): void;
  deleteByIds(ids: readonly string[]): void;
  /** The task's drafts for a PR, split into line comments and replies. */
  listPrDrafts(
    taskId: string,
    provider: PrProvider,
    number: number,
  ): { comments: DiffComment[]; replies: DiffComment[] };
  /** Hard-delete the task's comments on files that no longer exist (not PR drafts). */
  prune(taskId: string, existingFilePaths: ReadonlySet<string>): number;
}

/** The one owner of `diff_editor_comments` SQL. Statements are prepared once:
 *  better-sqlite3 caches query plans on them. */
export function createDiffCommentsRepo(db: Database): DiffCommentsRepo {
  const s: Record<string, Statement> = {
    listByTask: db.prepare(
      `SELECT ${COLS} FROM diff_editor_comments WHERE task_id = ? ORDER BY file_path, start_line`,
    ),
    listByScope: db.prepare(
      `SELECT ${COLS} FROM diff_editor_comments
        WHERE task_id = ? AND view_scope = ? ORDER BY file_path, start_line`,
    ),
    get: db.prepare(`SELECT ${COLS} FROM diff_editor_comments WHERE id = ?`),
    upsertFromUser: db.prepare(
      `INSERT INTO diff_editor_comments (${COLS})
        VALUES (@id, @taskId, @filePath, @startLine, @endLine, @text, @sent, @viewScope,
                @side, @replyTo, 'user', @now, @now)
        ON CONFLICT(id) DO UPDATE SET
          file_path  = excluded.file_path,
          start_line = excluded.start_line,
          end_line   = excluded.end_line,
          text       = excluded.text,
          sent       = excluded.sent,
          view_scope = excluded.view_scope,
          author     = CASE WHEN diff_editor_comments.text = excluded.text
                            THEN diff_editor_comments.author ELSE 'user' END,
          updated_at = excluded.updated_at`,
    ),
    upsertFromAgent: db.prepare(
      `INSERT INTO diff_editor_comments (${COLS})
        VALUES (@id, @taskId, @filePath, @startLine, @endLine, @text, 0, @viewScope,
                'RIGHT', @replyTo, 'agent', @now, @now)
        ON CONFLICT(id) DO UPDATE SET
          start_line = excluded.start_line,
          end_line   = excluded.end_line,
          text       = excluded.text,
          updated_at = excluded.updated_at`,
    ),
    delete: db.prepare(`DELETE FROM diff_editor_comments WHERE id = ?`),
    pathsByTask: db.prepare(
      `SELECT id, file_path, view_scope FROM diff_editor_comments WHERE task_id = ?`,
    ),
  };
  const get = (id: string) => {
    const row = s.get!.get(id) as DiffCommentRow | undefined;
    return row ? rowToComment(row) : undefined;
  };
  const mustGet = (id: string) => {
    const c = get(id);
    if (!c) throw new Error('row missing after upsert');
    return c;
  };
  const deleteByIds = db.transaction((ids: readonly string[]) => {
    for (const id of ids) s.delete!.run(id);
  });

  return {
    listByTask: (taskId) => (s.listByTask!.all(taskId) as DiffCommentRow[]).map(rowToComment),
    get,
    upsertFromUser(input) {
      s.upsertFromUser!.run({
        ...input,
        sent: input.sent ? 1 : 0,
        side: input.side ?? 'RIGHT',
        replyTo: input.replyTo ?? null,
        now: new Date().toISOString(),
      });
      return mustGet(input.id);
    },
    upsertFromAgent(draft) {
      s.upsertFromAgent!.run({ ...draft, now: new Date().toISOString() });
      return mustGet(draft.id);
    },
    delete: (id) => void s.delete!.run(id),
    deleteByIds: (ids) => {
      if (ids.length > 0) deleteByIds(ids);
    },
    listPrDrafts(taskId, provider, number) {
      const rows = (s.listByScope!.all(taskId, prScope(provider, number)) as DiffCommentRow[]).map(
        rowToComment,
      );
      return {
        comments: rows.filter((c) => !isReplyDraft(c)),
        replies: rows.filter(isReplyDraft),
      };
    },
    prune(taskId, existingFilePaths) {
      const rows = s.pathsByTask!.all(taskId) as Array<{
        id: string;
        file_path: string;
        view_scope: string;
      }>;
      const orphans = computeOrphans(rows, existingFilePaths);
      deleteByIds(orphans);
      return orphans.length;
    },
  };
}

let repo: DiffCommentsRepo | null = null;

/** The app's repo over its database. */
export function diffCommentsRepo(): DiffCommentsRepo {
  if (repo) return repo;
  const db = getRawDb();
  if (!db) throw new Error('db unavailable');
  repo = createDiffCommentsRepo(db);
  return repo;
}
