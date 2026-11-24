import { useEffect, useRef } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { PrReviewThread } from '../../../../shared/types';
import { roleColor } from '../monacoTheme';

/**
 * The open file's PR threads as marks in the minimap's gutter lane, beside the
 * comment bands: unresolved at full strength, resolved faint. Neutral ink, read
 * from the page's tokens (Monaco's canvas can't read CSS variables), a frame
 * late so a theme switch has landed first.
 */
export function useThreadMinimapMarks({
  modifiedEditor,
  monaco,
  threads,
  isDark,
}: {
  modifiedEditor: monacoEditor.ICodeEditor | null;
  monaco: typeof import('monaco-editor') | null;
  /** The file's threads drawn on its lines (`isInlineThread`). */
  threads: readonly PrReviewThread[];
  isDark: boolean;
}): void {
  const marks = useRef<monacoEditor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    if (!modifiedEditor || !monaco) return;
    const collection = (marks.current ??= modifiedEditor.createDecorationsCollection());
    const frame = requestAnimationFrame(() => {
      const open = roleColor('--ink-2', isDark ? '#c4c6ca' : '#4b4e55');
      const resolved = roleColor('--ink-3', isDark ? '#74777c66' : '#82858d66', 0.4);
      collection.set(
        threads.flatMap((t) =>
          t.line === null
            ? []
            : [
                {
                  range: new monaco.Range(t.startLine ?? t.line, 1, t.line, 1),
                  options: {
                    isWholeLine: true,
                    minimap: {
                      color: t.resolved ? resolved : open,
                      position: monaco.editor.MinimapPosition.Gutter,
                    },
                  },
                },
              ],
        ),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [modifiedEditor, monaco, threads, isDark]);
}
