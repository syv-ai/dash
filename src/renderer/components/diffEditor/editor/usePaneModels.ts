import { useLayoutEffect, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { EditorView } from '../types';
import type { LoadState } from './useFileLoad';
import { absolutePath } from './fileRef';
import { acquireSnapshot, acquireWorking, release } from '../models';

type Model = monacoEditor.ITextModel;
type DiffEditor = monacoEditor.IStandaloneDiffEditor;

/** The revisions a view diffs: the original side's, and the modified side's
 *  (null: the working file itself). */
export function viewRevisions(view: EditorView): { original: string; modified: string | null } {
  switch (view.kind) {
    case 'working':
      return { original: view.ref, modified: null };
    case 'branch':
      return { original: view.base, modified: null };
    case 'commit':
      return { original: `${view.hash}^`, modified: view.hash };
    case 'pr':
      return { original: view.base, modified: view.head };
  }
}

interface Args {
  /** This pane, as a model holder. */
  holder: string;
  cwd: string;
  filePath: string;
  view: EditorView;
  state: LoadState;
  /** The pane's widget, once mounted. */
  editor: DiffEditor | null;
  /** Take the disk's text even over unsaved edits, once (reload from disk). */
  forceRef: React.RefObject<boolean>;
}

export interface PaneModels {
  /** The load whose models the widget shows (0: none yet). Hooks that decorate
   *  the models wait for this to match the load. */
  attachedLoadId: number;
  /** The working file's shared model, when the modified side is the working
   *  tree (editable); null for frozen views, deleted files, and before attaching. */
  working: Model | null;
}

/**
 * Gives the pane's diff widget its models for each completed load: a snapshot
 * for the original side and, in the live views, the working file's shared
 * model for the modified side. Keeps each file's scroll and cursor across tab
 * switches, and releases the models it no longer shows.
 */
export function usePaneModels({
  holder,
  cwd,
  filePath,
  view,
  state,
  editor,
  forceRef,
}: Args): PaneModels {
  const [attached, setAttached] = useState<PaneModels>({ attachedLoadId: 0, working: null });
  const viewStates = useRef(new Map<string, monacoEditor.IDiffEditorViewState | null>());
  // The load's inputs, read when its id changes (the id stands for all of them).
  const inputs = useRef({ cwd, filePath, view, state });
  if (state.kind !== 'loading') inputs.current = { cwd, filePath, view, state };

  // Keyed on the last settled load, not the current state: while the next
  // file loads, the widget keeps showing (and holding) the previous one.
  const settled = inputs.current.state;
  const loadId =
    settled.kind === 'loaded' && !settled.isBinary && !settled.isLargeFile ? settled.loadId : 0;

  useLayoutEffect(() => {
    const { cwd, filePath, view, state } = inputs.current;
    if (state.kind !== 'loaded' || loadId === 0 || !editor) {
      setAttached({ attachedLoadId: 0, working: null });
      return;
    }

    const abs = absolutePath(cwd, filePath);
    const revs = viewRevisions(view);
    const original = acquireSnapshot(
      holder,
      abs,
      revs.original,
      state.originalContent,
      state.language,
    );
    const isWorking = revs.modified === null && state.modifiedPresent;
    const modified = isWorking
      ? acquireWorking(
          holder,
          abs,
          state.modifiedContent,
          state.language,
          { mtimeMs: state.mtimeMs, sizeBytes: state.sizeBytes },
          forceRef.current,
        )
      : acquireSnapshot(
          holder,
          abs,
          revs.modified ?? 'deleted',
          state.modifiedContent,
          state.language,
        );
    forceRef.current = false;

    editor.setModel({ original, modified });
    const key = modified.uri.toString();
    const states = viewStates.current;
    const saved = states.get(key);
    if (saved) editor.restoreViewState(saved);
    setAttached({ attachedLoadId: loadId, working: isWorking ? modified : null });

    // The next load (or unmount): remember where the file was scrolled, and
    // let go. Disposal waits a macrotask, by when the widget has new models
    // (or is gone), and skips a model the next load took again.
    return () => {
      // A widget being disposed has dropped its models already.
      if (editor.getModel()) states.set(key, editor.saveViewState());
      release(holder, original);
      release(holder, modified);
    };
  }, [loadId, holder, editor, forceRef]);

  return attached;
}
