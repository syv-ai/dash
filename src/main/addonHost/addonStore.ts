import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import type { StorageScope } from '@shared/addon-api';

/**
 * Host-owned persistence for add-ons: one on/off row per add-on, and scoped
 * key/value JSON. Add-ons never touch SQL; they reach this through ctx.storage.
 * Task- and project-scoped rows are removed with their task or project
 * (deleteScope), since scope_id can't carry a foreign key to either table.
 */
export function ensureAddonTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS addons (
      id      TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS addon_data (
      addon_id TEXT NOT NULL,
      scope    TEXT NOT NULL,
      scope_id TEXT NOT NULL DEFAULT '',
      key      TEXT NOT NULL,
      value    TEXT NOT NULL,
      PRIMARY KEY (addon_id, scope, scope_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_addon_data_scope ON addon_data (scope, scope_id);
  `);
}

/**
 * One-time import of pre-add-on settings that lived in their own userData
 * files. RTK's `rtk-config.json` `{enabled}` becomes the RTK add-on's switch;
 * the file is removed afterwards so the import never repeats. An existing
 * `addons` row wins (the user already chose).
 */
export function importLegacyAddonSettings(store: AddonStore, userDataDir: string): void {
  const rtkConfig = path.join(userDataDir, 'rtk-config.json');
  if (!fs.existsSync(rtkConfig)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(rtkConfig, 'utf-8')) as { enabled?: unknown };
    if (raw.enabled === true && store.getEnabled('rtk') === undefined)
      store.setEnabled('rtk', true);
  } catch (err) {
    console.warn('[addons] rtk-config.json unreadable; RTK stays off:', err);
  }
  try {
    fs.rmSync(rtkConfig, { force: true });
  } catch {
    /* next boot retries */
  }
}

/**
 * One-time move of the pre-add-on ports tables into the ports add-on's storage:
 * each task's `task_ports` rows become its `ports` value (a TaskPort[] sorted by
 * label, the shape the add-on keeps). `feature_dismissals` has no successor —
 * setup is no longer offered unprompted — so it is dropped, as are drawer tabs
 * of the removed `tui` kind. Idempotent: does nothing once the tables are gone.
 */
export function importLegacyPortsData(db: Database.Database): void {
  const hasTable = (name: string) =>
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !==
    undefined;

  if (hasTable('task_ports')) {
    const rows = db
      .prepare(
        `SELECT id, task_id AS taskId, label, env_var AS envVar, default_port AS defaultPort,
                host_port AS hostPort, source, run_command AS runCommand,
                stop_command AS stopCommand, logs_command AS logsCommand, cwd,
                created_at AS createdAt, updated_at AS updatedAt
         FROM task_ports ORDER BY task_id, label`,
      )
      .all() as Array<Record<string, unknown> & { taskId: string }>;
    const byTask = new Map<string, unknown[]>();
    for (const r of rows) {
      const list = byTask.get(r.taskId) ?? [];
      list.push({ ...r, createdAt: r.createdAt ?? '', updatedAt: r.updatedAt ?? '' });
      byTask.set(r.taskId, list);
    }
    const insert = db.prepare(
      `INSERT OR IGNORE INTO addon_data (addon_id, scope, scope_id, key, value)
       VALUES ('ports', 'task', ?, 'ports', ?)`,
    );
    db.transaction(() => {
      for (const [taskId, ports] of byTask) insert.run(taskId, JSON.stringify(ports));
      db.exec(`DROP TABLE task_ports`);
    })();
  }
  if (hasTable('feature_dismissals')) db.exec(`DROP TABLE feature_dismissals`);
  if (hasTable('drawer_tabs')) db.exec(`DELETE FROM drawer_tabs WHERE kind = 'tui'`);
}

type ScopeKind = 'global' | 'project' | 'task';

function splitScope(scope: StorageScope): [ScopeKind, string] {
  if (scope === 'global') return ['global', ''];
  if ('project' in scope) return ['project', scope.project];
  return ['task', scope.task];
}

export interface AddonStore {
  getEnabled(addonId: string): boolean | undefined;
  setEnabled(addonId: string, enabled: boolean): void;
  get<T>(addonId: string, scope: StorageScope, key: string): T | undefined;
  set(addonId: string, scope: StorageScope, key: string, value: unknown): void;
  delete(addonId: string, scope: StorageScope, key: string): void;
  list<T>(
    addonId: string,
    scopeKind: 'project' | 'task',
    key: string,
  ): Array<{ scopeId: string; value: T }>;
  deleteScope(scopeKind: 'project' | 'task', scopeId: string): void;
}

export function createAddonStore(db: Database.Database): AddonStore {
  const parse = <T>(raw: string): T | undefined => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  };

  return {
    getEnabled(addonId) {
      const row = db.prepare(`SELECT enabled FROM addons WHERE id = ?`).get(addonId) as
        | { enabled: number }
        | undefined;
      return row ? row.enabled === 1 : undefined;
    },

    setEnabled(addonId, enabled) {
      db.prepare(
        `INSERT INTO addons (id, enabled) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled`,
      ).run(addonId, enabled ? 1 : 0);
    },

    get(addonId, scope, key) {
      const [kind, id] = splitScope(scope);
      const row = db
        .prepare(
          `SELECT value FROM addon_data WHERE addon_id = ? AND scope = ? AND scope_id = ? AND key = ?`,
        )
        .get(addonId, kind, id, key) as { value: string } | undefined;
      return row ? parse(row.value) : undefined;
    },

    set(addonId, scope, key, value) {
      const [kind, id] = splitScope(scope);
      db.prepare(
        `INSERT INTO addon_data (addon_id, scope, scope_id, key, value) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(addon_id, scope, scope_id, key) DO UPDATE SET value = excluded.value`,
      ).run(addonId, kind, id, key, JSON.stringify(value ?? null));
    },

    delete(addonId, scope, key) {
      const [kind, id] = splitScope(scope);
      db.prepare(
        `DELETE FROM addon_data WHERE addon_id = ? AND scope = ? AND scope_id = ? AND key = ?`,
      ).run(addonId, kind, id, key);
    },

    list(addonId, scopeKind, key) {
      const rows = db
        .prepare(
          `SELECT scope_id AS scopeId, value FROM addon_data
           WHERE addon_id = ? AND scope = ? AND key = ? ORDER BY scope_id`,
        )
        .all(addonId, scopeKind, key) as Array<{ scopeId: string; value: string }>;
      const out = [];
      for (const r of rows) {
        const value = parse<never>(r.value);
        if (value !== undefined) out.push({ scopeId: r.scopeId, value });
      }
      return out;
    },

    deleteScope(scopeKind, scopeId) {
      db.prepare(`DELETE FROM addon_data WHERE scope = ? AND scope_id = ?`).run(scopeKind, scopeId);
    },
  };
}
