import { useCallback, useEffect, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { useCommentsStore } from '../../../stores/commentsStore';
import type { DiffComment, LineRange, LiveComment } from './types';

// Frozen empty default so render-time `?? []` doesn't allocate a fresh
// array each pass (the result feeds effect dep arrays).
const EMPTY_STORED: readonly DiffComment[] = Object.freeze([]);

interface Args {
  filePath: string;
  /** True once the model's content matches `filePath` (i.e. the file is
   *  loaded). Hydration must wait for this to flip. */
  isFileLoaded: boolean;
  /** Diff editor instance (state, not ref) — null until mount. Effects
   *  that need post-mount access get a reactive signal when this flips. */
  editor: monacoEditor.IStandaloneDiffEditor | null;
  monaco: typeof import('monaco-editor') | null;
}

interface Binding {
  liveComments: LiveComment[];
  /** Add a new comment: creates the persisted entity via the store, then
   *  attaches a decoration. Returns the created live comment (or null when
   *  the store is disabled). */
  addComment(range: LineRange, text: string): LiveComment | null;
  /** Edit a comment's text in place (does not affect range or sent). */
  updateText(id: string, text: string): void;
  /** Remove this comment from both the store and the local decoration. */
  remove(id: string): void;
}

/** Owns the Monaco-decoration lifecycle for ONE filePath. Hydration runs
 *  exactly once per (filePath, loaded-content) pair via a local
 *  hydratedKeyRef. Snapshot runs on unmount (file switch or modal close)
 *  via a closure-captured `filePath`, so a later filePath change can never
 *  corrupt the snapshot's destination. This is what fixes the phantom-
 *  comment-on-switch bug from the previous filePath-ref-based design. */
export function useFileCommentsBinding(args: Args): Binding {
  const { filePath, isFileLoaded, editor, monaco } = args;
  const storeReady = useCommentsStore((s) => s.isReady);
  const stored = useCommentsStore((s) => s.byFile[filePath]) ?? EMPTY_STORED;

  const [liveComments, setLiveComments] = useState<LiveComment[]>([]);
  const liveCommentsRef = useRef<LiveComment[]>([]);
  liveCommentsRef.current = liveComments;

  // Track which (filePath, loaded) pair we've hydrated. Reset on file
  // change or when isFileLoaded goes false; rehydrate exactly once on the
  // next loaded-true transition.
  const hydratedKeyRef = useRef<string>('');

  // Hydrate when the new file's content is in the model AND the persisted
  // comments have arrived from SQLite. If we hydrate before the store
  // resolves, `stored` is empty and the key latches — the dropdown later
  // shows comments from the resolved store, but their decorations never
  // get attached because this effect won't re-run.
  useEffect(() => {
    if (!isFileLoaded || !storeReady) {
      // File is loading OR store hasn't resolved yet. Drop live state but
      // DO NOT snapshot — there are no valid decorations to read against
      // the current (still-old) model.
      setLiveComments([]);
      hydratedKeyRef.current = '';
      return;
    }
    const key = `${filePath}::loaded`;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;

    const modified = editor?.getModifiedEditor();
    const model = modified?.getModel();
    if (!modified || !monaco || !model) {
      setLiveComments([]);
      return;
    }
    if (stored.length === 0) {
      setLiveComments([]);
      return;
    }
    const lineCount = model.getLineCount();
    const hydrated: LiveComment[] = stored.map((sc) => {
      const start = Math.min(Math.max(1, sc.startLine), lineCount);
      const end = Math.min(Math.max(start, sc.endLine), lineCount);
      const ids = model.deltaDecorations(
        [],
        [
          {
            range: new monaco.Range(start, 1, end, 1),
            options: { isWholeLine: true, stickiness: 1 },
          },
        ],
      );
      return { ...sc, decorationId: ids[0]! };
    });
    setLiveComments(hydrated);
    // `stored` is intentionally excluded from deps: store mutations
    // (add/update/remove) should NOT trigger re-hydration. Reconciliation
    // is handled by the separate effects below.
  }, [filePath, isFileLoaded, storeReady, editor, monaco]);

  // Reconcile parent-driven removals: if `stored` drops an id, remove the
  // matching local decoration.
  useEffect(() => {
    if (hydratedKeyRef.current !== `${filePath}::loaded`) return;
    const storedIds = new Set(stored.map((s) => s.id));
    const removed: LiveComment[] = [];
    const remaining: LiveComment[] = [];
    for (const c of liveCommentsRef.current) {
      if (storedIds.has(c.id)) remaining.push(c);
      else removed.push(c);
    }
    if (removed.length === 0) return;
    const model = editor?.getModifiedEditor().getModel();
    if (model) {
      model.deltaDecorations(
        removed.map((c) => c.decorationId),
        [],
      );
    }
    setLiveComments(remaining);
  }, [stored, filePath, editor]);

  // Mirror text/sent edits from the store into liveComments (without
  // touching decorations or ranges). Skip when arrays match by reference.
  useEffect(() => {
    if (hydratedKeyRef.current !== `${filePath}::loaded`) return;
    let changed = false;
    const next = liveCommentsRef.current.map((live) => {
      const fresh = stored.find((s) => s.id === live.id);
      if (!fresh) return live;
      if (fresh.text === live.text && fresh.sent === live.sent) return live;
      changed = true;
      return { ...live, text: fresh.text, sent: fresh.sent };
    });
    if (changed) setLiveComments(next);
  }, [stored, filePath]);

  // Snapshot on unmount / filePath change. CRITICAL: `pathAtMount` is
  // captured in the effect closure, so the snapshot lands on the correct
  // file even after `filePath` has already advanced. The previous design
  // used `filePathRef.current`, which had already updated by the time
  // cleanup ran — that was the source of the phantom-comment bug.
  useEffect(() => {
    const pathAtMount = filePath;
    return () => {
      const model = editor?.getModifiedEditor().getModel();
      if (!model) return;
      const snapshots = liveCommentsRef.current.flatMap((c) => {
        const r = model.getDecorationRange(c.decorationId);
        if (!r) return [];
        return [{ id: c.id, startLine: r.startLineNumber, endLine: r.endLineNumber }];
      });
      if (snapshots.length === 0) return;
      useCommentsStore.getState().snapshotRanges(pathAtMount, snapshots);
    };
  }, [filePath, editor]);

  const addComment = useCallback(
    (range: LineRange, text: string): LiveComment | null => {
      const modified = editor?.getModifiedEditor();
      const model = modified?.getModel();
      if (!modified || !monaco || !model) return null;
      const created = useCommentsStore.getState().addComment({
        filePath,
        startLine: range.start,
        endLine: range.end,
        text,
      });
      if (!created) return null;
      const ids = model.deltaDecorations(
        [],
        [
          {
            range: new monaco.Range(range.start, 1, range.end, 1),
            options: { isWholeLine: true, stickiness: 1 },
          },
        ],
      );
      const live: LiveComment = { ...created, decorationId: ids[0]! };
      setLiveComments((prev) => [...prev, live]);
      return live;
    },
    [filePath, editor, monaco],
  );

  const updateText = useCallback((id: string, text: string) => {
    useCommentsStore.getState().updateText(id, text);
  }, []);

  const remove = useCallback(
    (id: string) => {
      const target = liveCommentsRef.current.find((c) => c.id === id);
      useCommentsStore.getState().remove(id);
      const model = editor?.getModifiedEditor().getModel();
      if (model && target) {
        model.deltaDecorations([target.decorationId], []);
      }
      setLiveComments((prev) => prev.filter((c) => c.id !== id));
    },
    [editor],
  );

  return { liveComments, addComment, updateText, remove };
}
