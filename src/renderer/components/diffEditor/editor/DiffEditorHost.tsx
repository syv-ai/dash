import { useEffect, useLayoutEffect, useRef } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import { monaco } from '../../../monaco-workers';

type Monaco = typeof import('monaco-editor');

interface Props {
  options: monacoEditor.IDiffEditorConstructionOptions;
  /** Before the widget exists (define the theme here, so the first paint matches). */
  beforeMount(monaco: Monaco): void;
  /** The widget exists, with no models yet: the pane gives it its models. */
  onMount(editor: monacoEditor.IStandaloneDiffEditor, monaco: Monaco): void;
  onUnmount(): void;
}

/**
 * A bare Monaco diff widget. Unlike @monaco-editor/react's, it never creates,
 * fills or disposes models: the pane sets them from `models.ts`, which shares
 * one model per working file across tabs and groups.
 */
export function DiffEditorHost({ options, beforeMount, onMount, onUnmount }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monacoEditor.IStandaloneDiffEditor | null>(null);
  // Mount-time inputs, read once; later option changes go through updateOptions.
  const mountArgs = useRef({ options, beforeMount, onMount, onUnmount });
  mountArgs.current = { options, beforeMount, onMount, onUnmount };

  // A layout effect, so the pane (whose layout effects run after its
  // children's) can give the widget its models in the same commit.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const args = mountArgs.current;
    args.beforeMount(monaco);
    const ed = monaco.editor.createDiffEditor(el, { automaticLayout: true, ...args.options });
    editorRef.current = ed;
    args.onMount(ed, monaco);
    return () => {
      mountArgs.current.onUnmount();
      editorRef.current = null;
      // Detach before disposing: the models outlive the widget (models.ts
      // disposes them later, if nothing else holds them).
      ed.setModel(null);
      ed.dispose();
    };
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions(options);
  }, [options]);

  return <div ref={elRef} className="h-full w-full" />;
}
