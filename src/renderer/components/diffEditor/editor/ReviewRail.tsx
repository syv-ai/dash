import { useEffect, useMemo, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { DiffComment, PrReviewThread } from '../../../../shared/types';
import { Bot, CircleCheck, MessageSquare, type LucideIcon } from 'lucide-react';
import { ScrollRail, type RailTick } from '../../ui/ScrollRail';
import type { RichTooltip } from '../../ui/Tooltip';
import {
  railChanges,
  railMarks,
  type RailChange,
  type RailLineChange,
  type RailMark,
  type RailMarkKind,
} from './railMarks';

const TICK: Record<RailMarkKind, RailTick> = {
  thread: 'strong',
  resolved: 'faint',
  comment: 'solid',
  note: 'hollow',
};

/** The hover card's title and icon per kind. */
const KIND: Record<RailMarkKind, { title: string; icon: LucideIcon }> = {
  thread: { title: 'Thread', icon: MessageSquare },
  resolved: { title: 'Resolved thread', icon: CircleCheck },
  comment: { title: 'Your comment', icon: MessageSquare },
  note: { title: 'Note to agent', icon: Bot },
};

/** A tick's hover: what it is, the line and who wrote it, then its words. */
function markTip(m: RailMark): RichTooltip {
  const isThread = m.kind === 'thread' || m.kind === 'resolved';
  return {
    ...KIND[m.kind],
    rows: [{ label: 'Line', value: m.line }, ...(isThread ? [{ label: 'By', value: m.who }] : [])],
    body: m.text || '(no text)',
  };
}

/** A change segment's name: what happened, and where. */
function changeLabel(c: RailChange): string {
  if (c.kind === 'del')
    return c.startLine > 0 ? `Removed after L${c.startLine}` : 'Removed at the top';
  const lines = c.endLine > c.startLine ? `L${c.startLine}–${c.endLine}` : `L${c.startLine}`;
  return `${c.kind === 'add' ? 'Added' : 'Changed'} ${lines}`;
}

interface Layout {
  height: number;
  scrollbar: number;
  contentHeight: number;
}

/**
 * Where the open file's changes, PR threads, comment drafts and notes are, on
 * a rail at the modified editor's right edge, beside its scrollbar (D80): the
 * diff's changes as segments, the rest as ticks on top. Monaco's diff editor
 * forces the minimap off, so this stands in for minimap marks. A click
 * centres the line; hovering previews it.
 */
export function ReviewRail({
  diffEditor,
  modifiedEditor,
  monaco,
  threads,
  comments,
}: {
  /** The diff whose changes the rail draws; side by side and inline alike. */
  diffEditor: monacoEditor.IStandaloneDiffEditor | null;
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

  // The diff's changes, recomputed by Monaco on every edit and model swap.
  const [lineChanges, setLineChanges] = useState<readonly RailLineChange[]>([]);
  useEffect(() => {
    if (!diffEditor) return;
    const read = () => setLineChanges(diffEditor.getLineChanges() ?? []);
    read();
    const sub = diffEditor.onDidUpdateDiff(read);
    return () => sub.dispose();
  }, [diffEditor]);

  const spans = useMemo(() => {
    if (!modifiedEditor || !monaco || !layout) return [];
    return railChanges(lineChanges, {
      topFor: (line) => modifiedEditor.getTopForLineNumber(line),
      lineHeight: modifiedEditor.getOption(monaco.editor.EditorOption.lineHeight),
      contentHeight: layout.contentHeight,
      railHeight: layout.height,
    }).map((c) => ({
      key: `${c.kind}:${c.startLine}`,
      at: c.at,
      size: c.size,
      tone: c.kind,
      label: changeLabel(c),
      onSelect: () => {
        const line = Math.max(1, c.kind === 'del' ? c.startLine + 1 : c.startLine);
        modifiedEditor.revealLineInCenter(line, monaco.editor.ScrollType.Smooth);
        modifiedEditor.setPosition({ lineNumber: line, column: 1 });
        modifiedEditor.focus();
      },
    }));
  }, [modifiedEditor, monaco, layout, lineChanges]);

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
      tip: markTip(m),
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
      aria-label="Changes, threads, comments and notes in this file"
      marks={marks}
      spans={spans}
      height={layout.height}
      right={layout.scrollbar}
    />
  );
}
