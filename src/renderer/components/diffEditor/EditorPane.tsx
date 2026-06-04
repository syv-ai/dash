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
// The WIP popover's visual height — used to decide whether to flip it
// upward when the selected range sits near the bottom of the editor area.
// Kept in sync with the Tailwind `h-[…]` class on the PopoverContent below.
const POPOVER_HEIGHT_PX = 140;
const POPOVER_FLIP_PADDING_PX = 12;

// Inline SVG markup for the comment-widget chrome. We build widgets via
// the DOM (not React) so they survive across renders without remount,
// which means lucide-react icons aren't available — these are the same
// glyphs (chevron-up, message-square) rendered as static strings.
const CHEVRON_UP_SVG =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>';
const MESSAGE_SQUARE_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

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
  // Persistent comment widget DOM nodes keyed by comment id. Owned by a
  // ref (not state) so the widgets effect can diff-update without React
  // re-runs, and so we can imperatively kick off enter/leave animations.
  const widgetNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // Per-comment collapse state for the persistent widget. Local to the
  // modal session — collapse is a transient view preference, not worth
  // persisting to SQLite. Default for any comment is *expanded*.
  const [collapsedWidgets, setCollapsedWidgets] = useState<ReadonlySet<string>>(() => new Set());
  // Fade-on-file-change. Bumped only after the new file's content has
  // actually swapped into the editor — earlier than that and the user
  // sees the OLD content fade in, which feels wrong.
  const pendingFileFadeRef = useRef(false);
  const [fileFadeNonce, setFileFadeNonce] = useState(0);
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

  // align="start" → popover top aligns with anchor top → extends DOWN
  // align="end"   → popover bottom aligns with anchor bottom → extends UP
  // Flipped when the selected range sits too close to the bottom of the
  // editor area to fit a downward-opening popover (also handles the
  // double-click-to-edit reopen, since both paths share this popover).
  const [popoverAlign, setPopoverAlign] = useState<'start' | 'end'>('start');

  // Position the comment popover's anchor on the right edge of the editor.
  // The popover opens to the *left* of this anchor so it sits on the right
  // portion of the editor pane — keeping the highlighted code on the left
  // visible.
  //
  // Radix Popover uses Floating UI's autoUpdate, which listens to scroll on
  // *DOM* scroll-ancestors of the anchor + ResizeObserver on the anchor box.
  // Monaco scrolls internally, so no scroll bubbles up, and changing the
  // anchor's `top` doesn't change its box → no auto-update fires. We toggle
  // the anchor's width by 1px on every position update to force the
  // ResizeObserver to fire, which makes Radix recompute the popover
  // position. Same mechanism keeps the popover tracking the gutter drag.
  //
  // Default anchor mirrors the persistent comment widget so editing an
  // existing comment feels like the widget transforms into the editor
  // (multi-line → top of first line + inset; single-line → below the line,
  // same fallback as the widget). When the bottom is too tight, we flip:
  // anchor at the top of the first line + `align="end"` so the popover
  // extends UPWARD from just above the selection. Either way the selection
  // stays uncovered.
  //
  // No clamp on top — if the user scrolls the line out of view, the popover
  // scrolls out with it (combined with `avoidCollisions={false}`).
  useEffect(() => {
    const anchor = popoverAnchorRef.current;
    if (!modifiedEditor || !anchor || !pendingRange) return;
    const update = () => {
      const scrollTop = modifiedEditor.getScrollTop();
      const topFirst = modifiedEditor.getTopForLineNumber(pendingRange.start) - scrollTop;
      const isSingleLine = pendingRange.start === pendingRange.end;
      const topDefault = isSingleLine
        ? modifiedEditor.getTopForLineNumber(pendingRange.end + 1) - scrollTop
        : topFirst + 4;
      const areaHeight = editorAreaEl?.clientHeight ?? 0;
      const bottomSpace = areaHeight - topDefault;
      // Flip upward only when the bottom is too tight AND we have room
      // above. If neither side fits we stay "start" so the natural clip is
      // at the bottom (predictable), not the top.
      const flipUp =
        bottomSpace < POPOVER_HEIGHT_PX + POPOVER_FLIP_PADDING_PX &&
        topFirst >= POPOVER_HEIGHT_PX + POPOVER_FLIP_PADDING_PX;
      anchor.style.top = `${flipUp ? topFirst : topDefault}px`;
      anchor.style.width = anchor.offsetWidth === 1 ? '2px' : '1px';
      setPopoverAlign(flipUp ? 'end' : 'start');
    };
    update();
    const sub = modifiedEditor.onDidScrollChange(update);
    return () => sub.dispose();
  }, [pendingRange, modifiedEditor, editorAreaEl]);

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
    const decos: monacoEditor.IModelDeltaDecoration[] = rows.map((r) => ({
      range: new monaco.Range(r.startLine, 1, r.endLine, 1),
      options: {
        isWholeLine: true,
        className: `monaco-comment-line-shade-${r.signature}`,
        lineNumberClassName: `monaco-comment-ln-shade-${r.signature}`,
        minimap: { color: commentMarker, position: monaco.editor.MinimapPosition.Inline },
        overviewRuler: {
          color: commentMarker,
          position: monaco.editor.OverviewRulerLane.Right,
        },
      },
    }));
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
  // Same ref pattern for toggling collapse on a widget.
  const toggleCollapseRef = useRef<(id: string) => void>(() => {});
  toggleCollapseRef.current = (id: string) => {
    setCollapsedWidgets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Persistent comment widgets — absolute-positioned divs in the editor
  // area, right-aligned to match the WIP popover's footprint. We can't use
  // Monaco's content-widget API for this: content widgets anchor to a
  // (line, column) text position, so they always sit on the left side and
  // can't be right-aligned to the editor pane.
  //
  // Positioning: anchored to the TOP of the commented range with a small
  // inset (`WIDGET_TOP_INSET_PX`) so the widget visually sits *inside* the
  // commented band rather than dangling below it. Single-line comments
  // fall back to "below the line" — the only safe place when the band is
  // the same height as the widget would cover.
  //
  // Lifecycle: we DIFF against `widgetNodesRef` so existing widgets
  // survive across effect re-runs (file scrolls, sibling state churn),
  // newly-added comments get an enter animation, and removed comments
  // play a leave animation before unmount. Rebuilding from scratch each
  // time — which is what the previous design did — would re-fire the
  // enter animation on every keystroke.
  useEffect(() => {
    const area = editorAreaEl;
    if (!modifiedEditor || !area) return;
    const model = modifiedEditor.getModel();
    if (!model) return;

    const visible = commentsStore.disabled ? [] : liveComments.filter((c) => c.id !== editingId);
    const visibleIds = new Set(visible.map((c) => c.id));
    const map = widgetNodesRef.current;

    // Remove widgets whose comments are no longer visible: play the leave
    // animation, then unmount the node when the keyframe finishes.
    for (const [id, node] of map) {
      if (visibleIds.has(id)) continue;
      map.delete(id);
      node.classList.remove('monaco-comment-widget-enter');
      node.classList.add('monaco-comment-widget-leave');
      node.addEventListener(
        'animationend',
        () => {
          if (node.parentNode) node.remove();
        },
        { once: true },
      );
    }

    // Add new widgets; sync text + handlers + collapsed class on the rest.
    // Each widget has three children: a collapsed-state icon, a text body,
    // and a hover-revealed chevron toggle. CSS handles which is visible.
    for (const c of visible) {
      let node = map.get(c.id);
      if (!node) {
        node = document.createElement('div');
        node.className = 'monaco-comment-widget monaco-comment-widget-enter';

        const iconEl = document.createElement('div');
        iconEl.className = 'monaco-comment-widget-icon';
        iconEl.innerHTML = MESSAGE_SQUARE_SVG;

        const textEl = document.createElement('div');
        textEl.className = 'monaco-comment-widget-text';

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'monaco-comment-widget-toggle';
        toggleBtn.setAttribute('aria-label', 'Collapse comment');
        toggleBtn.title = 'Collapse';
        toggleBtn.innerHTML = CHEVRON_UP_SVG;

        node.append(iconEl, textEl, toggleBtn);
        area.appendChild(node);
        map.set(c.id, node);
      }

      const textEl = node.querySelector<HTMLDivElement>('.monaco-comment-widget-text');
      if (textEl && textEl.textContent !== c.text) textEl.textContent = c.text;

      const toggleBtn = node.querySelector<HTMLButtonElement>('.monaco-comment-widget-toggle');
      if (toggleBtn) {
        toggleBtn.onclick = (e) => {
          // Don't bubble to the widget's click handler (which would
          // immediately toggle again when in collapsed state).
          e.stopPropagation();
          toggleCollapseRef.current(c.id);
        };
      }

      // Single click only acts when collapsed (expand). Double-click only
      // acts when expanded (edit). Stays out of each other's way.
      node.onclick = () => {
        if (node && node.classList.contains('collapsed')) {
          toggleCollapseRef.current(c.id);
        }
      };
      node.ondblclick = () => {
        if (node && node.classList.contains('collapsed')) return;
        editCommentRef.current(c);
      };

      node.classList.toggle('collapsed', collapsedWidgets.has(c.id));
    }

    const WIDGET_TOP_INSET_PX = 4;
    const update = () => {
      const scrollTop = modifiedEditor.getScrollTop();
      for (const c of visible) {
        const node = map.get(c.id);
        if (!node) continue;
        const range = model.getDecorationRange(c.decorationId);
        if (!range) continue;
        const startLine = range.startLineNumber;
        const endLine = range.endLineNumber;
        const lineTop =
          startLine === endLine
            ? modifiedEditor.getTopForLineNumber(endLine + 1)
            : modifiedEditor.getTopForLineNumber(startLine) + WIDGET_TOP_INSET_PX;
        node.style.top = `${lineTop - scrollTop}px`;
      }
    };
    update();
    const sub = modifiedEditor.onDidScrollChange(update);
    return () => sub.dispose();
  }, [
    liveComments,
    editorAreaEl,
    editingId,
    commentsStore.disabled,
    modifiedEditor,
    collapsedWidgets,
  ]);

  // Final-unmount cleanup: yank any surviving widget nodes. We keep nodes
  // alive across normal effect re-runs (see above), so this is the only
  // place that's responsible for removing them on full unmount.
  useEffect(
    () => () => {
      for (const node of widgetNodesRef.current.values()) node.remove();
      widgetNodesRef.current.clear();
    },
    [],
  );

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

  // Build a prompt block from a specific set of comment ids and write it
  // into the task's Claude Code TUI. Marks the sent ids in the store so
  // they don't sneak back into the next bulk send. Used by both the bulk
  // "Send" (all unsent) and the per-card "Send this one" actions.
  function sendCommentsToPrompt(idsToSend: ReadonlyArray<string>): boolean {
    if (!activeTaskId || idsToSend.length === 0) return false;
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
    if (fileGroups.length === 0) return false;

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
    const taskId = activeTaskId;
    void import('../../terminal/SessionRegistry').then(({ sessionRegistry }) => {
      const session = sessionRegistry.get(taskId);
      if (session) session.writeInput(prompt);
    });
    commentsStore.markSent(idsToSend);
    return true;
  }

  function sendAllUnsent() {
    const ids: string[] = [];
    for (const list of Object.values(commentsByFile)) {
      for (const c of list) if (!c.sent) ids.push(c.id);
    }
    if (sendCommentsToPrompt(ids)) onClose();
  }

  function sendOneComment(id: string) {
    sendCommentsToPrompt([id]);
    // Stay in the modal: the user is browsing the dropdown and likely
    // wants to triage more before leaving.
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
        onSend={sendAllUnsent}
        onSendOne={sendOneComment}
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
        fileFadeNonce={fileFadeNonce}
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
        <CommentOverlay
          liveComments={liveComments}
          modifiedEditor={modifiedEditor}
          monaco={monaco}
          area={editorAreaEl}
          onEditComment={editComment}
        />
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
            align={popoverAlign}
            sideOffset={4}
            avoidCollisions={false}
            onInteractOutside={(e) => e.preventDefault()}
            container={editorAreaEl}
            className="comment-write-surface w-[260px] h-[140px] px-2.5 py-2 flex flex-col gap-1.5"
            style={{ color: 'hsl(var(--popover-foreground))' }}
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
