import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createAddonStore, ensureAddonTables, type AddonStore } from '../addonStore';

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
