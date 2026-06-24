import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { useCommentsStore } from '../../../stores/commentsStore';
import { isFullModelReplace, projectRanges, rangesEqual, type RangeReader } from './liveProjection';
import type { DiffComment, LineRange, LiveComment } from './types';

// Frozen empty default so `?? EMPTY_STORED` doesn't allocate a fresh array
// each render (the result feeds effect dep arrays).
const EMPTY_STORED: readonly DiffComment[] = Object.freeze([]);

interface Args {
  filePath: string;
  /** True once the model's content matches `filePath` (i.e. the file is
   *  loaded). Hydration must wait for this to flip. */
  isFileLoaded: boolean;
  /** Diff editor instance (state, not ref) — null until mount. */
  editor: monacoEditor.IStandaloneDiffEditor | null;
  monaco: typeof import('monaco-editor') | null;
  /** Content-state the current view anchors to ('live' or 'commit:<hash>').
   *  Only comments of this scope are hydrated/shown for the file. */
  scope: string;
}

export interface FileCommentsBinding {
  /** Comments for the open file, ranges already projected to live values. */
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

/** Owns the Monaco-decoration lifecycle for ONE filePath AND is the single
 *  place `decorationId → live range` projection happens. Hydration runs once
 *  per (filePath, loaded-content) pair; a content-change subscription
 *  re-publishes `liveComments` with their live ranges (guarded by rangesEqual
 *  so no new reference is emitted unless a range actually moved). Snapshot
 *  runs on unmount/file-switch via a closure-captured `filePath`. */
export function useFileComments({
  filePath,
  isFileLoaded,
  editor,
  monaco,
  scope,
}: Args): FileCommentsBinding {
  const storeReady = useCommentsStore((s) => s.isReady);
  const allStored = useCommentsStore((s) => s.byFile[filePath]) ?? EMPTY_STORED;
  // Only comments anchored to the view's current diff state belong here. Memo
  // keeps the reference stable (it feeds effect dep arrays) unless the file's
  // comments or the scope actually change.
  const stored = useMemo(() => allStored.filter((c) => c.viewScope === scope), [allStored, scope]);
  // Latest stored comments, readable from callbacks (hydrate/re-anchor) without
  // making `stored` an effect/callback dependency.
  const storedRef = useRef<readonly DiffComment[]>(stored);
  storedRef.current = stored;

  const [liveComments, setLiveComments] = useState<LiveComment[]>([]);
  const liveCommentsRef = useRef<LiveComment[]>([]);
  liveCommentsRef.current = liveComments;
  const hydratedKeyRef = useRef<string>('');

  const modifiedEditor = editor?.getModifiedEditor() ?? null;

  const makeReader = useCallback((): RangeReader => {
    const model = modifiedEditor?.getModel() ?? null;
    return (decorationId) => {
      const r = model?.getDecorationRange(decorationId);
      return r ? { startLine: r.startLineNumber, endLine: r.endLineNumber } : null;
    };
  }, [modifiedEditor]);

  // Publish a re-projection if (and only if) a range actually changed.
  const republish = useCallback(() => {
    const next = projectRanges(liveCommentsRef.current, makeReader());
    if (!rangesEqual(liveCommentsRef.current, next)) setLiveComments(next);
  }, [makeReader]);

  // (Re)create decorations from the STORE — the source of truth — discarding
  // whatever the current decorations say. Used for the initial hydrate and to
  // re-anchor after a wholesale content replacement (which collapses every
  // decoration onto the last line; see the content-change effect). Reads the
  // latest stored comments via the ref so it isn't recreated per store mutation.
  const hydrate = useCallback((): boolean => {
    const model = modifiedEditor?.getModel();
    if (!modifiedEditor || !monaco || !model) return false;
    const prevIds = liveCommentsRef.current.map((c) => c.decorationId);
    if (prevIds.length > 0) model.deltaDecorations(prevIds, []);
    const src = storedRef.current;
    if (src.length === 0) {
      setLiveComments([]);
      return true;
    }
    const lineCount = model.getLineCount();
    const hydrated: LiveComment[] = src.map((sc) => {
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
      return { ...sc, startLine: start, endLine: end, decorationId: ids[0]! };
    });
    setLiveComments(hydrated);
    return true;
  }, [modifiedEditor, monaco]);

  // ── Hydrate (file loaded + store ready) ──
  useEffect(() => {
    if (!isFileLoaded || !storeReady) {
      // File is loading OR store hasn't resolved yet. Drop live state but DO
      // NOT snapshot — there are no valid decorations against the (still-old)
      // model.
      const model = modifiedEditor?.getModel();
      const prevIds = liveCommentsRef.current.map((c) => c.decorationId);
      if (model && prevIds.length > 0) model.deltaDecorations(prevIds, []);
      setLiveComments([]);
      hydratedKeyRef.current = '';
      return;
    }
    // Keyed by file AND scope so switching to a different diff state
    // (e.g. working → a specific commit) re-anchors from that scope's comments.
    const key = `${filePath}::${scope}::loaded`;
    if (hydratedKeyRef.current === key) return;
    // Mark the key done ONLY if hydration actually ran — on first open the
    // effect can fire before the diff editor finishes mounting (modifiedEditor
    // still null), and marking it prematurely would skip the retry once the
    // editor is ready (the bug where comments showed only after navigating
    // away and back). Store mutations do NOT trigger re-hydration (hydrate
    // reads storedRef); reconciliation lives in the effects below.
    if (hydrate()) hydratedKeyRef.current = key;
  }, [filePath, scope, isFileLoaded, storeReady, modifiedEditor, hydrate]);

  // ── React to content changes ──
  // A wholesale content swap (file (re)load) reaches the modified model via the
  // editor lib's `executeEdits(fullRange, { forceMoveMarkers: true })`, which
  // shoves every comment decoration onto the last line. Detect that and
  // re-anchor from the store instead of reading back the collapsed ranges.
  // Incremental edits (typing) fall through to a normal live re-projection so
  // comments still track the lines they're attached to.
  useEffect(() => {
    if (!modifiedEditor) return;
    const sub = modifiedEditor.onDidChangeModelContent((e) => {
      const model = modifiedEditor.getModel();
      if (model && isFullModelReplace(e, model.getValue())) hydrate();
      else republish();
    });
    return () => sub.dispose();
  }, [modifiedEditor, hydrate, republish]);

  // ── Reconcile store removals → drop decorations ──
  useEffect(() => {
    if (hydratedKeyRef.current !== `${filePath}::${scope}::loaded`) return;
    const storedIds = new Set(stored.map((s) => s.id));
    const removed = liveCommentsRef.current.filter((c) => !storedIds.has(c.id));
    if (removed.length === 0) return;
    const model = modifiedEditor?.getModel();
    if (model)
      model.deltaDecorations(
        removed.map((c) => c.decorationId),
        [],
      );
    setLiveComments(liveCommentsRef.current.filter((c) => storedIds.has(c.id)));
  }, [stored, filePath, scope, modifiedEditor]);

  // ── Mirror text/sent edits from store (not ranges) ──
  useEffect(() => {
    if (hydratedKeyRef.current !== `${filePath}::${scope}::loaded`) return;
    let changed = false;
    const next = liveCommentsRef.current.map((live) => {
      const fresh = stored.find((s) => s.id === live.id);
      if (!fresh || (fresh.text === live.text && fresh.sent === live.sent)) return live;
      changed = true;
      return { ...live, text: fresh.text, sent: fresh.sent };
    });
    if (changed) setLiveComments(next);
  }, [stored, filePath, scope]);

  // ── Snapshot on unmount / file switch (closure-captured path) ──
  useEffect(() => {
    const pathAtMount = filePath;
    return () => {
      const model = modifiedEditor?.getModel();
      if (!model) return;
      const snapshots = liveCommentsRef.current.flatMap((c) => {
        const r = model.getDecorationRange(c.decorationId);
        return r ? [{ id: c.id, startLine: r.startLineNumber, endLine: r.endLineNumber }] : [];
      });
      if (snapshots.length > 0) useCommentsStore.getState().snapshotRanges(pathAtMount, snapshots);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, editor]);

  const addComment = useCallback(
    (range: LineRange, text: string): LiveComment | null => {
      const model = modifiedEditor?.getModel();
      if (!modifiedEditor || !monaco || !model) return null;
      const created = useCommentsStore
        .getState()
        .addComment({
          filePath,
          startLine: range.start,
          endLine: range.end,
          text,
          viewScope: scope,
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
      const liveC: LiveComment = { ...created, decorationId: ids[0]! };
      setLiveComments((prev) => [...prev, liveC]);
      return liveC;
    },
    [filePath, scope, modifiedEditor, monaco],
  );

  const updateText = useCallback((id: string, text: string) => {
    useCommentsStore.getState().updateText(id, text);
  }, []);

  const remove = useCallback(
    (id: string) => {
      const target = liveCommentsRef.current.find((c) => c.id === id);
      useCommentsStore.getState().remove(id);
      const model = modifiedEditor?.getModel();
      if (model && target) model.deltaDecorations([target.decorationId], []);
      setLiveComments((prev) => prev.filter((c) => c.id !== id));
    },
    [modifiedEditor],
  );

  return { liveComments, addComment, updateText, remove };
}
