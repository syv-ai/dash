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
