import type Database from 'better-sqlite3';
import crypto from 'crypto';
import type { Tab, AddTabOpts, BulkUpsertEntry } from '../../shared/drawerTabs';

type Listener = (taskId: string) => void;

export class DrawerTabsService {
  private listeners = new Map<string, Set<Listener>>();

  constructor(private db: Database.Database) {}

  list(taskId: string): Tab[] {
    return this.db
      .prepare(
        `SELECT id, task_id as taskId, kind, feature_id as featureId, label, position, created_at as createdAt
         FROM drawer_tabs WHERE task_id = ? ORDER BY position ASC`,
      )
      .all(taskId) as Tab[];
  }

  getActive(taskId: string): string | null {
    const row = this.db
      .prepare(`SELECT active_drawer_tab_id as id FROM tasks WHERE id = ?`)
      .get(taskId) as { id: string | null } | undefined;
    return row?.id ?? null;
  }

  add(taskId: string, opts: AddTabOpts): Tab {
    const existing = this.list(taskId);
    const id =
      opts.id ??
      `${opts.kind === 'tui' ? `${opts.featureId ?? 'tui'}-tui` : 'shell'}:${taskId}:${crypto
        .randomBytes(3)
        .toString('hex')}`;
    const position = existing.length;
    const label = opts.label ?? String(position + 1);
    const createdAt = Date.now();

    this.db
      .prepare(
        `INSERT INTO drawer_tabs (id, task_id, kind, feature_id, label, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, taskId, opts.kind, opts.featureId ?? null, label, position, createdAt);

    const tab: Tab = {
      id,
      taskId,
      kind: opts.kind,
      featureId: opts.featureId ?? null,
      label,
      position,
      createdAt,
    };

    if (existing.length === 0) this.setActiveInternal(taskId, id);
    this.emit(taskId);
    return tab;
  }

  close(tabId: string): void {
    const row = this.db
      .prepare(`SELECT task_id as taskId FROM drawer_tabs WHERE id = ?`)
      .get(tabId) as { taskId: string } | undefined;
    if (!row) return;
    const taskId = row.taskId;

    this.db.prepare(`DELETE FROM drawer_tabs WHERE id = ?`).run(tabId);

    // Reflow positions so they remain contiguous from 0.
    const remaining = this.list(taskId);
    const update = this.db.prepare(`UPDATE drawer_tabs SET position = ? WHERE id = ?`);
    remaining.forEach((t, i) => update.run(i, t.id));

    if (this.getActive(taskId) === tabId) {
      this.setActiveInternal(taskId, remaining[0]?.id ?? null);
    }
    this.emit(taskId);
  }

  setActive(taskId: string, tabId: string): void {
    const row = this.db
      .prepare(`SELECT 1 FROM drawer_tabs WHERE id = ? AND task_id = ?`)
      .get(tabId, taskId);
    if (!row) throw new Error(`tab ${tabId} not in task ${taskId}`);
    this.setActiveInternal(taskId, tabId);
    this.emit(taskId);
  }

  bulkUpsert(entries: BulkUpsertEntry[]): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO drawer_tabs (id, task_id, kind, feature_id, label, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const setActive = this.db.prepare(`UPDATE tasks SET active_drawer_tab_id = ? WHERE id = ?`);
    const tx = this.db.transaction((es: BulkUpsertEntry[]) => {
      for (const e of es) {
        for (const t of e.tabs) {
          insert.run(t.id, e.taskId, t.kind, null, t.label, t.position, Date.now());
        }
        if (e.activeTabId) setActive.run(e.activeTabId, e.taskId);
      }
    });
    tx(entries);
    for (const e of entries) this.emit(e.taskId);
  }

  onChange(taskId: string, cb: Listener): () => void {
    let set = this.listeners.get(taskId);
    if (!set) {
      set = new Set();
      this.listeners.set(taskId, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) this.listeners.delete(taskId);
    };
  }

  private setActiveInternal(taskId: string, tabId: string | null): void {
    this.db.prepare(`UPDATE tasks SET active_drawer_tab_id = ? WHERE id = ?`).run(tabId, taskId);
  }

  private emit(taskId: string): void {
    const set = this.listeners.get(taskId);
    if (!set) return;
    for (const cb of set) cb(taskId);
  }
}
