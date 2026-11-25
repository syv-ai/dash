import { useCallback, useMemo, useRef } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { prScope } from '../../../../shared/prScope';
import { useCommentsStore } from '../../../stores/commentsStore';
import { prKey, usePrReviews } from '../../../stores/prReviewStore';
import type { TextRange } from '../../../stores/editorTabsStore';
import { navStops, nextStop } from '../../review/outline';
import type { EditorLayout, GroupIndex } from '../tabs/editorLayout';
import type { EditorView } from '../types';

export type NavDirection = 1 | -1;

type Monaco = typeof import('monaco-editor');

/** Lend group `group`'s editor to the navigation while it shows a PR view:
 *  binds ⌥F9 / ⇧⌥F9 on it. Returns the release. */
export type AttachReviewNav = (
  group: GroupIndex,
  editor: monacoEditor.IStandaloneCodeEditor,
  monaco: Monaco,
) => () => void;

export interface ReviewNav {
  /** There is a thread or draft to step to. */
  canStep: boolean;
  /** Step the focused group's editor to its next (1) or previous (-1) stop. */
  step: (dir: NavDirection) => void;
  /** Open a file of the PR in the focused group, as its preview (the toolbar's
   *  Next unviewed file). Stable across renders. */
  open: (path: string) => void;
  /** Stable across renders. */
  attach: AttachReviewNav;
}

/**
 * Next/previous thread or draft in a PR view: on in the open file from the
 * cursor, then across files in the Review outline's order (D42). The editor
 * groups own it: the stops are worked out once here, each pane lends its
 * editor through `attach` (which binds VS Code's comment-thread keys, ⌥F9 /
 * ⇧⌥F9, on it), and the tab strip's buttons `step` the focused one.
 */
export function useReviewNavigation({
  view,
  taskId,
  layout,
  onOpenAt,
  onOpen,
}: {
  view: EditorView;
  taskId: string | null;
  layout: EditorLayout;
  /** Open another file and reveal `range` once it shows. */
  onOpenAt: (path: string, range: TextRange) => void;
  /** Open a file as the focused group's preview. */
  onOpen: (path: string) => void;
}): ReviewNav {
  const review = usePrReviews((s) =>
    view.kind === 'pr' ? (s.byPr[prKey(view.provider, view.number)] ?? null) : null,
  );
  const byFile = useCommentsStore((s) => (taskId && s.taskId === taskId ? s.byFile : null));
  const stops = useMemo(() => {
    if (!review) return [];
    const scope = prScope(review.provider, review.number);
    const drafts = byFile
      ? Object.values(byFile)
          .flat()
          .filter((c) => c.viewScope === scope)
      : [];
    return navStops(review.threads, drafts);
  }, [review, byFile]);

  // The lent editors, and what stepping reads, as of the last render: the
  // keybindings run outside React.
  const panes = useRef(
    new Map<GroupIndex, { editor: monacoEditor.IStandaloneCodeEditor; monaco: Monaco }>(),
  );
  const latest = useRef({ stops, layout, onOpenAt, onOpen });
  latest.current = { stops, layout, onOpenAt, onOpen };

  const go = useCallback((group: GroupIndex, dir: NavDirection) => {
    const pane = panes.current.get(group);
    const { stops, layout, onOpenAt } = latest.current;
    const filePath = layout.groups[group]?.active;
    if (!pane || !filePath) return;
    const line = pane.editor.getPosition()?.lineNumber ?? 0;
    const stop = nextStop(stops, { path: filePath, line }, dir);
    if (!stop) return;
    const range = {
      startLineNumber: stop.line,
      startColumn: 1,
      endLineNumber: stop.line,
      endColumn: 1,
    };
    if (stop.path !== filePath) {
      onOpenAt(stop.path, range);
      return;
    }
    pane.editor.revealLineInCenter(stop.line, pane.monaco.editor.ScrollType.Smooth);
    pane.editor.setSelection(range);
    pane.editor.focus();
  }, []);

  // Actions, not commands: a command binds for every editor on the page.
  const attach = useCallback<AttachReviewNav>(
    (group, editor, monaco) => {
      const pane = { editor, monaco };
      panes.current.set(group, pane);
      const { KeyMod, KeyCode } = monaco;
      const next = editor.addAction({
        id: 'dash.review.nextThread',
        label: 'Go to next thread or draft',
        keybindings: [KeyMod.Alt | KeyCode.F9],
        run: () => go(group, 1),
      });
      const prev = editor.addAction({
        id: 'dash.review.previousThread',
        label: 'Go to previous thread or draft',
        keybindings: [KeyMod.Shift | KeyMod.Alt | KeyCode.F9],
        run: () => go(group, -1),
      });
      return () => {
        next.dispose();
        prev.dispose();
        if (panes.current.get(group) === pane) panes.current.delete(group);
      };
    },
    [go],
  );

  const step = useCallback((dir: NavDirection) => go(latest.current.layout.focused, dir), [go]);
  const open = useCallback((path: string) => latest.current.onOpen(path), []);
  return { canStep: stops.length > 0, step, open, attach };
}
