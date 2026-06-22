import { useCallback, useEffect, useRef, useState } from 'react';
import type { ITheme as XtermTheme } from '@xterm/xterm';
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
  /** The diff editor instance, exposed as state so dependent hooks/effects
   *  re-run on the post-mount render. `null` until handleMount fires. */
  editor: monacoEditor.IStandaloneDiffEditor | null;
  monaco: typeof import('monaco-editor') | null;
  themeName: string;
  /** Stable across the most recent loaded/error state so the editor stays
   *  mounted while the next file loads (no flash). */
  displayed: LoadState;
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
  const onSaveRef = useRef(args.onSave);
  onSaveRef.current = args.onSave;
  const onDraftChangeRef = useRef(args.onDraftChange);
  onDraftChangeRef.current = args.onDraftChange;
  const isCommitViewRef = useRef(args.isCommitView);
  isCommitViewRef.current = args.isCommitView;
  // Theme args are read inside handleMount/beforeMount via refs so changing
  // them post-mount doesn't rebuild those callbacks (and so re-render
  // doesn't trip the `themeName` re-apply effect with stale closures).
  const themeArgsRef = useRef({ isDark: args.isDark, terminalTheme: args.terminalTheme });
  themeArgsRef.current = { isDark: args.isDark, terminalTheme: args.terminalTheme };

  const themeName = themeNameFor(args.isDark);

  // Editor + monaco live in state, not refs: dependent hooks
  // (useGutterSelection, useFileComments, decoration effects) need a
  // reactive signal to re-run after mount.
  const [editor, setEditor] = useState<monacoEditor.IStandaloneDiffEditor | null>(null);
  const [monaco, setMonaco] = useState<typeof import('monaco-editor') | null>(null);

  // The diff editor's two TextModels, captured at mount so we can dispose them
  // ourselves on unmount (EditorViewport passes keepCurrent*Model so the
  // library doesn't — its disposal order is buggy). See the unmount effect.
  const modelsRef = useRef<{
    original: monacoEditor.ITextModel;
    modified: monacoEditor.ITextModel;
  } | null>(null);

  // Keep the most recently loaded state alive so the editor doesn't unmount
  // mid-switch. Mutating a ref during render is intentional here — `displayed`
  // is always a recent snapshot of `state`.
  const lastLoadedRef = useRef<LoadState>({ kind: 'loading' });
  if (args.state.kind === 'loaded' || args.state.kind === 'error') {
    lastLoadedRef.current = args.state;
  }
  const displayed = lastLoadedRef.current;

  const handleBeforeMount = useCallback((monacoApi: typeof import('monaco-editor')) => {
    const { isDark, terminalTheme } = themeArgsRef.current;
    defineMonacoThemeFromTerminal(monacoApi, themeNameFor(isDark), isDark, terminalTheme);
    monacoApi.editor.setTheme(themeNameFor(isDark));
  }, []);

  const handleMount = useCallback(
    (ed: monacoEditor.IStandaloneDiffEditor, monacoApi: typeof import('monaco-editor')) => {
      const { isDark, terminalTheme } = themeArgsRef.current;
      defineMonacoThemeFromTerminal(monacoApi, themeNameFor(isDark), isDark, terminalTheme);
      monacoApi.editor.setTheme(themeNameFor(isDark));

      const diffModel = ed.getModel();
      if (diffModel) {
        modelsRef.current = { original: diffModel.original, modified: diffModel.modified };
      }

      const modified = ed.getModifiedEditor();
      modified.onDidChangeModelContent(() => {
        if (!isCommitViewRef.current) onDraftChangeRef.current(modified.getValue());
      });
      ed.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => {
        onSaveRef.current();
      });
      setMonaco(monacoApi);
      setEditor(ed);
    },
    [],
  );

  // Dispose the diff models on unmount. Deferred to a macrotask so it runs
  // AFTER the library's synchronous widget disposal — guaranteeing the order
  // is widget-reset-then-model-dispose (the reverse is the library's bug).
  useEffect(
    () => () => {
      const models = modelsRef.current;
      modelsRef.current = null;
      if (!models) return;
      setTimeout(() => {
        models.original.dispose();
        models.modified.dispose();
      }, 0);
    },
    [],
  );

  // Re-apply theme on terminal-theme change after mount.
  useEffect(() => {
    if (!monaco) return;
    defineMonacoThemeFromTerminal(monaco, themeName, args.isDark, args.terminalTheme);
    monaco.editor.setTheme(themeName);
  }, [monaco, themeName, args.isDark, args.terminalTheme]);

  return { editor, monaco, themeName, displayed, handleBeforeMount, handleMount };
}
