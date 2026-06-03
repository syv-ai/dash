import { useCallback, useEffect, useRef, useState } from 'react';
import type { ITheme as XtermTheme } from 'xterm';
import type { editor as monacoEditor } from 'monaco-editor';
import { defineMonacoThemeFromTerminal, themeNameFor } from '../monacoTheme';
import type { LoadState } from './useFileLoad';

interface Args {
  isDark: boolean;
  terminalTheme: XtermTheme;
  state: LoadState;
  onSave(): void;
  onDraftChange(value: string): void;
  isCommitView: boolean;
}

interface Api {
  editorRef: React.MutableRefObject<monacoEditor.IStandaloneDiffEditor | null>;
  monacoRef: React.MutableRefObject<typeof import('monaco-editor') | null>;
  themeName: string;
  /** Stable across the most recent loaded/error state so the editor stays
   *  mounted while the next file loads (no flash). */
  displayed: LoadState;
  /** Bumps on every mount; expose so hooks that read editorRef can re-run
   *  on the post-mount render. */
  mountSeq: number;
  handleBeforeMount(monaco: typeof import('monaco-editor')): void;
  handleMount(
    editor: monacoEditor.IStandaloneDiffEditor,
    monaco: typeof import('monaco-editor'),
  ): void;
}

/** Owns the Monaco mount lifecycle plus the no-flash mechanics. Defines the
 *  theme in beforeMount so the first paint matches; tracks the last loaded
 *  state in a ref so re-renders don't unmount the editor while a new file
 *  is loading. */
export function useMonacoEditor(args: Args): Api {
  const editorRef = useRef<monacoEditor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const onSaveRef = useRef(args.onSave);
  onSaveRef.current = args.onSave;
  const onDraftChangeRef = useRef(args.onDraftChange);
  onDraftChangeRef.current = args.onDraftChange;
  const isCommitViewRef = useRef(args.isCommitView);
  isCommitViewRef.current = args.isCommitView;

  const themeName = themeNameFor(args.isDark);
  const [mountSeq, setMountSeq] = useState(0);

  // Keep the most recently loaded state alive so the editor doesn't unmount
  // mid-switch. Mutating a ref during render is intentional here — `displayed`
  // is always a recent snapshot of `state`.
  const lastLoadedRef = useRef<LoadState>({ kind: 'loading' });
  if (args.state.kind === 'loaded' || args.state.kind === 'error') {
    lastLoadedRef.current = args.state;
  }
  const displayed = lastLoadedRef.current;

  const handleBeforeMount = useCallback(
    (monaco: typeof import('monaco-editor')) => {
      defineMonacoThemeFromTerminal(monaco, themeName, args.isDark, args.terminalTheme);
      monaco.editor.setTheme(themeName);
    },
    [themeName, args.isDark, args.terminalTheme],
  );

  const handleMount = useCallback(
    (editor: monacoEditor.IStandaloneDiffEditor, monaco: typeof import('monaco-editor')) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      defineMonacoThemeFromTerminal(monaco, themeName, args.isDark, args.terminalTheme);
      monaco.editor.setTheme(themeName);

      const modified = editor.getModifiedEditor();
      modified.onDidChangeModelContent(() => {
        if (!isCommitViewRef.current) onDraftChangeRef.current(modified.getValue());
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSaveRef.current();
      });
      setMountSeq((s) => s + 1);
    },
    [themeName, args.isDark, args.terminalTheme],
  );

  // Re-apply theme on terminal-theme change after mount.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineMonacoThemeFromTerminal(monaco, themeName, args.isDark, args.terminalTheme);
    monaco.editor.setTheme(themeName);
  }, [themeName, args.isDark, args.terminalTheme]);

  return { editorRef, monacoRef, themeName, displayed, mountSeq, handleBeforeMount, handleMount };
}
