import React from 'react';
import { DiffEditor as MonacoDiffEditor } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { LoadState } from './useFileLoad';

interface Props {
  displayed: LoadState;
  currentState: LoadState;
  isCommitView: boolean;
  draft: string;
  editable: boolean;
  themeName: string;
  wordWrap: boolean;
  beforeMount(monaco: typeof import('monaco-editor')): void;
  onMount(editor: monacoEditor.IStandaloneDiffEditor, monaco: typeof import('monaco-editor')): void;
  /** Caller passes a ref-callback so it can render comment widgets and the
   *  inline-input popover into the editor area. */
  areaRef: (el: HTMLDivElement | null) => void;
  /** Extra children rendered inside the editor area (after Monaco). Used for
   *  the loading pill, save button, comment widgets, etc. */
  children?: React.ReactNode;
}

export function EditorViewport({
  displayed,
  currentState,
  isCommitView,
  draft,
  editable,
  themeName,
  wordWrap,
  beforeMount,
  onMount,
  areaRef,
  children,
}: Props) {
  return (
    <div ref={areaRef} className="flex-1 relative overflow-hidden">
      {currentState.kind === 'loading' && displayed.kind !== 'loaded' && (
        <div className="flex items-center justify-center h-full">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-[13px] text-muted-foreground/50">Loading…</span>
          </div>
        </div>
      )}
      {currentState.kind === 'error' && (
        <div className="flex items-center justify-center h-full">
          <span className="text-[13px] text-destructive">{currentState.message}</span>
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
          beforeMount={beforeMount}
          original={displayed.originalContent}
          modified={isCommitView ? displayed.modifiedContent : draft}
          language={displayed.language || undefined}
          theme={themeName}
          options={{
            originalEditable: false,
            readOnly: !editable,
            renderSideBySide: false,
            compactMode: true,
            renderGutterMenu: false,
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
            lineNumbersMinChars: 1,
            lineDecorationsWidth: 20,
            scrollBeyondLastLine: false,
            wordWrap: wordWrap ? 'on' : 'off',
            overviewRulerBorder: false,
            overviewRulerLanes: 0,
            scrollbar: { vertical: 'hidden', verticalScrollbarSize: 0 },
            guides: { highlightActiveIndentation: 'always' },
          }}
          onMount={onMount}
        />
      )}
      {children}
    </div>
  );
}
