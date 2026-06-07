import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { ITheme as XtermTheme } from 'xterm';
import type { EditorView } from './types';
import type { LiveComment } from './comments/types';
import { useCommentsContext } from './comments/CommentsContext';
import { useGutterSelection } from './comments/useGutterSelection';
import { useFileCommentsBinding } from './comments/useFileCommentsBinding';
import { assignShades } from './comments/shadeAssignment';
import { computeRowDecorations } from './comments/rowShades';
import { CommentOverlay } from './comments/CommentOverlay';
import { CommentsMenu } from './comments/CommentsMenu';
import { EditCommentsModal } from './comments/EditCommentsModal';
import { useFileLoad, type LoadState } from './editor/useFileLoad';
import { useEditorSave } from './editor/useEditorSave';
import { useMonacoEditor } from './editor/useMonacoEditor';
import { EditorHeader } from './editor/EditorHeader';
import { EditorViewport } from './editor/EditorViewport';
import { LoadingPill } from './editor/LoadingPill';
import { StaleBanner } from './editor/StaleBanner';
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
  // Fade-on-file-change. Bumped only after the new file's content has
  // actually swapped into the editor — earlier than that and the user
  // sees the OLD content fade in, which feels wrong.
  const pendingFileFadeRef = useRef(false);
  const [fileFadeNonce, setFileFadeNonce] = useState(0);
  // State (not ref) so the popover's `container` prop sees the actual node
  // after mount — refs alone don't trigger a re-render.
  const [editorAreaEl, setEditorAreaEl] = useState<HTMLDivElement | null>(null);
  // Lifted out of CommentOverlay so the band-rendering effect can also
  // intensify the rows owned by the hovered comment (bidirectional
  // hover-highlight).
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);

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

  // Mark a fade as pending whenever the user switches files. We don't run
  // it here — we wait for the new content to actually load (below) so the
  // fade-in coincides with the visual swap, not the click.
  useEffect(() => {
    pendingFileFadeRef.current = true;
  }, [filePath]);

  // Fire the fade once `loaded` arrives for the pending file change.
  useEffect(() => {
    if (state.kind !== 'loaded') return;
    if (!pendingFileFadeRef.current) return;
    pendingFileFadeRef.current = false;
    setFileFadeNonce((n) => n + 1);
  }, [state]);

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

  // Shade-aware band rendering. Each row gets one of three classNames
  // depending on which comments claim it. Coalesced runs of same-signature
  // rows become single decoration ranges for efficiency. The minimap +
  // overview ruler still get the band marker, using primary as the
  // representative color (Monaco's canvas can't read CSS vars, so picking
  // one shade is the right call there).
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
    const commentMarker = isDark ? '#b8c5e0' : '#3b5078';
    // Project liveComments → with their LIVE range from each decoration
    // (so typing-induced shifts feed the row-shade calc).
    const projected = liveComments.flatMap((c) => {
      const r = model.getDecorationRange(c.decorationId);
      if (!r) return [];
      return [{ ...c, startLine: r.startLineNumber, endLine: r.endLineNumber }];
    });
    if (projected.length === 0) {
      commentDecorations.current.clear();
      return;
    }
    const shades = assignShades(projected);
    const rows = computeRowDecorations(projected, shades);
    // Build the highlighted-line set from the hovered comment, if any.
    // A coalesced run is entirely-in or entirely-out of this set because
    // each run covers lines that share the exact same signature, and the
    // hovered comment is a single signature contributor.
    const highlightedLines = new Set<number>();
    if (hoveredCommentId) {
      const hovered = projected.find((c) => c.id === hoveredCommentId);
      if (hovered) {
        for (let l = hovered.startLine; l <= hovered.endLine; l++) {
          highlightedLines.add(l);
        }
      }
    }
    const decos: monacoEditor.IModelDeltaDecoration[] = rows.map((r) => {
      const hi = highlightedLines.has(r.startLine);
      const cls = `monaco-comment-line-shade-${r.signature}${hi ? '-hi' : ''}`;
      return {
        range: new monaco.Range(r.startLine, 1, r.endLine, 1),
        options: {
          isWholeLine: true,
          className: cls,
          lineNumberClassName: `monaco-comment-ln-shade-${r.signature}`,
          minimap: { color: commentMarker, position: monaco.editor.MinimapPosition.Inline },
          overviewRuler: {
            color: commentMarker,
            position: monaco.editor.OverviewRulerLane.Right,
          },
        },
      };
    });
    commentDecorations.current.set(decos);
  }, [liveComments, isDark, commentsStore.disabled, modifiedEditor, monaco, hoveredCommentId]);

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

  // ── Prompt assembly ────────────────────────────────────
  // buildPromptText turns a set of comment ids into the path:line: prompt
  // body. writePromptToTui takes the (potentially edited) text and ships it
  // to the task, marking the original ids as sent so they don't sneak back
  // into the next bulk send. They're split so the edit-before-send modal
  // can build once, let the user mutate the text, then ship the result.
  function buildPromptText(idsToSend: ReadonlyArray<string>): string | null {
    if (idsToSend.length === 0) return null;
    const idSet = new Set(idsToSend);
    const model = modifiedEditor?.getModel();
    const lang = state.kind === 'loaded' ? state.language : '';

    const fileGroups = Object.entries(commentsByFile)
      .map(([path, list]) => [path, list.filter((c) => idSet.has(c.id))] as const)
      .filter(([, list]) => list.length > 0)
      .sort(([a], [b]) => {
        if (a === filePath) return -1;
        if (b === filePath) return 1;
        return a.localeCompare(b);
      });
    if (fileGroups.length === 0) return null;

    const sections: string[] = [];
    for (const [path, list] of fileGroups) {
      const isCurrent = path === filePath;
      for (const sc of list) {
        let startLine = sc.startLine;
        let endLine = sc.endLine;
        let code = '';
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
          code = model.getValueInRange(
            new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
          );
        }
        const lineRef = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
        const header = `${path}:${lineRef}:`;
        sections.push(
          code ? `${header}\n\`\`\`${lang}\n${code}\n\`\`\`\n${sc.text}` : `${header}\n${sc.text}`,
        );
      }
    }
    return `Comments:\n\n${sections.join('\n\n')}`;
  }

  function writePromptToTui(text: string, idsToMarkSent: ReadonlyArray<string>): void {
    if (!activeTaskId) return;
    const taskId = activeTaskId;
    void import('../../terminal/SessionRegistry').then(({ sessionRegistry }) => {
      const session = sessionRegistry.get(taskId);
      if (session) session.writeInput(text);
    });
    commentsStore.markSent(idsToMarkSent);
  }

  function sendCommentsToPrompt(idsToSend: ReadonlyArray<string>): boolean {
    if (!activeTaskId) return false;
    const text = buildPromptText(idsToSend);
    if (text === null) return false;
    writePromptToTui(text, idsToSend);
    return true;
  }

  function collectUnsentIds(): string[] {
    const ids: string[] = [];
    for (const list of Object.values(commentsByFile)) {
      for (const c of list) if (!c.sent) ids.push(c.id);
    }
    return ids;
  }

  function sendAllUnsent() {
    if (sendCommentsToPrompt(collectUnsentIds())) onClose();
  }

  function sendOneComment(id: string) {
    sendCommentsToPrompt([id]);
    // Stay in the modal: the user is browsing the dropdown and likely
    // wants to triage more before leaving.
  }

  // Edit-before-send modal state. The ids snapshot is captured at open time
  // so any edits to the text don't change which comments get marked sent.
  const [editTarget, setEditTarget] = useState<{ ids: string[]; text: string } | null>(null);

  function openEditAndSendModal() {
    if (!activeTaskId) return;
    const ids = collectUnsentIds();
    const text = buildPromptText(ids);
    if (text === null) return;
    setEditTarget({ ids, text });
  }

  function confirmEditAndSend(editedText: string) {
    if (!editTarget) return;
    writePromptToTui(editedText, editTarget.ids);
    setEditTarget(null);
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

  // Used by the React overlay's onDoubleClick → re-opens the WIP popover
  // prefilled with the chosen comment's text + range. Same behavior the
  // legacy widget exposed via dbl-click; lives in EditorPane because it
  // owns editingId / pendingText / pendingRange.
  const editComment = useCallback(
    (c: LiveComment) => {
      const model = modifiedEditor?.getModel();
      if (!model) return;
      const range = model.getDecorationRange(c.decorationId);
      if (!range) return;
      setEditingId(c.id);
      setPendingText(c.text);
      setPendingRange({ start: range.startLineNumber, end: range.endLineNumber });
    },
    [modifiedEditor, setPendingRange],
  );

  const showCommentsMenu = !commentsStore.disabled && hasAnyComments;

  return (
    <div className="h-full flex flex-col min-w-0 min-h-0">
      <EditorHeader
        filePath={filePath}
        view={view}
        wordWrap={wordWrap}
        onToggleWordWrap={() => setWordWrap((w) => !w)}
        onClose={handleClose}
        backgroundColor={terminalTheme.background ?? (isDark ? '#0d0d11' : '#faf8f3')}
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
        fileFadeNonce={fileFadeNonce}
      >
        {editable && (dirty || saving || savedPill) && (
          <button
            onClick={() => void save()}
            disabled={!dirty || saving}
            className={`absolute bottom-16 right-4 z-10 px-3 py-1.5 rounded-md text-[11px] font-medium bg-primary/70 text-primary-foreground hover:bg-primary/85 disabled:cursor-default backdrop-blur-sm shadow-lg shadow-black/30 transition-opacity ${savedPill ? 'animate-save-flash' : ''}`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {showCommentsMenu && (
          <div className="absolute bottom-4 right-4 z-10">
            <CommentsMenu
              commentsByFile={commentsByFile}
              currentFilePath={filePath}
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
              onSend={sendAllUnsent}
              onEditAndSend={openEditAndSendModal}
              onSendOne={sendOneComment}
            />
          </div>
        )}
        {state.kind === 'loading' && displayed.kind === 'loaded' && <LoadingPill />}
        <CommentOverlay
          liveComments={liveComments}
          modifiedEditor={modifiedEditor}
          monaco={monaco}
          area={editorAreaEl}
          hoveredId={hoveredCommentId}
          onHoveredIdChange={setHoveredCommentId}
          onEditComment={editComment}
          onDeleteComment={binding.remove}
          pendingRange={dragging ? null : pendingRange}
          pendingText={pendingText}
          editingId={editingId}
          onSubmitDraft={addComment}
          onCancelDraft={cancelComment}
        />
      </EditorViewport>
      {editTarget && (
        <EditCommentsModal
          initialText={editTarget.text}
          count={editTarget.ids.length}
          onClose={() => setEditTarget(null)}
          onSend={confirmEditAndSend}
        />
      )}
    </div>
  );
}
