import { useEffect, useRef } from 'react';
import type { editor as monacoEditor, IDisposable } from 'monaco-editor';
import type { LineRange } from '../../../../shared/showFile';

interface Args {
  editor: monacoEditor.ICodeEditor | null;
  monaco: typeof import('monaco-editor') | null;
  /** The lines `dashctl show` asked for, and the show they came with. */
  lines: LineRange | null;
  nonce: number | null;
  /** The file is loaded and on screen. */
  ready: boolean;
}

/**
 * Lines `dashctl show` points at: scrolled to the centre, the cursor at their
 * start, and a calm whole-line wash on the selection token (`.monaco-shown-line`).
 * Applied once per show, without taking keyboard focus (the person may be
 * typing elsewhere). The wash stays until the person clicks or types in the
 * editor, edits the file, or it shows another one.
 */
export function useShownLines({ editor, monaco, lines, nonce, ready }: Args): void {
  const applied = useRef<number | null>(null);
  const wash = useRef<{ clear(): void } | null>(null);

  useEffect(() => () => wash.current?.clear(), []);

  useEffect(() => {
    if (!editor || !monaco || !lines || nonce === null || !ready) return;
    if (applied.current === nonce) return;
    applied.current = nonce;
    wash.current?.clear();
    const decorations = editor.createDecorationsCollection([
      {
        range: new monaco.Range(lines.start, 1, lines.end, 1),
        options: {
          isWholeLine: true,
          className: 'monaco-shown-line',
          marginClassName: 'monaco-shown-line-margin',
        },
      },
    ]);
    editor.setPosition({ lineNumber: lines.start, column: 1 });
    editor.revealLinesInCenter(lines.start, lines.end, monaco.editor.ScrollType.Smooth);
    const subs: IDisposable[] = [];
    const clear = () => {
      decorations.clear();
      for (const s of subs) s.dispose();
      wash.current = null;
    };
    subs.push(
      editor.onDidChangeCursorPosition((e) => {
        if (e.source === 'mouse' || e.source === 'keyboard') clear();
      }),
      editor.onDidChangeModelContent(clear),
      editor.onDidChangeModel(clear),
    );
    wash.current = { clear };
  }, [editor, monaco, lines, nonce, ready]);
}
