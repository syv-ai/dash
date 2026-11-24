import { create } from 'zustand';
import {
  EMPTY_LAYOUT,
  activateTab,
  closeTab,
  focusGroup,
  openTab,
  parseLayout,
  serializeLayout,
  type EditorLayout,
  type GroupIndex,
} from '../components/diffEditor/tabs/editorLayout';

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

interface EditorTabsState {
  /** Per workspace (a task's id, or the modal's folder): its tabs and groups. */
  layouts: Record<string, EditorLayout>;
  reveal: RevealRequest | null;
  /** Start a workspace's layout: from storage when `persist`, else empty.
   *  A layout already in memory is kept. */
  load(key: string, persist: boolean): void;
  open(key: string, path: string, opts?: { toSide?: boolean }): void;
  activate(key: string, group: GroupIndex, path: string): void;
  close(key: string, group: GroupIndex, path: string): void;
  focusGroup(key: string, group: GroupIndex): void;
  /** Open `path` in the focused group and reveal `range` there. */
  openAt(key: string, path: string, range: TextRange): void;
  clearReveal(nonce: number): void;
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

let nonce = 0;

export const useEditorTabs = create<EditorTabsState>((set, get) => {
  const update = (key: string, fn: (layout: EditorLayout) => EditorLayout) => {
    const prev = get().layouts[key] ?? EMPTY_LAYOUT;
    const next = fn(prev);
    if (next === prev) return;
    set((s) => ({ layouts: { ...s.layouts, [key]: next } }));
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
    open: (key, path, opts) => update(key, (l) => openTab(l, path, opts)),
    activate: (key, group, path) => update(key, (l) => activateTab(l, group, path)),
    close: (key, group, path) => update(key, (l) => closeTab(l, group, path)),
    focusGroup: (key, group) => update(key, (l) => focusGroup(l, group)),
    openAt: (key, path, range) => {
      update(key, (l) => openTab(l, path));
      const group = (get().layouts[key] ?? EMPTY_LAYOUT).focused;
      set({ reveal: { key, group, path, range, nonce: ++nonce } });
    },
    clearReveal: (n) => {
      if (get().reveal?.nonce === n) set({ reveal: null });
    },
  };
});

/** A workspace's layout (the empty one until it loads). */
export function selectLayout(key: string) {
  return (s: EditorTabsState): EditorLayout => s.layouts[key] ?? EMPTY_LAYOUT;
}
