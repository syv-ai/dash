import { create } from 'zustand';
import type { PrProvider } from '../../shared/types';

/** What an editor opens on: a file, and the view to show it in. */
export interface DiffFileTarget {
  cwd: string;
  /** The file to open, or '' to show the editor's open tabs. */
  filePath: string;
  initialView?:
    | { kind: 'working'; ref: 'HEAD' | 'index' }
    | { kind: 'commit'; hash: string }
    | { kind: 'pr'; provider: PrProvider; number: number; base: string; head: string };
}

/** A folder's open editor. */
export interface OpenEditor {
  /** What it last opened on (each new one opens its file). */
  target: DiffFileTarget;
  /** Open but out of sight: a task's sidebar went narrow and keeps the
   *  editor mounted (tabs, unsaved edits) until the next file opens. */
  hidden: boolean;
}

interface EditorsState {
  /**
   * Per task worktree, its open editor; no entry, closed. Per folder, so each task keeps its own editor
   * (and its unsaved edits) while another is active.
   */
  byCwd: Record<string, OpenEditor>;
  /** Open (or show) `target.cwd`'s editor on `target`: a task's sidebar expands. */
  open(target: DiffFileTarget): void;
  /** Keep `cwd`'s editor but out of sight: its task's sidebar goes narrow. */
  hide(cwd: string): void;
  /** Close `cwd`'s editor (its unsaved edits go: the caller asked first). */
  close(cwd: string): void;
  /** `cwd`'s task was switched away from. Coming back restores its tabs as
   *  they were rather than opening again the file it was opened on. */
  park(cwd: string): void;
}

const RESTORE_TABS = (cwd: string): DiffFileTarget => ({ cwd, filePath: '' });

export const useEditors = create<EditorsState>((set, get) => {
  const put = (cwd: string, next: OpenEditor | null) =>
    set((s) => {
      const byCwd = { ...s.byCwd };
      if (next) byCwd[cwd] = next;
      else delete byCwd[cwd];
      return { byCwd };
    });
  return {
    byCwd: {},
    open: (target) => put(target.cwd, { target, hidden: false }),
    hide: (cwd) => {
      const e = get().byCwd[cwd];
      if (e && !e.hidden) put(cwd, { ...e, hidden: true });
    },
    close: (cwd) => {
      if (get().byCwd[cwd]) put(cwd, null);
    },
    park: (cwd) => {
      const e = get().byCwd[cwd];
      if (e && (e.target.filePath || e.target.initialView)) {
        put(cwd, { ...e, target: RESTORE_TABS(cwd) });
      }
    },
  };
});

/** `cwd`'s open editor, or null when it is closed. */
export function selectEditor(cwd: string | null | undefined) {
  return (s: EditorsState): OpenEditor | null => (cwd ? (s.byCwd[cwd] ?? null) : null);
}
