import { create } from 'zustand';
import {
  EMPTY_LAYOUT,
  activateTab,
  closeTab,
  closeTabs,
  focusGroup,
  openPaths,
  openTab,
  parseLayout,
  pinTab,
  presentTab,
  retainTabs,
  serializeLayout,
  type EditorLayout,
  type GroupIndex,
  type OpenOptions,
} from '../components/diffEditor/tabs/editorLayout';
import { track } from '../lib/telemetry';

/** A span of text, 1-based (Monaco's IRange shape, so LSP ranges convert to it). */
export interface TextRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** Show `path` at `range` once its pane has it on screen. */
export interface RevealRequest {
  key: string;
  group: GroupIndex;
  path: string;
  range: TextRange;
  nonce: number;
}

/** Unfold the tree down to `path` (a folder), e.g. after a tab turned out to
 *  name a directory. */
export interface ExpandFolderRequest {
  path: string;
  nonce: number;
}

/** A workspace's presented tab (`dashctl present`): read-only, rendered. */
export interface Presented {
  path: string;
  /** Moves with each `present`, which reloads the file. */
  nonce: number;
  /** The sidebar has shown it (expanded, the list folded); until then it
   *  waits for its task to be the one open. */
  shown: boolean;
}

interface EditorTabsState {
  /** Per workspace (a task's id, or the modal's folder): its tabs and groups. */
  layouts: Record<string, EditorLayout>;
  reveal: RevealRequest | null;
  /** Start a workspace's layout: from storage when `persist`, else empty.
   *  A layout already in memory is kept. */
  load(key: string, persist: boolean): void;
  open(key: string, path: string, opts?: OpenOptions): void;
  activate(key: string, group: GroupIndex, path: string): void;
  close(key: string, group: GroupIndex, path: string): void;
  /** Close several of `group`'s tabs at once. */
  closeMany(key: string, group: GroupIndex, paths: string[]): void;
  /** Keep a preview tab open. */
  pin(key: string, group: GroupIndex, path: string): void;
  /** Close every tab `keep` turns down. */
  retain(key: string, keep: (path: string, preview: boolean) => boolean): void;
  focusGroup(key: string, group: GroupIndex): void;
  /** Open `path` in the focused group, as its preview, and reveal `range` there. */
  openAt(key: string, path: string, range: TextRange): void;
  clearReveal(nonce: number): void;
  expandFolder: ExpandFolderRequest | null;
  requestExpandFolder(path: string): void;
  /** Per workspace: its presented tab, while it is open. */
  presented: Record<string, Presented>;
  /** Show `path` in the workspace's presented tab (the one before's place). */
  present(key: string, path: string): void;
  /** The sidebar has shown the workspace's presented tab. */
  markPresentedShown(key: string, nonce: number): void;
  /** The editor's file tree column is folded away (every workspace's). */
  treeCollapsed: boolean;
  setTreeCollapsed(collapsed: boolean): void;
}

const storageKey = (key: string) => `dash:editor-tabs:${key}`;
/** Workspaces whose layout survives a restart (a task's; not the modal's). */
const persisted = new Set<string>();

function readStored(key: string): EditorLayout | null {
  try {
    return parseLayout(window.localStorage.getItem(storageKey(key)));
  } catch {
    return null;
  }
}

function writeStored(key: string, layout: EditorLayout): void {
  if (!persisted.has(key)) return;
  try {
    window.localStorage.setItem(storageKey(key), serializeLayout(layout));
  } catch {
    // Storage full or unavailable: the tabs just don't come back.
  }
}

const TREE_COLLAPSED_KEY = 'dash:editor-tree-collapsed';

function readTreeCollapsed(): boolean {
  try {
    return window.localStorage.getItem(TREE_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

let nonce = 0;

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...record };
  delete rest[key];
  return rest;
}

export const useEditorTabs = create<EditorTabsState>((set, get) => {
  // A presented tab lasts while it is open; closing it ends it.
  const update = (key: string, fn: (layout: EditorLayout) => EditorLayout) => {
    const prev = get().layouts[key] ?? EMPTY_LAYOUT;
    const next = fn(prev);
    if (next === prev) return;
    const shown = get().presented[key];
    const ended = shown && !openPaths(next).includes(shown.path);
    set((s) => ({
      layouts: { ...s.layouts, [key]: next },
      ...(ended ? { presented: without(s.presented, key) } : {}),
    }));
    writeStored(key, next);
  };
  return {
    layouts: {},
    reveal: null,
    load: (key, persist) => {
      if (persist) persisted.add(key);
      if (get().layouts[key]) return;
      const layout = (persist && readStored(key)) || EMPTY_LAYOUT;
      set((s) => ({ layouts: { ...s.layouts, [key]: layout } }));
    },
    // Opened for itself (the tree, a link), a presented file becomes a
    // plain tab, editable again.
    open: (key, path, opts) => {
      if (get().presented[key]?.path === path) {
        set((s) => ({ presented: without(s.presented, key) }));
      }
      update(key, (l) => openTab(l, path, opts));
      track('file_opened');
    },
    presented: {},
    present: (key, path) => {
      get().load(key, true);
      const before = get().presented[key]?.path ?? null;
      update(key, (l) => presentTab(l, path, before));
      set((s) => ({
        presented: { ...s.presented, [key]: { path, nonce: ++nonce, shown: false } },
      }));
    },
    markPresentedShown: (key, n) => {
      const p = get().presented[key];
      if (p?.nonce !== n || p.shown) return;
      set((s) => ({ presented: { ...s.presented, [key]: { ...p, shown: true } } }));
    },
    activate: (key, group, path) => update(key, (l) => activateTab(l, group, path)),
    close: (key, group, path) => update(key, (l) => closeTab(l, group, path)),
    closeMany: (key, group, paths) => update(key, (l) => closeTabs(l, group, paths)),
    pin: (key, group, path) => update(key, (l) => pinTab(l, group, path)),
    retain: (key, keep) => update(key, (l) => retainTabs(l, keep)),
    focusGroup: (key, group) => update(key, (l) => focusGroup(l, group)),
    openAt: (key, path, range) => {
      update(key, (l) => openTab(l, path, { preview: true }));
      track('file_opened');
      const group = (get().layouts[key] ?? EMPTY_LAYOUT).focused;
      set({ reveal: { key, group, path, range, nonce: ++nonce } });
    },
    clearReveal: (n) => {
      if (get().reveal?.nonce === n) set({ reveal: null });
    },
    expandFolder: null,
    requestExpandFolder: (path) => set({ expandFolder: { path, nonce: ++nonce } }),
    treeCollapsed: readTreeCollapsed(),
    setTreeCollapsed: (collapsed) => {
      if (get().treeCollapsed === collapsed) return;
      set({ treeCollapsed: collapsed });
      try {
        window.localStorage.setItem(TREE_COLLAPSED_KEY, collapsed ? '1' : '0');
      } catch {
        // Unavailable storage: it just isn't remembered.
      }
    },
  };
});

/** A workspace's layout (the empty one until it loads). */
export function selectLayout(key: string) {
  return (s: EditorTabsState): EditorLayout => s.layouts[key] ?? EMPTY_LAYOUT;
}
