import React, { useEffect, useRef, useState } from 'react';
import { Bot, Copy, FileCode2, Hash, Link2, MessageSquare } from 'lucide-react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { DiffCommentKind } from '../../../../shared/types';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../ui/ContextMenu';
import { absolutePath, fileRef, type LineRange } from './fileRef';
import { IS_MAC, pressKind } from '../../../lib/mousePress';
import { copyText as copy } from '../fileActions';

interface Props {
  cwd: string;
  filePath: string;
  editor: monacoEditor.IStandaloneDiffEditor | null;
  /** Write a note or comment on the lines a right-click names (the file's
   *  modified side only); absent where comments are off. */
  compose?: Compose;
  /** The editor area. Must accept a ref (it becomes the right-click trigger). */
  children: React.ReactElement;
}

export interface Compose {
  /** A comment can be written here (a PR view); else it shows disabled with why. */
  canComment: boolean;
  onCompose: (lines: LineRange, kind: DiffCommentKind) => void;
}

interface Target {
  side: 'original' | 'modified';
  lines: LineRange | null;
  selectedText: string;
}

/** The lines a right-click refers to: the selection when the click landed in it,
 *  else the clicked line. A selection ending at column 1 stops on the line above. */
function targetLines(ed: monacoEditor.ICodeEditor, clickedLine: number | null): LineRange | null {
  const sel = ed.getSelection();
  if (sel && !sel.isEmpty()) {
    const end =
      sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber
        ? sel.endLineNumber - 1
        : sel.endLineNumber;
    const inside =
      clickedLine === null || (clickedLine >= sel.startLineNumber && clickedLine <= end);
    if (inside) return { start: sel.startLineNumber, end };
  }
  return clickedLine === null ? null : { start: clickedLine, end: clickedLine };
}

/**
 * Right-click menu for the diff editor: add a comment or a note on the
 * selection or the clicked line (D-R2d: Add comment stays, disabled, outside
 * a PR view); copy a `path:line` reference, the relative or absolute path, or
 * the selected text. Replaces Monaco's own menu, which is turned off.
 */
export function EditorContextMenu({ cwd, filePath, editor, compose, children }: Props) {
  const lastClick = useRef<{ side: Target['side']; line: number | null } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);

  // Remember which side and line the latest right-click hit; the menu reads it
  // when it opens (Monaco's mousedown fires before the DOM contextmenu event).
  useEffect(() => {
    if (!editor) return;
    const subs = (['original', 'modified'] as const).map((side) => {
      const ed = side === 'original' ? editor.getOriginalEditor() : editor.getModifiedEditor();
      return ed.onMouseDown((e) => {
        if (pressKind(e.event.browserEvent, IS_MAC) === 'context') {
          lastClick.current = { side, line: e.target.position?.lineNumber ?? null };
        }
      });
    });
    return () => subs.forEach((s) => s.dispose());
  }, [editor]);

  function onOpenChange(open: boolean) {
    if (!open || !editor) return;
    const click = lastClick.current ?? { side: 'modified' as const, line: null };
    lastClick.current = null;
    const ed = click.side === 'original' ? editor.getOriginalEditor() : editor.getModifiedEditor();
    const sel = ed.getSelection();
    const model = ed.getModel();
    setTarget({
      side: click.side,
      lines: targetLines(ed, click.line),
      selectedText: sel && model && !sel.isEmpty() ? model.getValueInRange(sel) : '',
    });
  }

  const ref = target ? fileRef(filePath, target.lines) : filePath;
  const base = target?.side === 'original' ? ' (base)' : '';

  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        {compose && target?.side === 'modified' && target.lines && (
          <ComposeItems compose={compose} lines={target.lines} />
        )}
        {target?.lines && (
          <ContextMenuItem onSelect={() => copy(ref, 'reference')}>
            <Hash size={13} strokeWidth={1.8} className="text-icon" />
            <span className="flex-1">Copy path:line{base}</span>
            <span className="text-xs text-muted-fade-60 truncate max-w-48">
              :{ref.slice(filePath.length + 1)}
            </span>
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => copy(filePath, 'relative path')}>
          <FileCode2 size={13} strokeWidth={1.8} className="text-icon" />
          Copy relative path
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copy(absolutePath(cwd, filePath), 'absolute path')}>
          <Link2 size={13} strokeWidth={1.8} className="text-icon" />
          Copy absolute path
        </ContextMenuItem>
        {target?.selectedText && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => copy(target.selectedText, 'selection')}>
              <Copy size={13} strokeWidth={1.8} className="text-icon" />
              Copy
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ComposeItems({ compose, lines }: { compose: Compose; lines: LineRange }) {
  return (
    <>
      <ContextMenuItem
        disabled={!compose.canComment}
        onSelect={() => compose.onCompose(lines, 'comment')}
      >
        <MessageSquare size={14} strokeWidth={1.8} className="text-icon" />
        <span className="flex-1">Add comment here</span>
        {!compose.canComment && <span className="type-caption">Comments need a pull request</span>}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => compose.onCompose(lines, 'note')}>
        <Bot size={14} strokeWidth={1.8} className="text-icon" />
        Add note here
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  );
}
