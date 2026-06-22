export type TabKind = 'shell' | 'tui' | 'service';

export interface Tab {
  id: string;
  taskId: string;
  kind: TabKind;
  featureId: string | null;
  label: string;
  position: number;
  createdAt: number;
}

export interface AddTabOpts {
  kind: TabKind;
  label?: string;
  featureId?: string;
  /** Pre-existing id (e.g. a PTY id for a shell tab) — optional. */
  id?: string;
}

export interface BulkUpsertEntry {
  taskId: string;
  tabs: Array<Pick<Tab, 'id' | 'kind' | 'label' | 'position'>>;
  activeTabId: string | null;
}
