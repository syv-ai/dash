import React, { useEffect, useMemo, useRef } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { Loader2 } from 'lucide-react';
import type { LoadState } from './useFileLoad';
import { DiffEditorHost } from './DiffEditorHost';
import { RAIL_WIDTH_PX } from '../../ui/railBar';

interface Props {
  displayed: LoadState;
  currentState: LoadState;
  editable: boolean;
  wordWrap: boolean;
  /** Two columns (base | working) instead of the inline diff. An unchanged
   *  file is never split: inline, with nothing to mark, it is a plain editor. */
  sideBySide: boolean;
  /** The file has changes to mark (+/- signs, the overview strip). */
  changed: boolean;
  /** Comment icons sit in the gutter: widen it to hold them. */
  commentGutter: boolean;
  beforeMount(monaco: typeof import('monaco-editor')): void;
  onMount(editor: monacoEditor.IStandaloneDiffEditor, monaco: typeof import('monaco-editor')): void;
  onUnmount(): void;
  /** Caller passes a ref-callback so it can render comment widgets and the
   *  inline-input popover into the editor area. */
  areaRef: (el: HTMLDivElement | null) => void;
  /** Bumped each time the user opens a new file — the Monaco wrapper plays
   *  a brief opacity transition synced with the content swap. Monaco itself
   *  stays mounted to preserve the no-flash behavior. */
  fileFadeNonce: number;
  /** Extra children rendered inside the editor area (after Monaco). Used for
   *  the loading pill, save button, comment widgets, etc. */
  children?: React.ReactNode;
}

export function EditorViewport({
  displayed,
  currentState,
  editable,
  wordWrap,
  sideBySide,
  changed,
  commentGutter,
  beforeMount,
  onMount,
  onUnmount,
  areaRef,
  fileFadeNonce,
  children,
}: Props) {
  // Imperatively kick off the fade so Monaco's DOM stays put. Resetting
  // opacity → reflow → animating back to 1 ensures the transition fires
  // even when the same nonce is set twice in quick succession.
  const monacoWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (fileFadeNonce === 0) return;
    const el = monacoWrapRef.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '0';
    // Force a layout read so the next style write is treated as a change.
    void el.offsetHeight;
    el.style.transition = 'opacity 200ms cubic-bezier(0.16, 1, 0.3, 1)';
    el.style.opacity = '1';
  }, [fileFadeNonce]);

  const options = useMemo<monacoEditor.IDiffEditorConstructionOptions>(
    () => ({
      originalEditable: false,
      readOnly: !editable,
      renderSideBySide: sideBySide,
      // Monaco falls back to inline below this width.
      renderSideBySideInlineBreakpoint: 600,
      compactMode: !sideBySide,
      renderGutterMenu: false,
      contextmenu: false,
      fontSize: 12,
      lineNumbers: 'on',
      // Nothing draws in the glyph margin (blame and comments live elsewhere).
      glyphMargin: false,
      lineNumbersMinChars: 3,
      // The gap between line numbers and code: room for the diff's +/- signs,
      // or the comment icons, and no more.
      lineDecorationsWidth: commentGutter ? 30 : changed ? 22 : 10,
      scrollBeyondLastLine: false,
      wordWrap: wordWrap ? 'on' : 'off',
      // No overview rails beside the code (the diff's strip read as a grey
      // slab). The diff editor forces its sub-editors' minimap off; threads,
      // comments and notes show on the review rail (`ReviewRail`, D80).
      renderOverviewRuler: false,
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      // Slim scrollbars, only when the content overflows, faint until hovered
      // (their colours are the theme's). Monaco reserves the vertical one's
      // width whether it shows or not, so the code never shifts; that column
      // is the review rail's too, the slider drawn over its bars.
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        verticalScrollbarSize: RAIL_WIDTH_PX,
        horizontalScrollbarSize: 8,
        useShadows: false,
      },
      guides: { highlightActiveIndentation: 'always' },
    }),
    [editable, sideBySide, wordWrap, changed, commentGutter],
  );

  return (
    <div ref={areaRef} className="flex-1 relative overflow-hidden">
      {currentState.kind === 'loading' && displayed.kind !== 'loaded' && (
        <div className="flex items-center justify-center h-full">
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="animate-spin text-primary" />
            <span className="text-base text-muted-fade-50">Loading…</span>
          </div>
        </div>
      )}
      {currentState.kind === 'empty' && (
        <div className="flex items-center justify-center h-full">
          <span className="text-base text-muted-fade-50">Select a file from the sidebar</span>
        </div>
      )}
      {currentState.kind === 'error' && (
        <div className="flex items-center justify-center h-full">
          <span className="text-base text-destructive">{currentState.message}</span>
        </div>
      )}
      {displayed.kind === 'loaded' && displayed.isBinary && (
        <div className="flex items-center justify-center h-full">
          <span className="text-base text-muted-fade-40">Binary file — cannot display diff</span>
        </div>
      )}
      {displayed.kind === 'loaded' && displayed.isLargeFile && (
        <div className="flex items-center justify-center h-full">
          <span className="text-base text-muted-fade-40">
            File too large to preview here (&gt;5 MB).
          </span>
        </div>
      )}
      {displayed.kind === 'loaded' && !displayed.isBinary && !displayed.isLargeFile && (
        // pl-2: a slice of room between the sheet's edge and the line numbers,
        // outside Monaco (it measures its own box, so hit-testing holds).
        <div ref={monacoWrapRef} className="absolute inset-0 pl-2">
          <DiffEditorHost
            options={options}
            beforeMount={beforeMount}
            onMount={onMount}
            onUnmount={onUnmount}
          />
        </div>
      )}
      {children}
    </div>
  );
}
