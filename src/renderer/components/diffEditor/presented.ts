import { useEffect, useRef } from 'react';
import { useEditorTabs } from '../../stores/editorTabsStore';

/*
 * `dashctl present`: main sends `app:presentFile`, the file goes in its
 * task's presented tab (read-only, rendered; `EditorPane`), and the task's
 * sidebar shows it once that task is the one open: at once for the open
 * task, else when the person next opens it.
 */

/** Listen for main's present requests, for every task (from `main.tsx`). */
export function installPresentRequests(): void {
  window.electronAPI.onPresentFile(({ taskId, path }) =>
    useEditorTabs.getState().present(taskId, path),
  );
}

/**
 * The open task's sidebar shows a presented tab it hasn't yet: `expand` opens
 * the editor expanded (the left sidebar folds to its rail, D259); once it is,
 * the list column folds to the task rail beside it, in the tree toggle's
 * motion, so the file has the room. Folding waits for the split: the list
 * panel it folds mounts with it.
 */
export function useShowPresented(taskId: string, expanded: boolean, expand: () => void): void {
  const pending = useEditorTabs((s) => {
    const p = s.presented[taskId];
    return p && !p.shown ? p.nonce : null;
  });
  const expandRef = useRef(expand);
  expandRef.current = expand;
  useEffect(() => {
    if (pending === null) return;
    if (!expanded) {
      expandRef.current();
      return;
    }
    const tabs = useEditorTabs.getState();
    tabs.setTreeCollapsed(true);
    tabs.markPresentedShown(taskId, pending);
  }, [taskId, pending, expanded]);
}
