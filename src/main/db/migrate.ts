import { existsSync } from 'fs';
import { join } from 'path';
import { getRawDb } from './client';

/**
 * Run schema migrations using raw SQL.
 * Creates tables if they don't exist.
 */
export function runMigrations(): void {
  const rawDb = getRawDb();
  if (!rawDb) throw new Error('Raw database not available');

  rawDb.pragma('foreign_keys = OFF');

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      git_remote TEXT,
      git_branch TEXT,
      base_ref TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  rawDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path);`);

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      branch TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      use_worktree INTEGER DEFAULT 1,
      auto_approve INTEGER DEFAULT 0,
      archived_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);`);

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      is_main INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_task_id ON conversations(task_id);`);

  // Migrations for existing databases
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN auto_approve INTEGER DEFAULT 0`);
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN linked_issues TEXT`);
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN linked_items TEXT`);
  } catch {
    /* already exists */
  }

  // Migrate legacy linked_issues (number[]) → linked_items (LinkedItem[])
  try {
    const rows = rawDb
      .prepare(
        `SELECT id, linked_issues FROM tasks WHERE linked_issues IS NOT NULL AND linked_items IS NULL`,
      )
      .all() as { id: string; linked_issues: string }[];
    for (const row of rows) {
      try {
        const nums: number[] = JSON.parse(row.linked_issues);
        if (Array.isArray(nums) && nums.length > 0) {
          const items = nums.map((n) => ({ provider: 'github', id: n, title: '', url: '' }));
          rawDb
            .prepare(`UPDATE tasks SET linked_items = ? WHERE id = ?`)
            .run(JSON.stringify(items), row.id);
        }
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* migration best effort */
  }

  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN branch_created_by_dash INTEGER DEFAULT 0`);
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
  } catch {
    /* column already exists — skip ALTER and backfill */
  }

  // Backfill sort_order if all values are still the default (0)
  const needsBackfill = rawDb
    .prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE sort_order != 0`)
    .get() as { cnt: number };
  if (needsBackfill.cnt === 0) {
    const backfillTxn = rawDb.transaction(() => {
      const rows = rawDb
        .prepare(`SELECT id, project_id FROM tasks ORDER BY project_id, created_at DESC`)
        .all() as { id: string; project_id: string }[];
      const counters = new Map<string, number>();
      const update = rawDb.prepare(`UPDATE tasks SET sort_order = ? WHERE id = ?`);
      for (const r of rows) {
        const n = counters.get(r.project_id) ?? 0;
        update.run(n, r.id);
        counters.set(r.project_id, n + 1);
      }
    });
    backfillTxn();
  }
  try {
    rawDb.exec(`ALTER TABLE projects ADD COLUMN worktree_setup_script TEXT`);
  } catch {
    /* already exists */
  }

  try {
    rawDb.exec(`ALTER TABLE projects ADD COLUMN is_git_repo INTEGER DEFAULT 1`);
  } catch {
    /* already exists */
  }

  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN context_prompt TEXT`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('duplicate column')) {
      console.error('[migrate] Failed to add context_prompt column:', err);
    }
  }

  // Backfill: sync is_git_repo with actual filesystem state
  try {
    const allProjects = rawDb.prepare(`SELECT id, path FROM projects`).all() as {
      id: string;
      path: string;
    }[];
    for (const proj of allProjects) {
      const hasGit = existsSync(join(proj.path, '.git'));
      rawDb
        .prepare(`UPDATE projects SET is_git_repo = ? WHERE id = ?`)
        .run(hasGit ? 1 : 0, proj.id);
    }
  } catch {
    /* best effort */
  }

  rawDb.pragma('foreign_keys = ON');
}
