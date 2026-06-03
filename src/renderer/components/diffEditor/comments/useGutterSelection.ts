import { useEffect, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { LineRange } from './types';

/** Owns the click-and-drag-on-line-numbers selection mechanic. Returns the
 *  pending range and a `dragging` flag (used by the popover open gate so it
 *  doesn't steal focus mid-drag). */
export function useGutterSelection(
  editor: monacoEditor.IStandaloneCodeEditor | null,
  monaco: typeof import('monaco-editor') | null,
  enabled: boolean,
) {
  const [pendingRange, setPendingRange] = useState<LineRange | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startLine: number } | null>(null);

  useEffect(() => {
    if (!editor || !monaco || !enabled) return;

    const onMouseDown = editor.onMouseDown((e) => {
      const t = e.target;
      if (
        t.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS &&
        t.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS &&
        t.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
      )
        return;
      const line = t.position?.lineNumber;
      if (!line) return;
      dragRef.current = { startLine: line };
      setDragging(true);
      setPendingRange({ start: line, end: line });
    });

    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
      const line = target?.position?.lineNumber;
      if (!line) return;
      const start = Math.min(dragRef.current.startLine, line);
      const end = Math.max(dragRef.current.startLine, line);
      setPendingRange({ start, end });
    };
    const onUp = () => {
      if (dragRef.current) setDragging(false);
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      onMouseDown.dispose();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [editor, monaco, enabled]);

  return {
    pendingRange,
    setPendingRange,
    dragging,
  };
}
