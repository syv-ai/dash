import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { ITheme as XtermTheme } from '@xterm/xterm';
import type { EditorView } from './types';
import type { LiveComment } from './comments/types';
import type { DiffComment } from '../../../shared/types';
import { useCommentsStore } from '../../stores/commentsStore';
import { useGit } from '../../stores/gitStore';
import { PrThreadOverlay } from './prReview/PrThreadOverlay';
import { PrViewCorner } from './prReview/PrViewCorner';
import { usePrView } from './prReview/usePrView';
import { draftSubmitLabel as prDraftSubmitLabel } from './prReview/prViewPolicy';
import { useGutterSelection } from './comments/useGutterSelection';
import { useFileComments } from './comments/useFileComments';
import { commentScope, scopeLabel, withoutPrComments } from './comments/commentScope';
import { useCommentShades } from './comments/useCommentShades';
import { useCommentBands } from './comments/useCommentBands';
import { useCommentDraft } from './comments/useCommentDraft';
import { useCommentPrompt } from './comments/useCommentPrompt';
import { useFileFade } from './comments/useFileFade';
import { CommentOverlay } from './comments/overlay/CommentOverlay';
import { CommentsMenu } from './comments/CommentsMenu';
import { EditCommentsModal } from './comments/EditCommentsModal';
import { useGitBlame } from './blame/useGitBlame';
import { useFileLoad } from './editor/useFileLoad';
import { usePaneModels } from './editor/usePaneModels';
import { dirtyVersion, isDirty, subscribeDirty } from './models';
import type { TextRange } from '../../stores/editorTabsStore';
import { useEditorSave } from './editor/useEditorSave';
import { useMonacoEditor } from './editor/useMonacoEditor';
import { EditorHeader } from './editor/EditorHeader';
import { EditorViewport } from './editor/EditorViewport';
import { EditorContextMenu } from './editor/EditorContextMenu';
import { HtmlPreview } from './editor/HtmlPreview';
import { markdownToDocument } from './editor/markdownPreview';
import { LoadingPill } from './editor/LoadingPill';
import { StaleBanner } from './editor/StaleBanner';
import { SaveErrorBanner } from './editor/SaveErrorBanner';
import '../../monaco-workers';

const WORDWRAP_KEY = 'diffEditor.wordWrap';
const BLAME_KEY = 'diffEditor.blame';
const SIDE_BY_SIDE_KEY = 'diffEditor.sideBySide';
const NO_COMMENTS: Record<string, DiffComment[]> = {};

/** Which files get a Code | Preview toggle, and how their preview is rendered.
 *  HTML renders as-is; markdown is converted to a styled HTML document. */
function previewKind(filePath: string): 'html' | 'markdown' | null {
  if (/\.html?$/i.test(filePath)) return 'html';
  if (/\.(md|markdown)$/i.test(filePath)) return 'markdown';
  return null;
}

interface EditorPaneProps {
  /** This pane's id, unique on the page: it holds the models it shows. */
  paneId: string;
  cwd: string;
  /** `cwd` is a task's worktree: git (blame) applies. */
  git: boolean;
  filePath: string;
  view: EditorView;
  activeTaskId: string | null;
  terminalTheme: XtermTheme;
  isDark: boolean;
  /** When set, the editor reveals the comment with this id once it lives in
   *  the current file's hydrated decorations, then calls onClearReveal. */
  revealCommentId: string | null;
  /** Jump to a comment, switching to its view (scope) + file as needed. */
  onNavigateToComment: (scope: string, filePath: string, commentId: string) => void;
  onClearReveal: () => void;
  onClose: () => void;
  /** The project `cwd` belongs to (PR review calls name it). */
  projectId: string | null;
  /** Open another file (the PR review menu's thread list). */
  onSelectFile: (path: string) => void;
  /** Show this range once the file is on screen (go-to-definition, openFileAt). */
  revealRange: { range: TextRange; nonce: number } | null;
  onRevealed: (nonce: number) => void;
  /** `filePath` turned out to be a folder (a tab from before it was one). */
  onIsDirectory: (path: string) => void;
}

export function EditorPane({
  paneId,
  cwd,
  git,
  filePath,
  view,
  activeTaskId,
  terminalTheme,
  isDark,
  revealCommentId,
  onNavigateToComment,
  onClearReveal,
  onClose,
  projectId,
  onSelectFile,
  revealRange,
  onRevealed,
  onIsDirectory,
}: EditorPaneProps) {
  // The store holds the active task's comments: they belong here only while
  // this is that task's folder (activeTaskId is null otherwise).
  const commentsOn = useCommentsStore((s) => !s.disabled && s.taskId === activeTaskId);
  const storedByFile = useCommentsStore((s) => s.byFile);
  const commentsByFile = commentsOn ? storedByFile : NO_COMMENTS;
  const commentsDisabled = !commentsOn;
  const { state, reload } = useFileLoad(cwd, filePath, view);
  const isDirectory = state.kind === 'error' && state.code === 'IS_DIRECTORY';
  const onIsDirectoryRef = useRef(onIsDirectory);
  onIsDirectoryRef.current = onIsDirectory;
  useEffect(() => {
    if (isDirectory) onIsDirectoryRef.current(filePath);
  }, [isDirectory, filePath]);
  // The buffer's text, mirrored for the rendered preview.
  const [draft, setDraft] = useState<string>('');
  const [wordWrap, setWordWrap] = useState<boolean>(
    () => localStorage.getItem(WORDWRAP_KEY) === 'on',
  );
  // Inline git blame defaults ON; only an explicit 'off' disables it.
  const [blameEnabled, setBlameEnabled] = useState<boolean>(
    () => localStorage.getItem(BLAME_KEY) !== 'off',
  );
  const [sideBySide, setSideBySide] = useState<boolean>(
    () => localStorage.getItem(SIDE_BY_SIDE_KEY) === 'on',
  );
  const [previewing, setPreviewing] = useState(false);
  const kind = previewKind(filePath);
  const canPreview = kind !== null;

  // Always start a newly-opened file in source view; clear any stale preview
  // when switching to a non-previewable file.
  useEffect(() => {
    setPreviewing(false);
  }, [filePath]);

  const blameLabelRef = useRef<HTMLDivElement | null>(null);
  const selectionDecorations = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);
  const saveCmdRef = useRef<(() => void) | null>(null);
  // State (not ref) so the popover's `container` prop sees the actual node
  // after mount — refs alone don't trigger a re-render.
  const [editorAreaEl, setEditorAreaEl] = useState<HTMLDivElement | null>(null);
  // Lifted out of CommentOverlay so the band-rendering effect can also
  // intensify the rows owned by the hovered comment (bidirectional
  // hover-highlight).
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);

  // Commit and PR views show frozen, read-only content.
  const isCommitView = view.kind === 'commit' || view.kind === 'pr';
  // A PR view shows the PR's review threads beside your notes and comments.
  const isPrView = view.kind === 'pr';
  // Comments anchor to the view's content state: 'live' (working/branch share
  // the working file) vs 'commit:<hash>'. The editor shows only this scope's
  // comments; the menu spans all scopes (grouped by view).
  const scope = commentScope(view);
  // Origin tag on bubbles whenever the open view isn't the plain working tree
  // (a PR view tags each one note or comment instead).
  const bubbleScopeLabel = view.kind === 'working' || isPrView ? undefined : scopeLabel(scope);
  // Comment count for the open commit — surfaced in the header's "Showing …" pill.
  const scopeCommentCount = useMemo(() => {
    let n = 0;
    for (const list of Object.values(commentsByFile))
      for (const c of list) if (c.viewScope === scope) n++;
    return n;
  }, [commentsByFile, scope]);

  const { editor, monaco, displayed, handleBeforeMount, handleMount, handleUnmount } =
    useMonacoEditor({
      isDark,
      terminalTheme,
      state,
      onSave: () => saveCmdRef.current?.(),
      onDraftChange: setDraft,
      isCommitView,
    });
  const modifiedEditor = editor?.getModifiedEditor() ?? null;

  // The widget's models: the working file's shared one in the live views.
  const forceReloadRef = useRef(false);
  const { attachedLoadId, working } = usePaneModels({
    holder: paneId,
    cwd,
    filePath,
    view,
    state,
    editor,
    forceRef: forceReloadRef,
  });

  const saveApi = useEditorSave({
    cwd,
    filePath,
    model: working,
    reload: () => {
      forceReloadRef.current = true;
      reload();
    },
  });
  const {
    saving,
    savedPill,
    stale,
    setStale,
    saveError,
    setSaveError,
    save,
    overwrite,
    reloadFromDisk,
  } = saveApi;

  const { pendingRange, setPendingRange, dragging } = useGutterSelection(
    modifiedEditor,
    monaco,
    !commentsDisabled,
  );
  const editable = !isCommitView && working !== null;
  // Shared with every other view of the file: one buffer, one dirty flag.
  useSyncExternalStore(subscribeDirty, dirtyVersion);
  const dirty = editable && isDirty(working.uri.toString());
  // Unchanged files open as a plain editor: never split into two columns.
  const changed =
    displayed.kind === 'loaded' && displayed.originalContent !== displayed.modifiedContent;

  // Document fed to the preview iframe — the live editor buffer (so unsaved
  // edits show immediately). Markdown is converted; HTML renders verbatim.
  // Skipped entirely while showing source so we don't parse on every keystroke.
  const previewHtml = useMemo(() => {
    if (!previewing || !kind) return '';
    return kind === 'markdown' ? markdownToDocument(draft, isDark) : draft;
  }, [previewing, kind, draft, isDark]);

  // A fresh load is on screen: mirror its buffer (which may hold edits made
  // in another group) and drop the previous file's transient state.
  useEffect(() => {
    if (attachedLoadId === 0) return;
    setDraft(editor?.getModifiedEditor().getValue() ?? '');
    setPendingRange(null);
    setStale(null);
    setSaveError(null);
  }, [attachedLoadId, editor, setPendingRange, setStale, setSaveError]);

  // Fade-on-file-change: bumps only after the new file's content has actually
  // loaded (not on the click), so the fade-in coincides with the visual swap.
  const fileFadeNonce = useFileFade(filePath, state.kind === 'loaded');

  // ── Comments binding ────────────────────────────────────
  // Owns Monaco decoration lifecycle for the current filePath. Hydration
  // and snapshot are both scoped via closure inside the hook, which kills
  // the previous file-ref-races (the source of the phantom-comment bug).
  // Loaded and on screen: decorations go on the models the widget shows.
  // (and of this file: the render that switches files still holds the last one's load).
  const isFileLoaded =
    state.kind === 'loaded' && attachedLoadId === state.loadId && state.filePath === filePath;
  // The PR view's review, threads and policy; inert in any other view.
  const pr = usePrView({
    view,
    scope,
    activeTaskId,
    projectId,
    cwd,
    filePath,
    isFileLoaded,
    onClose,
  });
  const binding = useFileComments({
    enabled: commentsOn,
    filePath,
    isFileLoaded,
    editor,
    monaco,
    scope,
    newKind: pr.newKind,
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

  // A range asked for from outside (openFileAt): reveal it once on screen.
  useEffect(() => {
    if (!revealRange || !isFileLoaded || !modifiedEditor || !monaco) return;
    modifiedEditor.revealRangeInCenter(revealRange.range, monaco.editor.ScrollType.Smooth);
    modifiedEditor.setSelection(revealRange.range);
    modifiedEditor.focus();
    onRevealed(revealRange.nonce);
  }, [revealRange, isFileLoaded, modifiedEditor, monaco, onRevealed]);

  useEffect(() => {
    localStorage.setItem(WORDWRAP_KEY, wordWrap ? 'on' : 'off');
  }, [wordWrap]);

  useEffect(() => {
    localStorage.setItem(BLAME_KEY, blameEnabled ? 'on' : 'off');
  }, [blameEnabled]);

  useEffect(() => {
    localStorage.setItem(SIDE_BY_SIDE_KEY, sideBySide ? 'on' : 'off');
  }, [sideBySide]);

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

  // Inline git blame: on hover, a same-commit block highlight in the editor body
  // plus a band + info card on the right overview-ruler strip. Toggled from the
  // header (and the card's ×) via `blameEnabled`.
  const { rulerMark, rulerVisible, rulerSlide, rulerHost, holdLabel, releaseLabel } = useGitBlame({
    cwd,
    filePath,
    view,
    modifiedEditor,
    monaco,
    enabled: git && blameEnabled,
    canBlame: isFileLoaded && state.kind === 'loaded' && !state.isBinary && !state.isLargeFile,
  });

  // Keep the blame card fully visible: clamp its top so it never spills past the
  // editor area's bottom (commits on the last lines of a file). Runs before paint
  // so the clamp is never seen unapplied.
  useLayoutEffect(() => {
    const el = blameLabelRef.current;
    if (!el || !rulerMark || !editorAreaEl) return;
    const maxTop = editorAreaEl.clientHeight - el.offsetHeight - 4;
    el.style.top = `${Math.max(4, Math.min(rulerMark.top, maxTop))}px`;
  }, [rulerMark, editorAreaEl]);

  // In-progress comment (fresh-create vs dbl-click-to-edit) state.
  const draftApi = useCommentDraft({ modifiedEditor, setPendingRange, binding });

  // When a fresh comment draft opens, scroll its anchor line into the centre so
  // there's room above for the bubble (which renders above the line). Without
  // this, a draft placed on the last line(s) of a file is clipped at the editor's
  // bottom with no way to scroll to it (scrollBeyondLastLine is off). Deferred a
  // frame so the bubble's view-zone exists and the reveal accounts for it.
  useEffect(() => {
    if (dragging || !pendingRange || draftApi.editingId || !modifiedEditor || !monaco) return;
    const raf = requestAnimationFrame(() => {
      modifiedEditor.revealLineInCenter(pendingRange.start, monaco.editor.ScrollType.Smooth);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingRange, dragging, draftApi.editingId, modifiedEditor, monaco]);

  // The task's comments menu lists notes; PR comments belong to their PR's widget.
  const menuCommentsByFile = useMemo(() => withoutPrComments(commentsByFile), [commentsByFile]);
  // The menu shows only with something to send: it is the way to send.
  const hasUnsent = useMemo(
    () => Object.values(menuCommentsByFile).some((list) => list.some((c) => !c.sent)),
    [menuCommentsByFile],
  );

  // Prompt assembly + send-to-TUI + edit-and-send modal.
  const promptApi = useCommentPrompt({
    activeTaskId,
    filePath,
    modifiedEditor,
    monaco,
    liveComments,
    language: state.kind === 'loaded' ? state.language : '',
    scope,
    sendable: pr.sendable ?? menuCommentsByFile,
    onClose,
  });

  const editingKind = draftApi.editingId
    ? liveComments.find((c) => c.id === draftApi.editingId)?.kind
    : undefined;
  const draftSubmitLabel = prDraftSubmitLabel(isPrView, pr.inReview, editingKind);

  const getLiveRangeForCurrent = (commentId: string) => {
    const target = liveComments.find((c) => c.id === commentId);
    if (!target) return null;
    const r = modifiedEditor?.getModel()?.getDecorationRange(target.decorationId);
    return r ? { start: r.startLineNumber, end: r.endLineNumber } : null;
  };

  const showCommentsMenu = !commentsDisabled && hasUnsent && !isPrView;

  return (
    <div className="h-full flex flex-col min-w-0 min-h-0">
      <EditorHeader
        git={git}
        filePath={filePath}
        view={view}
        wordWrap={wordWrap}
        onToggleWordWrap={() => setWordWrap((w) => !w)}
        sideBySide={sideBySide}
        onToggleSideBySide={() => setSideBySide((v) => !v)}
        canSideBySide={changed}
        blameEnabled={blameEnabled}
        onToggleBlame={() => setBlameEnabled((b) => !b)}
        canPreview={canPreview}
        previewing={previewing}
        onTogglePreview={setPreviewing}
        commentCount={scopeCommentCount}
      />

      {stale && (
        <StaleBanner
          onOverwrite={() => void overwrite()}
          onReload={() => void reloadFromDisk()}
          onCancel={() => setStale(null)}
        />
      )}

      {saveError && (
        <SaveErrorBanner
          message={saveError}
          onRetry={() => void save()}
          onDismiss={() => setSaveError(null)}
        />
      )}

      <EditorContextMenu cwd={cwd} filePath={filePath} editor={editor}>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <EditorViewport
            displayed={displayed}
            currentState={state}
            editable={editable}
            wordWrap={wordWrap}
            sideBySide={sideBySide && changed}
            changed={changed}
            commentGutter={liveComments.length > 0}
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            onUnmount={handleUnmount}
            areaRef={setEditorAreaEl}
            fileFadeNonce={fileFadeNonce}
          >
            {editable && (dirty || saving || savedPill) && (
              <button
                onClick={() => void save()}
                disabled={!dirty || saving}
                className={`absolute bottom-16 right-4 z-10 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/70 text-primary-foreground hover:bg-primary/85 disabled:cursor-default shadow-lg shadow-shade/30 transition-opacity ${savedPill ? 'animate-save-flash' : ''}`}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            <PrViewCorner
              pr={pr}
              activeTaskId={activeTaskId}
              projectId={projectId}
              cwd={cwd}
              currentFilePath={filePath}
              getLiveRangeForCurrent={getLiveRangeForCurrent}
              onNavigate={onNavigateToComment}
              onSendOne={promptApi.sendOne}
              onSendMany={promptApi.sendMany}
              onSelectFile={onSelectFile}
            />
            {state.kind === 'loading' && displayed.kind === 'loaded' && <LoadingPill />}
            {rulerMark &&
              (() => {
                const lineRange =
                  rulerMark.lineStart === rulerMark.lineEnd
                    ? `L${rulerMark.lineStart}`
                    : `L${rulerMark.lineStart}–${rulerMark.lineEnd}`;
                const band = (
                  <div
                    className="monaco-blame-ruler-band"
                    data-visible={rulerVisible}
                    data-slide={rulerSlide}
                    style={{ top: rulerMark.top, height: rulerMark.height }}
                  />
                );
                return (
                  <>
                    {rulerHost ? createPortal(band, rulerHost) : band}
                    <div
                      ref={blameLabelRef}
                      className="monaco-blame-ruler-label"
                      data-visible={rulerVisible}
                      data-slide={rulerSlide}
                      style={{ top: rulerMark.top }}
                      onMouseEnter={holdLabel}
                      onMouseLeave={releaseLabel}
                    >
                      <button
                        type="button"
                        className="blame-label-close"
                        title="Hide git blame"
                        onClick={() => setBlameEnabled(false)}
                      >
                        <X size={11} strokeWidth={2} />
                      </button>
                      <span className="blame-label-author">{rulerMark.label.author}</span>
                      <span className="blame-label-meta">
                        {!rulerMark.label.uncommitted && (
                          <>
                            <button
                              type="button"
                              className="blame-label-sha"
                              title="Open this commit in the graph"
                              onClick={() =>
                                useGit.getState().openCommitGraphAtCommit(rulerMark.label.shortSha)
                              }
                            >
                              {rulerMark.label.shortSha}
                            </button>
                            {rulerMark.label.age && (
                              <span className="blame-label-age">{rulerMark.label.age} ago</span>
                            )}
                          </>
                        )}
                        <span className="blame-label-lines">{lineRange}</span>
                      </span>
                      {!rulerMark.label.uncommitted && rulerMark.label.summary && (
                        <span className="blame-label-summary">{rulerMark.label.summary}</span>
                      )}
                    </div>
                  </>
                );
              })()}
            {isPrView && (
              <PrThreadOverlay
                threads={pr.inlineThreads}
                provider={view.kind === 'pr' ? view.provider : 'github'}
                draftScope={pr.draftScope}
                inReview={pr.inReview}
                onSetResolved={pr.setThreadResolved}
                modifiedEditor={modifiedEditor}
                area={editorAreaEl}
                onSend={(t) => pr.sendThreads([t], false)}
              />
            )}
            <CommentOverlay
              liveComments={liveComments}
              shadeById={shadeById}
              scopeLabel={bubbleScopeLabel}
              modifiedEditor={modifiedEditor}
              monaco={monaco}
              area={editorAreaEl}
              hoveredId={hoveredCommentId}
              onHoveredIdChange={setHoveredCommentId}
              onEditComment={draftApi.beginEdit}
              onDeleteComment={binding.remove}
              onReopenComment={(id) => useCommentsStore.getState().markUnsent(id)}
              onPromoteComment={
                pr.canPromote
                  ? (id) => useCommentsStore.getState().setKind(id, 'comment')
                  : undefined
              }
              draftSubmitLabel={draftSubmitLabel}
              pendingRange={dragging ? null : pendingRange}
              pendingText={draftApi.pendingText}
              editingId={draftApi.editingId}
              onSubmitDraft={(text) => draftApi.submit(text, dragging ? null : pendingRange)}
              onCancelDraft={draftApi.cancel}
            />
          </EditorViewport>
          {/* Below the code, not over it. */}
          {showCommentsMenu && (
            <div className="flex shrink-0 justify-end border-t border-edge/6 px-3 py-1">
              <CommentsMenu
                commentsByFile={menuCommentsByFile}
                currentFilePath={filePath}
                currentScope={scope}
                getLiveRangeForCurrent={getLiveRangeForCurrent}
                onNavigate={onNavigateToComment}
                onRemove={(_path, id) => useCommentsStore.getState().remove(id)}
                onUnsend={(id) => useCommentsStore.getState().markUnsent(id)}
                onClearSent={(scope) => useCommentsStore.getState().clearSent(scope)}
                onSendScope={promptApi.sendScope}
                onSendAll={promptApi.sendAllUnsent}
                onEditAndSend={promptApi.openEditAndSend}
                onSendOne={promptApi.sendOne}
              />
            </div>
          )}
          {/* Rendered preview overlays the editor (kept mounted underneath so
            toggling back to Code preserves scroll, cursor, and comment state). */}
          {canPreview && previewing && (
            <div className="absolute inset-0 z-30">
              <HtmlPreview html={previewHtml} />
            </div>
          )}
        </div>
      </EditorContextMenu>
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
