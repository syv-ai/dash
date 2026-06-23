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

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS diff_editor_comments (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      file_path   TEXT NOT NULL,
      start_line  INTEGER NOT NULL,
      end_line    INTEGER NOT NULL,
      text        TEXT NOT NULL,
      sent        INTEGER NOT NULL DEFAULT 0,
      view_scope  TEXT NOT NULL DEFAULT 'live',
      created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  rawDb.exec(
    `CREATE INDEX IF NOT EXISTS idx_diff_editor_comments_task_file
       ON diff_editor_comments(task_id, file_path);`,
  );

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS task_ports (
      id            TEXT PRIMARY KEY,
      task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label         TEXT NOT NULL,
      env_var       TEXT,
      default_port  INTEGER,
      host_port     INTEGER NOT NULL,
      source        TEXT NOT NULL,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_task_ports_task_id ON task_ports(task_id);`);
  rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_task_ports_host_port ON task_ports(host_port);`);

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

  // Per-task overrides for the project's default worktree setup/teardown scripts.
  // Null = no per-task scripts. Snapshotted from .dash/config.json at task
  // creation and editable per task.
  for (const col of ['setup_script', 'teardown_script']) {
    try {
      rawDb.exec(`ALTER TABLE tasks ADD COLUMN ${col} TEXT`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('duplicate column')) {
        console.error(`[migrate] Failed to add ${col} column:`, err);
      }
    }
  }

  // Deprecated since 0.9.9 — kept so existing DBs don't break, but no longer
  // read or written. See schema.ts for rationale. Do not remove this migration.
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN last_session_id TEXT`);
  } catch {
    /* already exists */
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

  // permission_mode replaces auto_approve. Backfill existing yolo'd tasks.
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'default'`);
    rawDb.exec(`UPDATE tasks SET permission_mode = 'bypassPermissions' WHERE auto_approve = 1`);
  } catch {
    /* already exists */
  }

  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0`);
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN total_cost_usd REAL NOT NULL DEFAULT 0`);
  } catch {
    /* already exists */
  }
  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN tokens_backfilled_at TEXT`);
  } catch {
    /* already exists */
  }

  // Drawer tabs replace per-task localStorage keys for tab state. id matches
  // the PTY id when the tab owns one (e.g. 'shell:t1' or 'ports-tui:t1').
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS drawer_tabs (
      id           TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL,
      feature_id   TEXT,
      label        TEXT NOT NULL,
      position     INTEGER NOT NULL,
      created_at   INTEGER NOT NULL
    );
  `);
  rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_drawer_tabs_task ON drawer_tabs (task_id, position);`);

  try {
    rawDb.exec(`ALTER TABLE tasks ADD COLUMN active_drawer_tab_id TEXT`);
  } catch {
    /* already exists */
  }

  for (const col of ['run_command', 'stop_command', 'logs_command', 'cwd']) {
    try {
      rawDb.exec(`ALTER TABLE task_ports ADD COLUMN ${col} TEXT`);
    } catch {
      /* already exists */
    }
  }

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS feature_dismissals (
      project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      feature_id   TEXT NOT NULL,
      dismissed_at TEXT NOT NULL,
      PRIMARY KEY (project_id, feature_id)
    );
  `);

  // One-time move of the old ports dismissal column into feature_dismissals,
  // then drop the column. Guarded by a pragma check so it runs exactly once.
  const hadPortsDismissCol =
    (
      rawDb
        .prepare(
          `SELECT COUNT(*) AS c FROM pragma_table_info('projects')
           WHERE name = 'ports_setup_dismissed_at'`,
        )
        .get() as { c: number }
    ).c > 0;
  if (hadPortsDismissCol) {
    rawDb.exec(`
      INSERT OR IGNORE INTO feature_dismissals (project_id, feature_id, dismissed_at)
      SELECT id, 'ports', ports_setup_dismissed_at FROM projects
      WHERE ports_setup_dismissed_at IS NOT NULL;
    `);
    rawDb.exec(`ALTER TABLE projects DROP COLUMN ports_setup_dismissed_at`);
  }

  // Diff comments gained a view scope (anchor to 'live' working/branch diff vs
  // a frozen 'commit:<hash>'). Existing rows predate scoping → default 'live'.
  try {
    rawDb.exec(
      `ALTER TABLE diff_editor_comments ADD COLUMN view_scope TEXT NOT NULL DEFAULT 'live'`,
    );
  } catch {
    /* already exists */
  }

  rawDb.pragma('foreign_keys = ON');
}
