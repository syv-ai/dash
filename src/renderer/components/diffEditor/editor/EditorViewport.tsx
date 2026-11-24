import React, { useEffect, useMemo, useRef } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { Loader2 } from 'lucide-react';
import type { LoadState } from './useFileLoad';
import { DiffEditorHost } from './DiffEditorHost';

interface Props {
  displayed: LoadState;
  currentState: LoadState;
  editable: boolean;
  wordWrap: boolean;
  /** Two columns (base | working) instead of the inline diff. An unchanged
   *  file is never split: inline, with nothing to mark, it is a plain editor. */
  sideBySide: boolean;
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
      minimap: {
        enabled: true,
        renderCharacters: false,
        maxColumn: 60,
        showSlider: 'mouseover',
        size: 'fit',
      },
      fontSize: 12,
      lineNumbers: 'on',
      glyphMargin: false,
      lineNumbersMinChars: 1,
      lineDecorationsWidth: 48,
      scrollBeyondLastLine: false,
      wordWrap: wordWrap ? 'on' : 'off',
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      scrollbar: { vertical: 'hidden', verticalScrollbarSize: 0 },
      guides: { highlightActiveIndentation: 'always' },
    }),
    [editable, sideBySide, wordWrap],
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
        <div ref={monacoWrapRef} className="absolute inset-0">
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
