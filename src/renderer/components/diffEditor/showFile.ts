import { useEffect, useRef } from 'react';
import { useEditorTabs } from '../../stores/editorTabsStore';
import { previewKind } from './editor/previewDocument';

/*
 * `dashctl show`: main sends `app:showFile`, the file opens in its task's
 * editor (`editorTabsStore.show`; the pane applies it, `EditorPane`), and the
 * task's sidebar puts it on screen once that task is the one open: at once
 * for the open task, else when the person next opens it.
 */

/** Listen for main's show requests, for every task (from `main.tsx`). A
 *  Markdown or HTML file opens rendered, unless lines or its source are asked for. */
export function installShowRequests(): void {
  window.electronAPI.onShowFile(({ taskId, path, lines, source }) =>
    useEditorTabs.getState().show(taskId, path, {
      lines,
      rendered: !source && !lines && previewKind(path) !== null,
    }),
  );
}

/**
 * The open task's sidebar puts a shown file on screen: `reveal` brings the
 * task sidebar out of its rail if it is collapsed and opens the editor
 * expanded (the left sidebar folds to its rail, D259); once the editor shows
 * expanded (`onScreen`), the list column folds to the task rail beside it, in
 * the tree toggle's motion, so the file has the room. Folding waits for both:
 * the list panel it folds mounts with the split, and a collapsed sidebar
 * hides it, so the file would never come on screen.
 */
export function useShowOnScreen(taskId: string, onScreen: boolean, reveal: () => void): void {
  const pending = useEditorTabs((s) => {
    const p = s.shown[taskId];
    return p && !p.onScreen ? p.nonce : null;
  });
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useEffect(() => {
    if (pending === null) return;
    if (!onScreen) {
      revealRef.current();
      return;
    }
    const tabs = useEditorTabs.getState();
    tabs.setTreeCollapsed(true);
    tabs.markShownOnScreen(taskId, pending);
  }, [taskId, pending, onScreen]);
}
