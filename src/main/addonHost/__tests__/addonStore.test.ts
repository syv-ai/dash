import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  createAddonStore,
  ensureAddonTables,
  importLegacyAddonSettings,
  importLegacyPortsData,
  type AddonStore,
} from '../addonStore';

describe('addonStore', () => {
  let db: Database.Database;
  let store: AddonStore;

  beforeEach(() => {
    db = new Database(':memory:');
    ensureAddonTables(db);
    store = createAddonStore(db);
  });

  it('is idempotent to create the tables twice', () => {
    expect(() => ensureAddonTables(db)).not.toThrow();
  });

  it('reports no enable state until one is set', () => {
    expect(store.getEnabled('rtk')).toBeUndefined();
    store.setEnabled('rtk', true);
    expect(store.getEnabled('rtk')).toBe(true);
    store.setEnabled('rtk', false);
    expect(store.getEnabled('rtk')).toBe(false);
  });

  it('round-trips values per scope without mixing them', () => {
    store.set('ports', 'global', 'k', { a: 1 });
    store.set('ports', { project: 'p1' }, 'k', 'project');
    store.set('ports', { task: 't1' }, 'k', ['task']);
    store.set('rtk', 'global', 'k', 'other add-on');

    expect(store.get('ports', 'global', 'k')).toEqual({ a: 1 });
    expect(store.get('ports', { project: 'p1' }, 'k')).toBe('project');
    expect(store.get('ports', { task: 't1' }, 'k')).toEqual(['task']);
    expect(store.get('rtk', 'global', 'k')).toBe('other add-on');
    expect(store.get('ports', { task: 't2' }, 'k')).toBeUndefined();
  });

  it('overwrites and deletes a key', () => {
    store.set('ports', { task: 't1' }, 'k', 1);
    store.set('ports', { task: 't1' }, 'k', 2);
    expect(store.get('ports', { task: 't1' }, 'k')).toBe(2);
    store.delete('ports', { task: 't1' }, 'k');
    expect(store.get('ports', { task: 't1' }, 'k')).toBeUndefined();
  });

  it('lists one key across every task', () => {
    store.set('ports', { task: 't1' }, 'ports', [3000]);
    store.set('ports', { task: 't2' }, 'ports', [3001]);
    store.set('ports', { task: 't2' }, 'setup', 'x');
    store.set('ports', { project: 'p1' }, 'ports', 'not a task');
    expect(store.list('ports', 'task', 'ports')).toEqual([
      { scopeId: 't1', value: [3000] },
      { scopeId: 't2', value: [3001] },
    ]);
  });

  describe('importLegacyAddonSettings', () => {
    const dirs: string[] = [];
    afterEach(() => {
      for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });
    const userData = (config?: string) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-addons-'));
      dirs.push(dir);
      if (config !== undefined) fs.writeFileSync(path.join(dir, 'rtk-config.json'), config);
      return dir;
    };

    it('turns RTK on when the old config had it on, then removes the file', () => {
      const dir = userData('{"enabled": true}');
      importLegacyAddonSettings(store, dir);
      expect(store.getEnabled('rtk')).toBe(true);
      expect(fs.existsSync(path.join(dir, 'rtk-config.json'))).toBe(false);
    });

    it('leaves RTK at its default when the old config had it off', () => {
      importLegacyAddonSettings(store, userData('{"enabled": false}'));
      expect(store.getEnabled('rtk')).toBeUndefined();
    });

    it('does not override a choice already made', () => {
      store.setEnabled('rtk', false);
      importLegacyAddonSettings(store, userData('{"enabled": true}'));
      expect(store.getEnabled('rtk')).toBe(false);
    });

    it('survives a corrupt file and still removes it', () => {
      const dir = userData('{nope');
      importLegacyAddonSettings(store, dir);
      expect(store.getEnabled('rtk')).toBeUndefined();
      expect(fs.existsSync(path.join(dir, 'rtk-config.json'))).toBe(false);
    });

    it('does nothing without a file', () => {
      expect(() => importLegacyAddonSettings(store, userData())).not.toThrow();
    });
  });

  describe('importLegacyPortsData', () => {
    const seed = () => {
      db.exec(`
        CREATE TABLE task_ports (
          id TEXT PRIMARY KEY, task_id TEXT NOT NULL, label TEXT NOT NULL, env_var TEXT,
          default_port INTEGER, host_port INTEGER NOT NULL, source TEXT NOT NULL,
          run_command TEXT, stop_command TEXT, logs_command TEXT, cwd TEXT,
          created_at TEXT, updated_at TEXT);
        INSERT INTO task_ports VALUES
          ('a', 't1', 'web', 'WEB_PORT', 3000, 3100, 'hash', 'pnpm dev', NULL, NULL, NULL, 'c', 'u'),
          ('b', 't1', 'api', 'API_PORT', 4000, 4100, 'hash', NULL, NULL, NULL, 'apps/api', 'c', 'u'),
          ('c', 't2', 'web', NULL, NULL, 9323, 'fixed', NULL, NULL, NULL, NULL, NULL, NULL);
        CREATE TABLE feature_dismissals (project_id TEXT, feature_id TEXT, dismissed_at TEXT);
        INSERT INTO feature_dismissals VALUES ('p1', 'ports', 'x');
        CREATE TABLE drawer_tabs (id TEXT PRIMARY KEY, kind TEXT NOT NULL);
        INSERT INTO drawer_tabs VALUES ('shell:t1', 'shell'), ('ports-tui:t1', 'tui');
      `);
    };
    const tables = () =>
      (
        db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{
          name: string;
        }>
      )
        .map((r) => r.name)
        .sort();

    it('moves each task’s ports into add-on storage, sorted by label', () => {
      seed();
      importLegacyPortsData(db);
      const t1 = store.get<Array<{ label: string; hostPort: number; cwd: string | null }>>(
        'ports',
        { task: 't1' },
        'ports',
      )!;
      expect(t1.map((p) => [p.label, p.hostPort, p.cwd])).toEqual([
        ['api', 4100, 'apps/api'],
        ['web', 3100, null],
      ]);
      expect(
        store.get<Array<{ createdAt: string }>>('ports', { task: 't2' }, 'ports')![0]!.createdAt,
      ).toBe('');
    });

    it('drops the old tables and tui drawer tabs', () => {
      seed();
      importLegacyPortsData(db);
      expect(tables()).toEqual(['addon_data', 'addons', 'drawer_tabs']);
      expect(db.prepare(`SELECT id FROM drawer_tabs`).all()).toEqual([{ id: 'shell:t1' }]);
    });

    it('is idempotent and harmless without old tables', () => {
      seed();
      importLegacyPortsData(db);
      expect(() => importLegacyPortsData(db)).not.toThrow();
      expect(store.list('ports', 'task', 'ports')).toHaveLength(2);
    });
  });

  it('deleteScope removes only that scope', () => {
    store.set('ports', { task: 't1' }, 'a', 1);
    store.set('rtk', { task: 't1' }, 'b', 2);
    store.set('ports', { task: 't2' }, 'a', 3);
    store.set('ports', { project: 't1' }, 'a', 4);
    store.deleteScope('task', 't1');
    expect(store.get('ports', { task: 't1' }, 'a')).toBeUndefined();
    expect(store.get('rtk', { task: 't1' }, 'b')).toBeUndefined();
    expect(store.get('ports', { task: 't2' }, 'a')).toBe(3);
    expect(store.get('ports', { project: 't1' }, 'a')).toBe(4);
  });
});
