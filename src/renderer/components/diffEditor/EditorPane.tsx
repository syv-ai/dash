import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { ITheme as XtermTheme } from 'xterm';
import type { EditorView } from './types';
import type { LiveComment } from './comments/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { useGutterSelection } from './comments/useGutterSelection';
import { useFileComments } from './comments/useFileComments';
import { useCommentShades } from './comments/useCommentShades';
import { useCommentBands } from './comments/useCommentBands';
import { useCommentDraft } from './comments/useCommentDraft';
import { useCommentPrompt } from './comments/useCommentPrompt';
import { useFileFade } from './comments/useFileFade';
import { CommentOverlay } from './comments/overlay/CommentOverlay';
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
  /** Branch-view header chip wiring. Owned by parent so the changed-files
   *  effect can also react to view changes. */
  onSelectBase: (base: string) => void;
  onExitBranchView: () => void;
  defaultBase: string | null;
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
  onSelectBase,
  onExitBranchView,
  defaultBase,
}: EditorPaneProps) {
  const commentsByFile = useCommentsStore((s) => s.byFile);
  const commentsDisabled = useCommentsStore((s) => s.disabled);
  const { state, setState } = useFileLoad(cwd, filePath, view);
  const [draft, setDraft] = useState<string>('');
  const [loadedBuffer, setLoadedBuffer] = useState<string>('');
  const [wordWrap, setWordWrap] = useState<boolean>(
    () => localStorage.getItem(WORDWRAP_KEY) === 'on',
  );

  const selectionDecorations = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const saveCmdRef = useRef<(() => void) | null>(null);
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
    !commentsDisabled,
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

  // Fade-on-file-change: bumps only after the new file's content has actually
  // loaded (not on the click), so the fade-in coincides with the visual swap.
  const fileFadeNonce = useFileFade(filePath, state.kind === 'loaded');

  // ── Comments binding ────────────────────────────────────
  // Owns Monaco decoration lifecycle for the current filePath. Hydration
  // and snapshot are both scoped via closure inside the hook, which kills
  // the previous file-ref-races (the source of the phantom-comment bug).
  const isFileLoaded = state.kind === 'loaded';
  const binding = useFileComments({
    filePath,
    isFileLoaded,
    editor,
    monaco,
  });
  const liveComments = binding.liveComments;
  const shadeById = useCommentShades(liveComments);

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

  // Shade-aware band rendering (per-row decoration collection for the open
  // file). Owns its own decorations ref inside the hook.
  useCommentBands({
    modifiedEditor,
    monaco,
    liveComments,
    shadeById,
    isDark,
    disabled: commentsDisabled,
    hoveredCommentId,
  });

  // In-progress comment (fresh-create vs dbl-click-to-edit) state.
  const draftApi = useCommentDraft({ modifiedEditor, setPendingRange, binding });

  // Prompt assembly + send-to-TUI + edit-and-send modal.
  const promptApi = useCommentPrompt({
    activeTaskId,
    filePath,
    modifiedEditor,
    monaco,
    liveComments,
    language: state.kind === 'loaded' ? state.language : '',
    onClose,
  });

  function handleClose() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  const hasAnyComments = useMemo(
    () => Object.values(commentsByFile).some((list) => list.length > 0),
    [commentsByFile],
  );

  const showCommentsMenu = !commentsDisabled && hasAnyComments;

  return (
    <div className="h-full flex flex-col min-w-0 min-h-0">
      <EditorHeader
        cwd={cwd}
        filePath={filePath}
        view={view}
        wordWrap={wordWrap}
        onToggleWordWrap={() => setWordWrap((w) => !w)}
        onClose={handleClose}
        onSelectBase={onSelectBase}
        onExitBranchView={onExitBranchView}
        defaultBase={defaultBase}
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
              onRemove={(_path, id) => useCommentsStore.getState().remove(id)}
              onUnsend={(id) => useCommentsStore.getState().markUnsent(id)}
              onSend={promptApi.sendAllUnsent}
              onEditAndSend={promptApi.openEditAndSend}
              onSendOne={promptApi.sendOne}
            />
          </div>
        )}
        {state.kind === 'loading' && displayed.kind === 'loaded' && <LoadingPill />}
        <CommentOverlay
          liveComments={liveComments}
          shadeById={shadeById}
          modifiedEditor={modifiedEditor}
          monaco={monaco}
          area={editorAreaEl}
          hoveredId={hoveredCommentId}
          onHoveredIdChange={setHoveredCommentId}
          onEditComment={draftApi.beginEdit}
          onDeleteComment={binding.remove}
          pendingRange={dragging ? null : pendingRange}
          pendingText={draftApi.pendingText}
          editingId={draftApi.editingId}
          onSubmitDraft={(text) => draftApi.submit(text, dragging ? null : pendingRange)}
          onCancelDraft={draftApi.cancel}
        />
      </EditorViewport>
      {promptApi.editTarget && (
        <EditCommentsModal
          initialText={promptApi.editTarget.text}
          count={promptApi.editTarget.ids.length}
          onClose={promptApi.cancelEditAndSend}
          onSend={promptApi.confirmEditAndSend}
        />
      )}
    </div>
  );
}
