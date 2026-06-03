import { useCallback, useEffect, useRef, useState } from 'react';
import { DiffEditor as MonacoDiffEditor } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { ITheme as XtermTheme } from 'xterm';
import { X, FileText, WrapText, ChevronDown } from 'lucide-react';
import { defineMonacoThemeFromTerminal, themeNameFor } from './monacoTheme';
import type { EditorView, StoredComment } from './types';
import {
  Popover,
  PopoverAnchor,
  PopoverArrow,
  PopoverContent,
  PopoverTrigger,
} from '../ui/Popover';
import '../../monaco-workers';

const WORDWRAP_KEY = 'diffEditor.wordWrap';

interface EditorPaneProps {
  cwd: string;
  filePath: string;
  view: EditorView;
  activeTaskId: string | null;
  terminalTheme: XtermTheme;
  isDark: boolean;
  /** Full per-file comments map owned by the parent. The CommentsMenu reads
   *  this to render entries across every file; EditorPane derives the
   *  current file's list internally and hydrates decorations from it. */
  commentsByFile: Record<string, StoredComment[]>;
  /** When set, the editor reveals the comment with this id once it lives in
   *  the current file's hydrated decorations, then calls onClearReveal. */
  revealCommentId: string | null;
  onCommentsChange: (filePath: string, comments: StoredComment[]) => void;
  onRemoveComment: (filePath: string, commentId: string) => void;
  onNavigateAcrossFile: (filePath: string, commentId: string) => void;
  onClearReveal: () => void;
  onClose: () => void;
  /** Confirm-before-close (e.g. if the host has unsaved changes elsewhere). */
  guardClose?: () => boolean;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'loaded';
      originalContent: string;
      modifiedContent: string; // initial buffer for the modified side
      mtimeMs: number; // 0 in commit view
      sizeBytes: number; // 0 in commit view
      isBinary: boolean;
      isLargeFile: boolean;
      language: string;
      modifiedPresent: boolean; // false when file is deleted on disk (working view)
    };

interface Comment {
  id: string;
  decorationId: string;
  comment: string;
}

interface StaleInfo {
  currentMtimeMs: number;
  currentSizeBytes: number;
}

export function EditorPane({
  cwd,
  filePath,
  view,
  activeTaskId,
  terminalTheme,
  isDark,
  commentsByFile,
  revealCommentId,
  onCommentsChange,
  onRemoveComment,
  onNavigateAcrossFile,
  onClearReveal,
  onClose,
}: EditorPaneProps) {
  const storedComments = commentsByFile[filePath] ?? [];
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [draft, setDraft] = useState<string>('');
  const [loadedBuffer, setLoadedBuffer] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [savedPill, setSavedPill] = useState(false);
  const [stale, setStale] = useState<StaleInfo | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [pendingRange, setPendingRange] = useState<{ start: number; end: number } | null>(null);
  // When non-empty, the WIP popover opens prefilled with this text. Used by
  // the dbl-click-to-edit flow on a persisted comment widget.
  const [pendingText, setPendingText] = useState<string>('');
  // The id of the comment currently being edited, so the widgets effect can
  // skip rendering it (the WIP popover is taking its place).
  const [editingId, setEditingId] = useState<string | null>(null);
  // True while the user is dragging on the line-number gutter. The popover
  // is hidden during the drag — opening it immediately on mouse-down would
  // steal focus to the textarea and cancel Monaco's drag tracking, so the
  // range could only ever be a single line.
  const [dragging, setDragging] = useState(false);
  const [wordWrap, setWordWrap] = useState<boolean>(
    () => localStorage.getItem(WORDWRAP_KEY) === 'on',
  );

  const editorRef = useRef<monacoEditor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const commentDecorations = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const selectionDecorations = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const dragRef = useRef<{ startLine: number } | null>(null);
  const saveCmdRef = useRef<(() => void) | null>(null);
  const popoverAnchorRef = useRef<HTMLDivElement | null>(null);
  // State (not ref) so the popover's `container` prop sees the actual node
  // after mount — refs alone don't trigger a re-render.
  const [editorAreaEl, setEditorAreaEl] = useState<HTMLDivElement | null>(null);

  const themeName = themeNameFor(isDark);
  const isCommitView = view.kind === 'commit';
  const dirty = !isCommitView && draft !== loadedBuffer;
  const editable =
    !isCommitView &&
    state.kind === 'loaded' &&
    !state.isBinary &&
    !state.isLargeFile &&
    state.modifiedPresent;

  // Holds the most recently loaded file's state so the Monaco editor stays
  // mounted while the next file loads. Without this the editor would unmount
  // every time `state` flips to 'loading', causing a perceptible flash on
  // every file click. Mutating a ref during render is intentional here —
  // `displayed` is always a recent snapshot of `state` and re-reads on every
  // render. `draft` updates atomically with `state` in the load effect, so
  // there's no frame where the editor sees stale `displayed` with a new
  // `draft`.
  const lastLoadedRef = useRef<LoadState>({ kind: 'loading' });
  if (state.kind === 'loaded' || state.kind === 'error') {
    lastLoadedRef.current = state;
  }
  const displayed = lastLoadedRef.current;

  // ── Load file when key changes ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Empty path → no file yet. The orchestrator will fill it in once the
      // file tree loads. Stay on the loading skeleton until then.
      if (!filePath) {
        setState({ kind: 'loading' });
        return;
      }
      setState({ kind: 'loading' });
      if (view.kind === 'working') {
        const resp = await window.electronAPI.editorReadWorking({
          cwd,
          filePath,
          ref: view.ref,
        });
        if (cancelled) return;
        if (!resp.success || !resp.data) {
          setState({ kind: 'error', message: resp.error ?? 'Failed to load file' });
          return;
        }
        const modifiedPresent = resp.data.workingContent !== null;
        const initial = resp.data.workingContent ?? '';
        setState({
          kind: 'loaded',
          originalContent: resp.data.originalContent,
          modifiedContent: initial,
          mtimeMs: resp.data.mtimeMs,
          sizeBytes: resp.data.sizeBytes,
          isBinary: resp.data.isBinary,
          isLargeFile: resp.data.isLargeFile,
          language: resp.data.language,
          modifiedPresent,
        });
        setLoadedBuffer(initial);
        setDraft(initial);
      } else {
        const resp = await window.electronAPI.editorReadCommit({
          cwd,
          filePath,
          hash: view.hash,
        });
        if (cancelled) return;
        if (!resp.success || !resp.data) {
          setState({ kind: 'error', message: resp.error ?? 'Failed to load file' });
          return;
        }
        setState({
          kind: 'loaded',
          originalContent: resp.data.originalContent,
          modifiedContent: resp.data.modifiedContent,
          mtimeMs: 0,
          sizeBytes: 0,
          isBinary: resp.data.isBinary,
          isLargeFile: resp.data.isLargeFile,
          language: resp.data.language,
          modifiedPresent: true,
        });
        setLoadedBuffer(resp.data.modifiedContent);
        setDraft(resp.data.modifiedContent);
      }
      // Comments are cleared here; the hydration effect re-attaches them
      // (with fresh decorations) once the new content is in the model.
      setComments([]);
      setPendingRange(null);
      setStale(null);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [cwd, filePath, view]);

  // ── Comment hydration / snapshot ────────────────────────
  // Decoration ids are tied to a Monaco model and get wiped when the model's
  // content swaps. We persist comments in the parent as line ranges; this
  // block re-creates decorations on the live model after each load and
  // pushes range/text changes back to the parent.
  //
  // Key invariant: hydration must NOT run until the new file's content is
  // in the model. We key the hydration effect on `state` (object identity,
  // not on filePath) — every load produces a new state object via
  // setState(...), and MonacoDiffEditor (a child) has already swapped the
  // model in its own effect by the time our effect fires.
  const hydratedStateRef = useRef<LoadState | null>(null);
  const storedCommentsRef = useRef<StoredComment[]>(storedComments);
  storedCommentsRef.current = storedComments;
  const onCommentsChangeRef = useRef(onCommentsChange);
  onCommentsChangeRef.current = onCommentsChange;
  const commentsRef = useRef<Comment[]>([]);
  commentsRef.current = comments;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  // Snapshot helper: read current decoration ranges + texts and push to the
  // parent for the *current* file. Called explicitly from add/text-edit and
  // from the on-switch cleanup. NOT called from hydration (parent already
  // has that data) and NOT auto-fired on every `comments` change (load's
  // setComments([]) would clobber parent state before re-hydration).
  const pushSnapshotForCurrentFile = useCallback((commentsNow: Comment[]) => {
    const ed = editorRef.current?.getModifiedEditor();
    const model = ed?.getModel();
    if (!ed || !model) return;
    const snapshot: StoredComment[] = commentsNow.flatMap((c) => {
      const r = model.getDecorationRange(c.decorationId);
      if (!r) return [];
      return [
        {
          id: c.id,
          startLine: r.startLineNumber,
          endLine: r.endLineNumber,
          text: c.comment,
        },
      ];
    });
    onCommentsChangeRef.current(filePathRef.current, snapshot);
  }, []);

  useEffect(() => {
    if (state.kind !== 'loaded') return;
    if (hydratedStateRef.current === state) return;
    hydratedStateRef.current = state;

    const ed = editorRef.current?.getModifiedEditor();
    const monaco = monacoRef.current;
    const model = ed?.getModel();
    if (!ed || !monaco || !model) {
      setComments([]);
      return;
    }
    const stored = storedCommentsRef.current;
    if (stored.length === 0) {
      setComments([]);
      return;
    }
    const lineCount = model.getLineCount();
    const hydrated: Comment[] = stored.flatMap((sc) => {
      // Stored ranges from a previous session might fall outside the current
      // content (e.g. file shrunk on disk). Clamp into bounds.
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
      return [{ id: sc.id, decorationId: ids[0], comment: sc.text }];
    });
    setComments(hydrated);
  }, [state]);

  // Reconcile parent-driven removals into the local `comments` state and the
  // Monaco model. The CommentsMenu dropdown removes through the parent (so
  // removals work uniformly for current and other files); the parent's
  // storedComments prop then loses an id, and this effect drops the matching
  // local decoration. Skipped until the current state is hydrated (otherwise
  // the initial empty `storedComments` for a not-yet-loaded file would
  // immediately strip everything).
  useEffect(() => {
    if (hydratedStateRef.current !== state) return;
    const storedIds = new Set(storedComments.map((s) => s.id));
    const remaining: Comment[] = [];
    const removedDecos: string[] = [];
    for (const c of comments) {
      if (storedIds.has(c.id)) remaining.push(c);
      else removedDecos.push(c.decorationId);
    }
    if (removedDecos.length === 0) return;
    const model = editorRef.current?.getModifiedEditor().getModel();
    if (model) model.deltaDecorations(removedDecos, []);
    setComments(remaining);
  }, [storedComments, state, comments]);

  // Capture line shifts from typing before the file changes — those shifts
  // never touch `comments`, so the only chance to record them is right
  // before model.setValue wipes the decorations on the next load.
  useEffect(() => {
    return () => {
      pushSnapshotForCurrentFile(commentsRef.current);
    };
  }, [filePath, pushSnapshotForCurrentFile]);

  // Cross-file navigation from CommentsMenu: when the user clicks a comment
  // that lives in a different file, the parent flips selectedPath + sets
  // revealCommentId. This effect waits for the target id to show up in the
  // current file's hydrated `comments`, then reveals and clears the token.
  useEffect(() => {
    if (!revealCommentId) return;
    const target = comments.find((c) => c.id === revealCommentId);
    if (!target) return;
    const ed = editorRef.current?.getModifiedEditor();
    const monaco = monacoRef.current;
    const model = ed?.getModel();
    if (!ed || !monaco || !model) return;
    const range = model.getDecorationRange(target.decorationId);
    if (!range) return;
    ed.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
    ed.setSelection(range);
    ed.focus();
    onClearReveal();
  }, [revealCommentId, comments, onClearReveal]);

  // ── Re-apply Monaco theme on terminal-theme change ──────
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineMonacoThemeFromTerminal(monaco, themeName, isDark, terminalTheme);
    monaco.editor.setTheme(themeName);
  }, [themeName, isDark, terminalTheme]);

  useEffect(() => {
    localStorage.setItem(WORDWRAP_KEY, wordWrap ? 'on' : 'off');
  }, [wordWrap]);

  // ── Save flow (working view only) ───────────────────────
  const save = useCallback(async () => {
    if (isCommitView || state.kind !== 'loaded') return;
    if (draft === loadedBuffer) return;
    setSaving(true);
    try {
      const resp = await window.electronAPI.editorWriteWorking({
        cwd,
        filePath,
        content: draft,
        expectedMtimeMs: state.mtimeMs,
        expectedSizeBytes: state.sizeBytes,
      });
      if (!resp.success || !resp.data) {
        setStale({ currentMtimeMs: 0, currentSizeBytes: 0 });
        return;
      }
      if (resp.data.ok === false) {
        setStale({
          currentMtimeMs: resp.data.currentMtimeMs,
          currentSizeBytes: resp.data.currentSizeBytes,
        });
        return;
      }
      setLoadedBuffer(draft);
      setState({ ...state, mtimeMs: resp.data.mtimeMs, sizeBytes: resp.data.sizeBytes });
      setStale(null);
      setSavedPill(true);
      window.setTimeout(() => setSavedPill(false), 1000);
    } finally {
      setSaving(false);
    }
  }, [cwd, filePath, draft, loadedBuffer, state, isCommitView]);

  useEffect(() => {
    saveCmdRef.current = () => void save();
  });

  const reloadFromDisk = useCallback(async () => {
    if (isCommitView || view.kind !== 'working') return;
    if (draft !== loadedBuffer) {
      if (!window.confirm('Discard unsaved changes and reload from disk?')) return;
    }
    setStale(null);
    const resp = await window.electronAPI.editorReadWorking({
      cwd,
      filePath,
      ref: view.ref,
    });
    if (!resp.success || !resp.data) return;
    const modifiedPresent = resp.data.workingContent !== null;
    const initial = resp.data.workingContent ?? '';
    setState({
      kind: 'loaded',
      originalContent: resp.data.originalContent,
      modifiedContent: initial,
      mtimeMs: resp.data.mtimeMs,
      sizeBytes: resp.data.sizeBytes,
      isBinary: resp.data.isBinary,
      isLargeFile: resp.data.isLargeFile,
      language: resp.data.language,
      modifiedPresent,
    });
    setLoadedBuffer(initial);
    setDraft(initial);
  }, [cwd, filePath, view, draft, loadedBuffer, isCommitView]);

  const overwrite = useCallback(async () => {
    if (!stale || state.kind !== 'loaded') return;
    setState({ ...state, mtimeMs: stale.currentMtimeMs, sizeBytes: stale.currentSizeBytes });
    setStale(null);
    setTimeout(() => void save(), 0);
  }, [stale, save, state]);

  // ── Editor mount + selection mechanic ──────────────────
  // Define the theme *before* Monaco paints. Without this, Monaco's first
  // frame uses the default vs/vs-dark palette and then snaps to our theme
  // inside handleMount — that's the open/focus flash. `beforeMount` runs
  // after the monaco module loads but before the editor instance is created,
  // so the very first paint already uses the right palette.
  function handleBeforeMount(monaco: typeof import('monaco-editor')) {
    defineMonacoThemeFromTerminal(monaco, themeName, isDark, terminalTheme);
    monaco.editor.setTheme(themeName);
  }

  function handleMount(
    editor: monacoEditor.IStandaloneDiffEditor,
    monaco: typeof import('monaco-editor'),
  ) {
    editorRef.current = editor;
    monacoRef.current = monaco;

    defineMonacoThemeFromTerminal(monaco, themeName, isDark, terminalTheme);
    monaco.editor.setTheme(themeName);

    const modified = editor.getModifiedEditor();

    modified.onDidChangeModelContent(() => {
      if (!isCommitView) setDraft(modified.getValue());
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveCmdRef.current?.();
    });

    modified.onMouseDown((e) => {
      const t = e.target;
      if (
        t.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS &&
        t.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS &&
        t.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
      )
        return;
      const line = t.position?.lineNumber;
      if (!line) return;
      dragRef.current = { startLine: line };
      // Drive the line tint via pendingRange but keep the popover closed
      // (gated on `dragging`) until mouse-up.
      setDragging(true);
      setPendingRange({ start: line, end: line });
    });
    // Track the drag via a window mousemove (not Monaco's onMouseMove): during
    // a gutter drag Monaco's own line-select handler captures pointer events
    // and our editor-level mouse listener may not fire reliably. We resolve
    // the line under the cursor via `getTargetAtClientPoint`.
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const target = modified.getTargetAtClientPoint(e.clientX, e.clientY);
      const line = target?.position?.lineNumber;
      if (!line) return;
      const start = Math.min(dragRef.current.startLine, line);
      const end = Math.max(dragRef.current.startLine, line);
      setPendingRange({ start, end });
    };
    window.addEventListener('mousemove', onMove);
    editor.onDidDispose(() => window.removeEventListener('mousemove', onMove));
    const onUp = () => {
      if (dragRef.current) {
        // Drag complete — release the popover so it can open with the final
        // range.
        setDragging(false);
      }
      dragRef.current = null;
    };
    window.addEventListener('mouseup', onUp);
    editor.onDidDispose(() => window.removeEventListener('mouseup', onUp));
  }

  // Selection highlight
  useEffect(() => {
    const editor = editorRef.current?.getModifiedEditor();
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (!selectionDecorations.current) {
      selectionDecorations.current = editor.createDecorationsCollection();
    }
    if (!pendingRange) {
      selectionDecorations.current.clear();
      return;
    }
    selectionDecorations.current.set([
      {
        range: new monaco.Range(pendingRange.start, 1, pendingRange.end, 1),
        options: {
          isWholeLine: true,
          className: 'monaco-select-line',
          // Tints the line-number gutter for the selected range so the user
          // gets feedback that's distinct from a text selection.
          marginClassName: 'monaco-select-line-margin',
        },
      },
    ]);
  }, [pendingRange]);

  // Position the comment popover's anchor on the right edge of the editor,
  // vertically aligned with the selection's last line. Popover opens to the
  // *left* of this anchor so it sits on the right portion of the editor
  // pane — keeping the highlighted code on the left visible.
  //
  // Radix Popover uses Floating UI's autoUpdate, which listens to scroll on
  // *DOM* scroll-ancestors of the anchor + ResizeObserver on the anchor box.
  // Monaco scrolls internally, so no scroll bubbles up, and changing the
  // anchor's `top` doesn't change its box → no auto-update fires. We toggle
  // the anchor's width by 1px on every position update to force the
  // ResizeObserver to fire, which makes Radix recompute the popover
  // position. Same mechanism keeps the popover tracking the gutter drag.
  //
  // No clamp on top — if the user scrolls the line out of view, the popover
  // scrolls out with it (combined with `avoidCollisions={false}`).
  useEffect(() => {
    const editor = editorRef.current?.getModifiedEditor();
    const anchor = popoverAnchorRef.current;
    if (!editor || !anchor || !pendingRange) return;
    const update = () => {
      const lineTop = editor.getTopForLineNumber(pendingRange.end + 1);
      const scrollTop = editor.getScrollTop();
      anchor.style.top = `${lineTop - scrollTop}px`;
      anchor.style.width = anchor.offsetWidth === 1 ? '2px' : '1px';
    };
    update();
    const sub = editor.onDidScrollChange(update);
    return () => sub.dispose();
  }, [pendingRange]);

  // Comment highlights
  useEffect(() => {
    const editor = editorRef.current?.getModifiedEditor();
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    if (!commentDecorations.current) {
      commentDecorations.current = editor.createDecorationsCollection();
    }
    // Concrete primary color for Monaco's minimap / overview ruler (Monaco
    // can't read CSS vars from inside its canvas renderer).
    const commentMarker = isDark ? '#b8c5e0' : '#3b5078';
    const decos: monacoEditor.IModelDeltaDecoration[] = comments.flatMap((c) => {
      const range = model.getDecorationRange(c.decorationId);
      if (!range) return [];
      return [
        {
          range,
          options: {
            isWholeLine: true,
            className: 'monaco-comment-line',
            minimap: { color: commentMarker, position: monaco.editor.MinimapPosition.Inline },
            overviewRuler: {
              color: commentMarker,
              position: monaco.editor.OverviewRulerLane.Right,
            },
          },
        },
      ];
    });
    commentDecorations.current.set(decos);
  }, [comments, isDark]);

  // Latest editComment handler captured in a ref so the widgets effect
  // doesn't re-create DOM nodes when the handler identity changes.
  const editCommentRef = useRef<(c: Comment) => void>(() => {});
  editCommentRef.current = (c: Comment) => {
    const editor = editorRef.current?.getModifiedEditor();
    const model = editor?.getModel();
    if (!editor || !model) return;
    const range = model.getDecorationRange(c.decorationId);
    if (!range) return;
    setEditingId(c.id);
    setPendingText(c.comment);
    setPendingRange({ start: range.startLineNumber, end: range.endLineNumber });
  };

  // Persistent comment widgets — absolute-positioned divs in the editor
  // area, right-aligned to match the WIP popover's footprint. We can't use
  // Monaco's content-widget API for this: content widgets anchor to a
  // (line, column) text position, so they always sit on the left side and
  // can't be right-aligned to the editor pane. Instead we append our own
  // DOM nodes to the editor area (overflow: hidden) and compute their `top`
  // from Monaco's `getTopForLineNumber` on every scroll. The editor area's
  // `overflow: hidden` clips them at the top/bottom edges.
  useEffect(() => {
    const editor = editorRef.current?.getModifiedEditor();
    const area = editorAreaEl;
    if (!editor || !area) return;
    const model = editor.getModel();
    if (!model) return;

    const visible = comments.filter((c) => c.id !== editingId);
    const nodes = new Map<string, HTMLDivElement>();
    for (const c of visible) {
      const range = model.getDecorationRange(c.decorationId);
      if (!range) continue;
      const node = document.createElement('div');
      node.className = 'monaco-comment-widget';
      node.textContent = c.comment;
      node.addEventListener('dblclick', () => editCommentRef.current(c));
      area.appendChild(node);
      nodes.set(c.id, node);
    }

    const update = () => {
      const scrollTop = editor.getScrollTop();
      for (const c of visible) {
        const node = nodes.get(c.id);
        if (!node) continue;
        const range = model.getDecorationRange(c.decorationId);
        if (!range) continue;
        const lineTop = editor.getTopForLineNumber(range.endLineNumber + 1);
        node.style.top = `${lineTop - scrollTop}px`;
      }
    };
    update();
    const sub = editor.onDidScrollChange(update);
    return () => {
      sub.dispose();
      for (const node of nodes.values()) {
        if (node.parentNode === area) area.removeChild(node);
      }
    };
  }, [comments, editorAreaEl, editingId]);

  function addComment(text: string) {
    // Editing an existing comment — just replace its text. The stickiness
    // decoration already tracks the line range.
    if (editingId) {
      const next = comments.map((c) => (c.id === editingId ? { ...c, comment: text } : c));
      setComments(next);
      pushSnapshotForCurrentFile(next);
      setEditingId(null);
      setPendingText('');
      setPendingRange(null);
      return;
    }
    const editor = editorRef.current?.getModifiedEditor();
    const monaco = monacoRef.current;
    if (!editor || !monaco || !pendingRange) return;
    const model = editor.getModel();
    if (!model) return;
    const ids = model.deltaDecorations(
      [],
      [
        {
          range: new monaco.Range(pendingRange.start, 1, pendingRange.end, 1),
          options: { isWholeLine: true, stickiness: 1 },
        },
      ],
    );
    const decorationId = ids[0];
    const next = [...comments, { id: crypto.randomUUID(), decorationId, comment: text }];
    setComments(next);
    pushSnapshotForCurrentFile(next);
    setPendingText('');
    setPendingRange(null);
  }

  function cancelComment() {
    setEditingId(null);
    setPendingText('');
    setPendingRange(null);
  }

  function navigateToComment(c: Comment) {
    const ed = editorRef.current?.getModifiedEditor();
    const monaco = monacoRef.current;
    const model = ed?.getModel();
    if (!ed || !monaco || !model) return;
    const range = model.getDecorationRange(c.decorationId);
    if (!range) return;
    ed.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
    ed.setSelection(range);
    ed.focus();
  }

  function buildPromptAndSend() {
    if (!activeTaskId) return;
    const totalCount = Object.values(commentsByFile).reduce((n, l) => n + l.length, 0);
    if (totalCount === 0) return;

    const editor = editorRef.current?.getModifiedEditor();
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    const lang = state.kind === 'loaded' ? state.language : '';

    // Sort: current file first, then alphabetical.
    const fileGroups = Object.entries(commentsByFile)
      .filter(([, list]) => list.length > 0)
      .sort(([a], [b]) => {
        if (a === filePath) return -1;
        if (b === filePath) return 1;
        return a.localeCompare(b);
      });

    const blocks = fileGroups.map(([path, list]) => {
      const isCurrent = path === filePath;
      const sections = list.map((sc) => {
        let startLine = sc.startLine;
        let endLine = sc.endLine;
        // For the current file, prefer live decoration ranges (line shifts
        // from typing) and embed a code excerpt.
        if (isCurrent && editor && monaco && model) {
          const live = comments.find((c) => c.id === sc.id);
          if (live) {
            const r = model.getDecorationRange(live.decorationId);
            if (r) {
              startLine = r.startLineNumber;
              endLine = r.endLineNumber;
            }
          }
          const lineLabel =
            startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
          const code = model.getValueInRange(
            new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
          );
          return `${lineLabel}:\n\`\`\`${lang}\n${code}\n\`\`\`\n${sc.text}`;
        }
        const lineLabel =
          startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
        return `${lineLabel}:\n${sc.text}`;
      });
      return `### ${path}\n\n${sections.join('\n\n---\n\n')}`;
    });

    const prompt = `Comments:\n\n${blocks.join('\n\n')}`;
    void import('../../terminal/SessionRegistry').then(({ sessionRegistry }) => {
      const session = sessionRegistry.get(activeTaskId);
      if (session) session.writeInput(prompt);
    });
    onClose();
  }

  function handleClose() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  return (
    <div className="h-full flex flex-col min-w-0 min-h-0">
      <div
        className="flex items-center justify-between px-3 h-9 border-b border-white/[0.06] flex-shrink-0"
        style={{ background: terminalTheme.background ?? (isDark ? '#0d0d11' : '#faf8f3') }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <FileText
            size={14}
            className="text-muted-foreground/50 flex-shrink-0"
            strokeWidth={1.8}
          />
          <span className="text-[13px] font-medium text-foreground truncate">{filePath}</span>
          {isCommitView && (
            <span className="text-[11px] tabular-nums text-muted-foreground/50 font-mono">
              {view.hash.slice(0, 7)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {Object.values(commentsByFile).some((list) => list.length > 0) && (
            <CommentsMenu
              commentsByFile={commentsByFile}
              currentFilePath={filePath}
              // For the current file we pull line ranges live from the model
              // (so typed line shifts reflect immediately); other files fall
              // back to their stored line numbers.
              getLiveRangeForCurrent={(commentId) => {
                const target = comments.find((c) => c.id === commentId);
                if (!target) return null;
                const model = editorRef.current?.getModifiedEditor().getModel();
                const r = model?.getDecorationRange(target.decorationId);
                return r ? { start: r.startLineNumber, end: r.endLineNumber } : null;
              }}
              onNavigate={(targetPath, commentId) => {
                if (targetPath === filePath) {
                  const target = comments.find((c) => c.id === commentId);
                  if (target) navigateToComment(target);
                } else {
                  onNavigateAcrossFile(targetPath, commentId);
                }
              }}
              onRemove={onRemoveComment}
              onSend={buildPromptAndSend}
            />
          )}
          <button
            onClick={() => setWordWrap((w) => !w)}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            className={`p-1.5 rounded-md transition-colors ${
              wordWrap
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground/60 hover:text-foreground hover:bg-accent/60'
            }`}
          >
            <WrapText size={14} strokeWidth={1.8} />
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {stale && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-amber-500/40 bg-amber-500/10 text-[11px] flex-shrink-0">
          <span className="text-amber-700 dark:text-amber-300">
            This file changed on disk since you opened it.
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={() => void overwrite()}
              className="px-2 py-1 rounded-md text-[11px] bg-destructive/15 text-destructive hover:bg-destructive/25"
            >
              Overwrite
            </button>
            <button
              onClick={() => void reloadFromDisk()}
              className="px-2 py-1 rounded-md text-[11px] bg-accent hover:bg-accent/80"
            >
              Reload from disk
            </button>
            <button
              onClick={() => setStale(null)}
              className="px-2 py-1 rounded-md text-[11px] text-muted-foreground/60 hover:text-foreground hover:bg-accent/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div ref={setEditorAreaEl} className="flex-1 relative overflow-hidden">
        {/* Initial open with nothing loaded yet — show the full spinner. */}
        {state.kind === 'loading' && displayed.kind !== 'loaded' && (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span className="text-[13px] text-muted-foreground/50">Loading…</span>
            </div>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="flex items-center justify-center h-full">
            <span className="text-[13px] text-destructive">{state.message}</span>
          </div>
        )}
        {displayed.kind === 'loaded' && displayed.isBinary && (
          <div className="flex items-center justify-center h-full">
            <span className="text-[13px] text-muted-foreground/40">
              Binary file — cannot display diff
            </span>
          </div>
        )}
        {displayed.kind === 'loaded' && displayed.isLargeFile && (
          <div className="flex items-center justify-center h-full">
            <span className="text-[13px] text-muted-foreground/40">
              File too large to preview here (&gt;5 MB).
            </span>
          </div>
        )}
        {displayed.kind === 'loaded' && !displayed.isBinary && !displayed.isLargeFile && (
          <MonacoDiffEditor
            beforeMount={handleBeforeMount}
            original={displayed.originalContent}
            modified={isCommitView ? displayed.modifiedContent : draft}
            language={displayed.language || undefined}
            theme={themeName}
            options={{
              originalEditable: false,
              readOnly: !editable,
              renderSideBySide: false,
              // Inline mode renders the original sub-editor as a leading
              // gutter column (Monaco's `originalWidth = layoutInfoDecorationsLeft`
              // in diffEditorWidget.js). compactMode → inlineViewHideOriginalLineNumbers
              // collapses that column to 0 and lets the modified gutter sit
              // flush against the left edge.
              compactMode: true,
              // Disables the 35px-wide hunk-toolbar column (DiffEditorGutter,
              // gutterFeature.js — width=35 whenever the toolbar menu has any
              // actions). Without this, the modified editor starts 35px in.
              renderGutterMenu: false,
              // Slim color-block minimap (no characters, narrow column).
              // Doubles as the scrollbar — the in-editor vertical scrollbar
              // is hidden below.
              minimap: {
                enabled: true,
                renderCharacters: false,
                maxColumn: 60,
                showSlider: 'mouseover',
                size: 'fit',
              },
              automaticLayout: true,
              fontSize: 12,
              lineNumbers: 'on',
              glyphMargin: false,
              // Min 1 char so the column hugs the actual digit count
              // (Monaco rounds up to fit the largest line number anyway).
              lineNumbersMinChars: 1,
              lineDecorationsWidth: 20,
              scrollBeyondLastLine: false,
              wordWrap: wordWrap ? 'on' : 'off',
              overviewRulerBorder: false,
              overviewRulerLanes: 0,
              scrollbar: { vertical: 'hidden', verticalScrollbarSize: 0 },
              // Active indent guide stays visible even when the editor isn't
              // focused; the CSS rule above hides the rest.
              guides: { highlightActiveIndentation: 'always' },
            }}
            onMount={handleMount}
          />
        )}
        {editable && (dirty || saving || savedPill) && (
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            className={`absolute bottom-4 right-16 z-10 px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary/70 text-primary-foreground hover:bg-primary/85 disabled:cursor-default backdrop-blur-sm shadow-lg shadow-black/30 transition-opacity ${savedPill ? 'animate-save-flash' : ''}`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {/* Subtle loading pill that appears in the top-right while the next
            file loads, instead of replacing the editor with a centered
            spinner (which is what caused the flash). */}
        {state.kind === 'loading' && displayed.kind === 'loaded' && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[hsl(var(--surface-2)/0.85)] backdrop-blur-sm shadow-sm">
            <div className="w-2.5 h-2.5 border-[1.5px] border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-[10px] text-muted-foreground/70">Loading</span>
          </div>
        )}
        <Popover
          open={!!pendingRange && !dragging}
          onOpenChange={(o) => {
            if (!o) cancelComment();
          }}
        >
          <PopoverAnchor asChild>
            <div
              ref={popoverAnchorRef}
              style={{
                position: 'absolute',
                right: 16,
                top: 0,
                width: 1,
                height: 1,
                pointerEvents: 'none',
              }}
            />
          </PopoverAnchor>
          <PopoverContent
            side="left"
            align="start"
            sideOffset={4}
            avoidCollisions={false}
            onInteractOutside={(e) => e.preventDefault()}
            container={editorAreaEl}
            className="w-[380px] h-[240px] p-3.5 flex flex-col gap-2.5 backdrop-blur-md"
            style={{
              // surface-2 sits one step away from the theme background —
              // a touch lighter in dark mode, a touch darker in light mode.
              // Low alpha lets the code behind bleed through.
              background: 'hsl(var(--surface-2) / 0.55)',
              color: 'hsl(var(--popover-foreground))',
            }}
          >
            <CommentInputBar
              lineRange={pendingRange}
              initialText={pendingText}
              onSubmit={addComment}
              onCancel={cancelComment}
            />
            <PopoverArrow />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

// ── Comments dropdown ──────────────────────────────────────

function CommentsMenu({
  commentsByFile,
  currentFilePath,
  getLiveRangeForCurrent,
  onNavigate,
  onRemove,
  onSend,
}: {
  commentsByFile: Record<string, StoredComment[]>;
  currentFilePath: string;
  /** Returns the current model's live range for the given comment id, or
   *  null if the comment isn't in the current file. Lets the dropdown show
   *  up-to-the-second line numbers for the open file (which may have
   *  shifted due to typing) while non-current files fall back to stored. */
  getLiveRangeForCurrent: (commentId: string) => { start: number; end: number } | null;
  onNavigate: (filePath: string, commentId: string) => void;
  onRemove: (filePath: string, commentId: string) => void;
  onSend: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Stable order: current file first, then the rest alphabetically.
  const groups = Object.entries(commentsByFile)
    .filter(([, list]) => list.length > 0)
    .sort(([a], [b]) => {
      if (a === currentFilePath) return -1;
      if (b === currentFilePath) return 1;
      return a.localeCompare(b);
    });
  const totalCount = groups.reduce((sum, [, list]) => sum + list.length, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-full text-[11px] font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-all duration-150">
          <span>
            {totalCount} comment{totalCount !== 1 ? 's' : ''}
          </span>
          <ChevronDown size={12} strokeWidth={2} className="opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-[420px] max-h-[460px] flex flex-col p-0"
      >
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
          {groups.map(([path, list]) => (
            <div key={path} className="mb-1.5 last:mb-0">
              <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono flex items-center gap-1.5">
                <span className="truncate">{path}</span>
                {path === currentFilePath && (
                  <span className="text-[9px] text-primary/80 normal-case tracking-normal flex-shrink-0">
                    · current
                  </span>
                )}
              </div>
              {list.map((c) => {
                const live = path === currentFilePath ? getLiveRangeForCurrent(c.id) : null;
                const start = live?.start ?? c.startLine;
                const end = live?.end ?? c.endLine;
                const lineLabel = start === end ? `L${start}` : `L${start}–${end}`;
                return (
                  <div
                    key={c.id}
                    className="group relative flex flex-col rounded-md hover:bg-[hsl(var(--surface-2)/0.6)] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onNavigate(path, c.id);
                      }}
                      title="Jump to this comment"
                      className="flex flex-col gap-1 px-2.5 py-2 text-left w-full rounded-md"
                    >
                      <span className="font-mono text-[10.5px] text-muted-foreground/70 truncate">
                        {lineLabel}
                      </span>
                      <span className="text-[12px] text-foreground/85 leading-relaxed whitespace-pre-wrap">
                        {c.text}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(path, c.id)}
                      aria-label="Remove comment"
                      className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition"
                    >
                      <X size={11} strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border/40">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSend();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition"
          >
            Add {totalCount} comment{totalCount !== 1 ? 's' : ''} to prompt
          </button>
        </div>
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  );
}

// ── Inline comment input ───────────────────────────────────

function CommentInputBar({
  lineRange,
  initialText,
  onSubmit,
  onCancel,
}: {
  lineRange: { start: number; end: number } | null;
  initialText: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const submit = () => {
    if (text.trim()) onSubmit(text.trim());
  };
  const rangeLabel = lineRange
    ? lineRange.start === lineRange.end
      ? `Line ${lineRange.start}`
      : `Lines ${lineRange.start}–${lineRange.end}`
    : '';
  return (
    <>
      <div className="flex-shrink-0 font-mono text-[10px] text-muted-foreground/70 tabular-nums">
        {rangeLabel}
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Stop ALL keys (incl. Escape) from bubbling to the surrounding
          // Modal — the popover handles its own dismiss via onCancel.
          e.stopPropagation();
          if (e.key === 'Enter' && e.metaKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Describe the change…"
        className="flex-1 min-h-0 w-full text-[12.5px] leading-relaxed bg-transparent px-0 py-0 resize-none placeholder:text-muted-foreground/40 focus:outline-none"
      />
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[10.5px] text-muted-foreground/70 font-mono">
          <kbd className="px-1.5 py-0.5 rounded border border-border/60 bg-foreground/5 text-foreground/70">
            ⌘
          </kbd>
          <kbd className="px-1.5 py-0.5 rounded border border-border/60 bg-foreground/5 text-foreground/70 ml-1">
            ↵
          </kbd>
          <span className="ml-1.5">to add</span>
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="ml-auto flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-md text-[11.5px] font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
    </>
  );
}
