import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { ITheme as XtermTheme } from 'xterm';
import type { EditorView } from './types';
import type { LiveComment } from './comments/types';
import { useCommentsContext } from './comments/CommentsContext';
import { useGutterSelection } from './comments/useGutterSelection';
import { useFileCommentsBinding } from './comments/useFileCommentsBinding';
import { CommentsMenu } from './comments/CommentsMenu';
import { CommentInputBar } from './comments/CommentInputBar';
import { useFileLoad, type LoadState } from './editor/useFileLoad';
import { useEditorSave } from './editor/useEditorSave';
import { useMonacoEditor } from './editor/useMonacoEditor';
import { EditorHeader } from './editor/EditorHeader';
import { EditorViewport } from './editor/EditorViewport';
import { LoadingPill } from './editor/LoadingPill';
import { StaleBanner } from './editor/StaleBanner';
import { Popover, PopoverAnchor, PopoverArrow, PopoverContent } from '../ui/Popover';
import '../../monaco-workers';

const WORDWRAP_KEY = 'diffEditor.wordWrap';

interface EditorPaneProps {
  cwd: string;
  filePath: string;
  view: EditorView;
  activeTaskId: string | null;
  terminalTheme: XtermTheme;
  isDark: boolean;
  /** When set, the editor reveals the comment with this id once it lives in
   *  the current file's hydrated decorations, then calls onClearReveal. */
  revealCommentId: string | null;
  onNavigateAcrossFile: (filePath: string, commentId: string) => void;
  onClearReveal: () => void;
  onClose: () => void;
  /** Confirm-before-close (e.g. if the host has unsaved changes elsewhere). */
  guardClose?: () => boolean;
}

export function EditorPane({
  cwd,
  filePath,
  view,
  activeTaskId,
  terminalTheme,
  isDark,
  revealCommentId,
  onNavigateAcrossFile,
  onClearReveal,
  onClose,
}: EditorPaneProps) {
  const commentsStore = useCommentsContext();
  const commentsByFile = commentsStore.state.byFile;
  const { state, setState } = useFileLoad(cwd, filePath, view);
  const [draft, setDraft] = useState<string>('');
  const [loadedBuffer, setLoadedBuffer] = useState<string>('');
  // When non-empty, the WIP popover opens prefilled with this text. Used by
  // the dbl-click-to-edit flow on a persisted comment widget.
  const [pendingText, setPendingText] = useState<string>('');
  // The id of the comment currently being edited, so the widgets effect can
  // skip rendering it (the WIP popover is taking its place).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [wordWrap, setWordWrap] = useState<boolean>(
    () => localStorage.getItem(WORDWRAP_KEY) === 'on',
  );

  const commentDecorations = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const selectionDecorations = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const saveCmdRef = useRef<(() => void) | null>(null);
  const popoverAnchorRef = useRef<HTMLDivElement | null>(null);
  // State (not ref) so the popover's `container` prop sees the actual node
  // after mount — refs alone don't trigger a re-render.
  const [editorAreaEl, setEditorAreaEl] = useState<HTMLDivElement | null>(null);

  const isCommitView = view.kind === 'commit';

  const { editor, monaco, themeName, displayed, handleBeforeMount, handleMount } = useMonacoEditor({
    isDark,
    terminalTheme,
    state,
    onSave: () => saveCmdRef.current?.(),
    onDraftChange: setDraft,
    isCommitView,
  });
  const modifiedEditor = editor?.getModifiedEditor() ?? null;

  // Mutate the load state in-place for save mtime/size updates and reload.
  // useFileLoad owns the state; this just exposes a targeted patch.
  const patchLoadedState = useCallback(
    (next: Partial<Extract<LoadState, { kind: 'loaded' }>>) => {
      setState((prev) => (prev.kind === 'loaded' ? { ...prev, ...next } : prev));
    },
    [setState],
  );

  const saveApi = useEditorSave({
    cwd,
    filePath,
    workingRef: view.kind === 'working' ? view.ref : 'HEAD',
    state,
    draft,
    loadedBuffer,
    setLoadedBuffer,
    setDraft,
    patchLoadedState,
    isCommitView,
  });
  const { saving, savedPill, stale, setStale, save, overwrite, reloadFromDisk } = saveApi;

  const { pendingRange, setPendingRange, dragging } = useGutterSelection(
    modifiedEditor,
    monaco,
    !commentsStore.disabled,
  );
  const dirty = !isCommitView && draft !== loadedBuffer;
  const editable =
    !isCommitView &&
    state.kind === 'loaded' &&
    !state.isBinary &&
    !state.isLargeFile &&
    state.modifiedPresent;

  // Initialize the editable buffer + saved buffer whenever a new file's
  // content loads. Comment lifecycle / pending range / stale flag are
  // owned by their respective hooks; only the draft/loadedBuffer mirror
  // lives here because the save hook owns them by reference.
  useEffect(() => {
    if (state.kind !== 'loaded') return;
    const initial = state.modifiedContent;
    setLoadedBuffer(initial);
    setDraft(initial);
    setPendingRange(null);
    setStale(null);
  }, [state, setPendingRange]);

  // ── Comments binding ────────────────────────────────────
  // Owns Monaco decoration lifecycle for the current filePath. Hydration
  // and snapshot are both scoped via closure inside the hook, which kills
  // the previous file-ref-races (the source of the phantom-comment bug).
  const isFileLoaded = state.kind === 'loaded';
  const binding = useFileCommentsBinding({
    filePath,
    isFileLoaded,
    editor,
    monaco,
  });
  const liveComments = binding.liveComments;

  // Scroll to a live comment + select + focus. Shared by the cross-file
  // reveal effect and the same-file dropdown navigation. Returns true on a
  // successful jump so callers can clear handoff tokens conditionally.
  const revealLive = useCallback(
    (c: LiveComment): boolean => {
      if (!modifiedEditor || !monaco) return false;
      const model = modifiedEditor.getModel();
      if (!model) return false;
      const range = model.getDecorationRange(c.decorationId);
      if (!range) return false;
      modifiedEditor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
      modifiedEditor.setSelection(range);
      modifiedEditor.focus();
      return true;
    },
    [modifiedEditor, monaco],
  );

  // Cross-file navigation from CommentsMenu: when the user clicks a comment
  // that lives in a different file, the parent flips selectedPath + sets
  // revealCommentId. This effect waits for the target id to show up in the
  // current file's hydrated `comments`, then reveals and clears the token.
  useEffect(() => {
    if (!revealCommentId) return;
    const target = liveComments.find((c) => c.id === revealCommentId);
    if (!target) return;
    if (revealLive(target)) onClearReveal();
  }, [revealCommentId, liveComments, revealLive, onClearReveal]);

  useEffect(() => {
    localStorage.setItem(WORDWRAP_KEY, wordWrap ? 'on' : 'off');
  }, [wordWrap]);

  // Bridge useEditorSave → useMonacoEditor's ⌘S binding. The hook fires
  // saveCmdRef.current() from the keybinding; we keep this ref pointed at
  // the latest save callback so it never goes stale on re-render.
  useEffect(() => {
    saveCmdRef.current = () => void save();
  });

  // Selection highlight
  useEffect(() => {
    if (!modifiedEditor || !monaco) return;
    if (!selectionDecorations.current) {
      selectionDecorations.current = modifiedEditor.createDecorationsCollection();
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
  }, [pendingRange, modifiedEditor, monaco]);

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
    const anchor = popoverAnchorRef.current;
    if (!modifiedEditor || !anchor || !pendingRange) return;
    const update = () => {
      const lineTop = modifiedEditor.getTopForLineNumber(pendingRange.end + 1);
      const scrollTop = modifiedEditor.getScrollTop();
      anchor.style.top = `${lineTop - scrollTop}px`;
      anchor.style.width = anchor.offsetWidth === 1 ? '2px' : '1px';
    };
    update();
    const sub = modifiedEditor.onDidScrollChange(update);
    return () => sub.dispose();
  }, [pendingRange, modifiedEditor]);

  // Comment highlights
  useEffect(() => {
    if (!modifiedEditor || !monaco) return;
    const model = modifiedEditor.getModel();
    if (!model) return;
    if (!commentDecorations.current) {
      commentDecorations.current = modifiedEditor.createDecorationsCollection();
    }
    if (commentsStore.disabled) {
      commentDecorations.current.clear();
      return;
    }
    // Concrete primary color for Monaco's minimap / overview ruler (Monaco
    // can't read CSS vars from inside its canvas renderer).
    const commentMarker = isDark ? '#b8c5e0' : '#3b5078';
    const decos: monacoEditor.IModelDeltaDecoration[] = liveComments.flatMap((c) => {
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
  }, [liveComments, isDark, commentsStore.disabled, modifiedEditor, monaco]);

  // Latest editComment handler captured in a ref so the widgets effect
  // doesn't re-create DOM nodes when the handler identity changes.
  const editCommentRef = useRef<(c: LiveComment) => void>(() => {});
  editCommentRef.current = (c: LiveComment) => {
    const model = modifiedEditor?.getModel();
    if (!model) return;
    const range = model.getDecorationRange(c.decorationId);
    if (!range) return;
    setEditingId(c.id);
    setPendingText(c.text);
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
    const area = editorAreaEl;
    if (!modifiedEditor || !area) return;
    const model = modifiedEditor.getModel();
    if (!model) return;
    if (commentsStore.disabled) return;

    const visible = liveComments.filter((c) => c.id !== editingId);
    const nodes = new Map<string, HTMLDivElement>();
    for (const c of visible) {
      const range = model.getDecorationRange(c.decorationId);
      if (!range) continue;
      const node = document.createElement('div');
      node.className = 'monaco-comment-widget';
      node.textContent = c.text;
      node.addEventListener('dblclick', () => editCommentRef.current(c));
      area.appendChild(node);
      nodes.set(c.id, node);
    }

    const update = () => {
      const scrollTop = modifiedEditor.getScrollTop();
      for (const c of visible) {
        const node = nodes.get(c.id);
        if (!node) continue;
        const range = model.getDecorationRange(c.decorationId);
        if (!range) continue;
        const lineTop = modifiedEditor.getTopForLineNumber(range.endLineNumber + 1);
        node.style.top = `${lineTop - scrollTop}px`;
      }
    };
    update();
    const sub = modifiedEditor.onDidScrollChange(update);
    return () => {
      sub.dispose();
      for (const node of nodes.values()) {
        if (node.parentNode === area) area.removeChild(node);
      }
    };
  }, [liveComments, editorAreaEl, editingId, commentsStore.disabled, modifiedEditor]);

  function addComment(text: string) {
    if (editingId) {
      binding.updateText(editingId, text);
      setEditingId(null);
      setPendingText('');
      setPendingRange(null);
      return;
    }
    if (!pendingRange) return;
    binding.addComment(pendingRange, text);
    setPendingText('');
    setPendingRange(null);
  }

  function cancelComment() {
    setEditingId(null);
    setPendingText('');
    setPendingRange(null);
  }

  function buildPromptAndSend() {
    if (!activeTaskId) return;
    const model = modifiedEditor?.getModel();
    const lang = state.kind === 'loaded' ? state.language : '';

    // Only unsent comments contribute to the next prompt. Sent ones are
    // archived state — the user has to explicitly un-send (or delete) to
    // re-include them.
    const fileGroups = Object.entries(commentsByFile)
      .map(([path, list]) => [path, list.filter((c) => !c.sent)] as const)
      .filter(([, list]) => list.length > 0)
      .sort(([a], [b]) => {
        if (a === filePath) return -1;
        if (b === filePath) return 1;
        return a.localeCompare(b);
      });
    const totalCount = fileGroups.reduce((n, [, l]) => n + l.length, 0);
    if (totalCount === 0) return;

    const blocks = fileGroups.map(([path, list]) => {
      const isCurrent = path === filePath;
      const sections = list.map((sc) => {
        let startLine = sc.startLine;
        let endLine = sc.endLine;
        // For the current file, prefer live decoration ranges (line shifts
        // from typing) and embed a code excerpt.
        if (isCurrent && modifiedEditor && monaco && model) {
          const live = liveComments.find((c) => c.id === sc.id);
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
    // Flip the bundled ids to `sent` so they're excluded from the next
    // round by default; the user can un-send to re-include.
    const idsToMark = fileGroups.flatMap(([, list]) => list.map((c) => c.id));
    commentsStore.markSent(idsToMark);
    onClose();
  }

  function handleClose() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  const hasAnyComments = useMemo(
    () => Object.values(commentsByFile).some((list) => list.length > 0),
    [commentsByFile],
  );

  const commentsSlot =
    !commentsStore.disabled && hasAnyComments ? (
      <CommentsMenu
        commentsByFile={commentsByFile}
        currentFilePath={filePath}
        // For the current file we pull line ranges live from the model
        // (so typed line shifts reflect immediately); other files fall
        // back to their stored line numbers.
        getLiveRangeForCurrent={(commentId) => {
          const target = liveComments.find((c) => c.id === commentId);
          if (!target) return null;
          const model = modifiedEditor?.getModel();
          const r = model?.getDecorationRange(target.decorationId);
          return r ? { start: r.startLineNumber, end: r.endLineNumber } : null;
        }}
        onNavigate={(targetPath, commentId) => {
          if (targetPath === filePath) {
            const target = liveComments.find((c) => c.id === commentId);
            if (target) revealLive(target);
          } else {
            onNavigateAcrossFile(targetPath, commentId);
          }
        }}
        onRemove={(_path, id) => commentsStore.remove(id)}
        onUnsend={commentsStore.markUnsent}
        onSend={buildPromptAndSend}
      />
    ) : null;

  return (
    <div className="h-full flex flex-col min-w-0 min-h-0">
      <EditorHeader
        filePath={filePath}
        view={view}
        wordWrap={wordWrap}
        onToggleWordWrap={() => setWordWrap((w) => !w)}
        onClose={handleClose}
        backgroundColor={terminalTheme.background ?? (isDark ? '#0d0d11' : '#faf8f3')}
        commentsSlot={commentsSlot}
      />

      {stale && (
        <StaleBanner
          onOverwrite={() => void overwrite()}
          onReload={() => void reloadFromDisk()}
          onCancel={() => setStale(null)}
        />
      )}

      <EditorViewport
        displayed={displayed}
        currentState={state}
        isCommitView={isCommitView}
        draft={draft}
        editable={editable}
        themeName={themeName}
        wordWrap={wordWrap}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        areaRef={setEditorAreaEl}
      >
        {editable && (dirty || saving || savedPill) && (
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            className={`absolute bottom-4 right-16 z-10 px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary/70 text-primary-foreground hover:bg-primary/85 disabled:cursor-default backdrop-blur-sm shadow-lg shadow-black/30 transition-opacity ${savedPill ? 'animate-save-flash' : ''}`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {state.kind === 'loading' && displayed.kind === 'loaded' && <LoadingPill />}
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
      </EditorViewport>
    </div>
  );
}
