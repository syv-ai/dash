import { useEffect, useMemo, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { DiffComment, PrReviewThread } from '../../../../shared/types';
import { ScrollRail, type RailTick } from '../../ui/ScrollRail';
import { railMarks, type RailMarkKind } from './railMarks';

const TICK: Record<RailMarkKind, RailTick> = {
  thread: 'strong',
  resolved: 'faint',
  comment: 'solid',
  note: 'hollow',
};

interface Layout {
  height: number;
  scrollbar: number;
  contentHeight: number;
}

/**
 * Where the open file's PR threads, comment drafts and notes are, as ticks on
 * a rail at the modified editor's right edge, beside its scrollbar (D80).
 * Monaco's diff editor forces the minimap off, so this stands in for minimap
 * marks. A tick's click centres its line; hovering previews it.
 */
export function ReviewRail({
  modifiedEditor,
  monaco,
  threads,
  comments,
}: {
  modifiedEditor: monacoEditor.ICodeEditor | null;
  monaco: typeof import('monaco-editor') | null;
  /** The file's threads drawn on its lines. */
  threads: readonly PrReviewThread[];
  /** The file's line drafts and notes, at their live lines. */
  comments: readonly Pick<DiffComment, 'id' | 'kind' | 'startLine' | 'text'>[];
}) {
  const [layout, setLayout] = useState<Layout | null>(null);

  // The rail follows the editor's box and its content's height (wrapping,
  // view zones, folded regions all move lines).
  useEffect(() => {
    if (!modifiedEditor) return;
    const read = () => {
      const info = modifiedEditor.getLayoutInfo();
      setLayout({
        height: info.height,
        scrollbar: info.verticalScrollbarWidth,
        contentHeight: modifiedEditor.getScrollHeight(),
      });
    };
    read();
    const subs = [
      modifiedEditor.onDidLayoutChange(read),
      modifiedEditor.onDidContentSizeChange(read),
      modifiedEditor.onDidChangeModel(read),
    ];
    return () => subs.forEach((s) => s.dispose());
  }, [modifiedEditor]);

  const marks = useMemo(() => {
    if (!modifiedEditor || !monaco || !layout) return [];
    const lineHeight = modifiedEditor.getOption(monaco.editor.EditorOption.lineHeight);
    return railMarks(threads, comments, {
      topFor: (line) => modifiedEditor.getTopForLineNumber(line),
      lineHeight,
      contentHeight: layout.contentHeight,
      railHeight: layout.height,
    }).map((m) => ({
      key: m.id,
      at: m.at,
      tick: TICK[m.kind],
      label: m.preview,
      onSelect: () => {
        modifiedEditor.revealLineInCenter(m.line, monaco.editor.ScrollType.Smooth);
        modifiedEditor.setPosition({ lineNumber: m.line, column: 1 });
        modifiedEditor.focus();
      },
    }));
  }, [modifiedEditor, monaco, layout, threads, comments]);

  if (!layout) return null;
  return (
    <ScrollRail
      aria-label="Threads, comments and notes in this file"
      marks={marks}
      height={layout.height}
      right={layout.scrollbar}
    />
  );
}
