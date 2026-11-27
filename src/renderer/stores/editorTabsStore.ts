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
  retainTabs,
  serializeLayout,
  type EditorLayout,
  type GroupIndex,
  type OpenOptions,
} from '../components/diffEditor/tabs/editorLayout';
import { track } from '../lib/telemetry';
import type { LineRange } from '../../shared/showFile';

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

/** The file `dashctl show` last put in a workspace's editor, while its tab is open. */
export interface Shown {
  path: string;
  /** Moves with each show: the pane reads the file again and applies it. */
  nonce: number;
  /** Lines to scroll to and highlight, in the source. */
  lines: LineRange | null;
  /** Open rendered (a Markdown or HTML file shown without lines or `--source`). */
  rendered: boolean;
  /** The sidebar has put it on screen (expanded, the list folded); until
   *  then it waits for its task to be the one open. */
  onScreen: boolean;
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
  /** Per workspace: the file `dashctl show` put there last, while it is open. */
  shown: Record<string, Shown>;
  /** Show `path` in the workspace's focused group, as its preview tab (the
   *  next file shown takes its place unless the person kept it). */
  show(key: string, path: string, opts: { lines: LineRange | null; rendered: boolean }): void;
  /** The sidebar has put the workspace's shown file on screen. */
  markShownOnScreen(key: string, nonce: number): void;
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
  // A shown file lasts while its tab is open; closing it ends it.
  const update = (key: string, fn: (layout: EditorLayout) => EditorLayout) => {
    const prev = get().layouts[key] ?? EMPTY_LAYOUT;
    const next = fn(prev);
    if (next === prev) return;
    const shown = get().shown[key];
    const ended = shown && !openPaths(next).includes(shown.path);
    set((s) => ({
      layouts: { ...s.layouts, [key]: next },
      ...(ended ? { shown: without(s.shown, key) } : {}),
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
    open: (key, path, opts) => {
      update(key, (l) => openTab(l, path, opts));
      track('file_opened');
    },
    shown: {},
    show: (key, path, { lines, rendered }) => {
      get().load(key, true);
      update(key, (l) => openTab(l, path, { preview: true }));
      set((s) => ({
        shown: {
          ...s.shown,
          [key]: { path, nonce: ++nonce, lines, rendered, onScreen: false },
        },
      }));
    },
    markShownOnScreen: (key, n) => {
      const p = get().shown[key];
      if (p?.nonce !== n || p.onScreen) return;
      set((s) => ({ shown: { ...s.shown, [key]: { ...p, onScreen: true } } }));
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
