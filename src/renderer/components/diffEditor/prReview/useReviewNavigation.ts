import { useCallback, useEffect } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { TextRange } from '../../../stores/editorTabsStore';
import { nextStop, type NavStop } from '../../review/outline';

export type NavDirection = 1 | -1;

// Each pane's way to step, so the tab strip's buttons can drive the focused one.
const panes = new Map<string, (dir: NavDirection) => void>();

/** Step the pane `paneId` to its next (1) or previous (-1) thread or draft. */
export function navigateReview(paneId: string, dir: NavDirection): void {
  panes.get(paneId)?.(dir);
}

/**
 * Next/previous thread or draft in a PR view: on in the open file from the
 * cursor, then across files in the Review outline's order. ⌥F9 / ⇧⌥F9 (VS
 * Code's comment-thread keys) on this editor, and `navigateReview` for the
 * tab strip's buttons. Inert outside a PR view.
 */
export function useReviewNavigation({
  paneId,
  modifiedEditor,
  monaco,
  enabled,
  filePath,
  stops,
  onOpenAt,
}: {
  paneId: string;
  modifiedEditor: monacoEditor.IStandaloneCodeEditor | null;
  monaco: typeof import('monaco-editor') | null;
  enabled: boolean;
  filePath: string;
  stops: readonly NavStop[];
  /** Open another file and reveal `range` once it shows. */
  onOpenAt: (path: string, range: TextRange) => void;
}): void {
  const go = useCallback(
    (dir: NavDirection) => {
      if (!modifiedEditor || !monaco) return;
      const line = modifiedEditor.getPosition()?.lineNumber ?? 0;
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
      modifiedEditor.revealLineInCenter(stop.line, monaco.editor.ScrollType.Smooth);
      modifiedEditor.setSelection(range);
      modifiedEditor.focus();
    },
    [modifiedEditor, monaco, stops, filePath, onOpenAt],
  );

  useEffect(() => {
    if (!enabled) return;
    panes.set(paneId, go);
    return () => {
      if (panes.get(paneId) === go) panes.delete(paneId);
    };
  }, [enabled, paneId, go]);

  // Actions, not commands: a command binds for every editor on the page.
  useEffect(() => {
    if (!enabled || !modifiedEditor || !monaco) return;
    const { KeyMod, KeyCode } = monaco;
    const next = modifiedEditor.addAction({
      id: 'dash.review.nextThread',
      label: 'Go to next thread or draft',
      keybindings: [KeyMod.Alt | KeyCode.F9],
      run: () => go(1),
    });
    const prev = modifiedEditor.addAction({
      id: 'dash.review.previousThread',
      label: 'Go to previous thread or draft',
      keybindings: [KeyMod.Shift | KeyMod.Alt | KeyCode.F9],
      run: () => go(-1),
    });
    return () => {
      next.dispose();
      prev.dispose();
    };
  }, [enabled, modifiedEditor, monaco, go]);
}
