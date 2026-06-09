import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { DrawerTabsService } from '../DrawerTabsService';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY, active_drawer_tab_id TEXT);
    CREATE TABLE drawer_tabs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      feature_id TEXT,
      label TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO tasks (id) VALUES ('t1'), ('t2');
  `);
  return db;
}

describe('DrawerTabsService', () => {
  let svc: DrawerTabsService;
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    svc = new DrawerTabsService(db);
  });

  it('list() returns empty for a task with no tabs', () => {
    expect(svc.list('t1')).toEqual([]);
  });

  it('add() inserts a tab and makes it active when it is the first', () => {
    const tab = svc.add('t1', { kind: 'shell', label: '1' });
    expect(tab.taskId).toBe('t1');
    expect(tab.position).toBe(0);
    expect(svc.list('t1')).toEqual([tab]);
    expect(svc.getActive('t1')).toBe(tab.id);
  });

  it('add() preserves position order across multiple tabs', () => {
    const a = svc.add('t1', { kind: 'shell', label: '1' });
    const b = svc.add('t1', { kind: 'shell', label: '2' });
    const c = svc.add('t1', { kind: 'tui', label: 'Ports', featureId: 'ports' });
    expect(svc.list('t1').map((t) => t.id)).toEqual([a.id, b.id, c.id]);
    expect(c.featureId).toBe('ports');
  });

  it('close() removes the tab and reassigns active to the next remaining', () => {
    const a = svc.add('t1', { kind: 'shell', label: '1' });
    const b = svc.add('t1', { kind: 'shell', label: '2' });
    svc.setActive('t1', b.id);
    svc.close(b.id);
    expect(svc.list('t1').map((t) => t.id)).toEqual([a.id]);
    expect(svc.getActive('t1')).toBe(a.id);
  });

  it('close() clears active when the last tab is removed', () => {
    const a = svc.add('t1', { kind: 'shell', label: '1' });
    svc.close(a.id);
    expect(svc.list('t1')).toEqual([]);
    expect(svc.getActive('t1')).toBeNull();
  });

  it('setActive() rejects unknown tab id', () => {
    expect(() => svc.setActive('t1', 'nonexistent')).toThrow();
  });

  it('onChange() fires when the task list changes', () => {
    const calls: number[] = [];
    const unsub = svc.onChange('t1', () => calls.push(1));
    svc.add('t1', { kind: 'shell', label: '1' });
    svc.add('t1', { kind: 'shell', label: '2' });
    svc.add('t2', { kind: 'shell', label: '1' }); // different task — must not fire
    unsub();
    svc.add('t1', { kind: 'shell', label: '3' }); // after unsub — must not fire
    expect(calls.length).toBe(2);
  });

  it('bulkUpsert() seeds tabs and active for migration', () => {
    svc.bulkUpsert([
      {
        taskId: 't1',
        tabs: [
          { id: 'shell:t1', kind: 'shell', label: '1', position: 0 },
          { id: 'shell:t1:1', kind: 'shell', label: '2', position: 1 },
        ],
        activeTabId: 'shell:t1:1',
      },
    ]);
    expect(svc.list('t1').map((t) => t.id)).toEqual(['shell:t1', 'shell:t1:1']);
    expect(svc.getActive('t1')).toBe('shell:t1:1');
  });

  it('sweepTuiTabs() removes all tui rows and clears stale active pointers', () => {
    const shell = svc.add('t1', { kind: 'shell', label: '1' });
    const tui = svc.add('t1', { kind: 'tui', featureId: 'ports', label: 'Ports' });
    svc.setActive('t1', tui.id);
    expect(svc.getActive('t1')).toBe(tui.id);

    const swept = svc.sweepTuiTabs();

    expect(swept).toEqual(['t1']);
    expect(svc.list('t1').map((t) => t.id)).toEqual([shell.id]);
    // Active pointed at the TUI — it gets cleared (renderer will pick another
    // tab the next time it refreshes).
    expect(svc.getActive('t1')).toBeNull();
  });

  it('sweepTuiTabs() is a no-op when no tui rows exist', () => {
    svc.add('t1', { kind: 'shell', label: '1' });
    expect(svc.sweepTuiTabs()).toEqual([]);
    expect(svc.list('t1')).toHaveLength(1);
  });

  it('bulkUpsert() silently skips entries for tasks that no longer exist', () => {
    // Old localStorage keys can outlive their tasks; the migration shim
    // forwards them all, and FK enforcement would otherwise throw.
    svc.bulkUpsert([
      {
        taskId: 'gone',
        tabs: [{ id: 'shell:gone', kind: 'shell', label: '1', position: 0 }],
        activeTabId: 'shell:gone',
      },
      {
        taskId: 't1',
        tabs: [{ id: 'shell:t1', kind: 'shell', label: '1', position: 0 }],
        activeTabId: 'shell:t1',
      },
    ]);
    expect(svc.list('gone')).toEqual([]);
    expect(svc.list('t1').map((t) => t.id)).toEqual(['shell:t1']);
  });
});
