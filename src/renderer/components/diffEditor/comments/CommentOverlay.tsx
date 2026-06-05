import { useCallback, useEffect, useMemo, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { LineRange, LiveComment, Shade } from './types';
import { assignShades } from './shadeAssignment';
import { commentIdsAtLine } from './rowShades';
import { BubbleStack } from './BubbleStack';
import { CommentIcon } from './CommentIcon';
import { DraftBubble } from './DraftBubble';

interface Props {
  liveComments: LiveComment[];
  modifiedEditor: monacoEditor.ICodeEditor | null;
  monaco: typeof import('monaco-editor') | null;
  area: HTMLDivElement | null;
  /** Hovered comment id, lifted to EditorPane so the band-rendering effect
   *  can intensify the rows owned by the hovered comment. */
  hoveredId: string | null;
  onHoveredIdChange(id: string | null): void;
  /** Dbl-click on a bubble → request EditorPane to open the draft pre-
   *  filled with that comment's text. */
  onEditComment(comment: LiveComment): void;
  /** When non-null, the overlay renders a DraftBubble at the range's
   *  start line — for both fresh creation and editing. */
  pendingRange: LineRange | null;
  /** Prefilled text for the draft (empty for new comments). */
  pendingText: string;
  /** When set, the persisted bubble for this id is hidden (the draft is
   *  taking its place). */
  editingId: string | null;
  onSubmitDraft(text: string): void;
  onCancelDraft(): void;
  /** Bubble width as a fraction of the editor's content width. */
  bubbleWidthFraction?: number;
}

interface Group {
  /** Stable key — same (startLine, endLine) → same key across renders. */
  key: string;
  anchorLine: number;
  comments: LiveComment[];
}

const DEFAULT_BUBBLE_FRACTION = 0.4;
const TAIL_OVERHANG_PX = 7;
const ICON_HEIGHT_PX = 16;

/** Renders one bubble-stack + one icon per anchor group. Groups are formed
 *  by IDENTICAL (startLine, endLine) — partial overlap does NOT stack;
 *  only same-anchor comments share a trigger. */
export function CommentOverlay({
  liveComments,
  modifiedEditor,
  monaco,
  area,
  hoveredId,
  onHoveredIdChange,
  onEditComment,
  pendingRange,
  pendingText,
  editingId,
  onSubmitDraft,
  onCancelDraft,
  bubbleWidthFraction = DEFAULT_BUBBLE_FRACTION,
}: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  // Live-range projection (line numbers track edits via Monaco stickiness).
  // The comment being edited is filtered out — its DraftBubble takes the
  // visual slot instead.
  const projected = useMemo<LiveComment[]>(() => {
    const model = modifiedEditor?.getModel();
    if (!modifiedEditor || !model) return [];
    return liveComments.flatMap((c) => {
      if (c.id === editingId) return [];
      const r = model.getDecorationRange(c.decorationId);
      if (!r) return [];
      return [{ ...c, startLine: r.startLineNumber, endLine: r.endLineNumber }];
    });
  }, [liveComments, modifiedEditor, editingId]);

  const shadeById = useMemo<Map<string, Shade>>(() => assignShades(projected), [projected]);

  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, LiveComment[]>();
    for (const c of projected) {
      const k = `${c.startLine}:${c.endLine}`;
      const list = byKey.get(k);
      if (list) list.push(c);
      else byKey.set(k, [c]);
    }
    return Array.from(byKey.entries())
      .map(([key, comments]) => ({ key, anchorLine: comments[0].startLine, comments }))
      .sort((a, b) => a.anchorLine - b.anchorLine);
  }, [projected]);

  // Re-render on scroll / resize so absolute positions track Monaco.
  const [, bumpLayout] = useState(0);
  useEffect(() => {
    if (!modifiedEditor) return;
    const s = modifiedEditor.onDidScrollChange(() => bumpLayout((n) => n + 1));
    const l = modifiedEditor.onDidLayoutChange(() => bumpLayout((n) => n + 1));
    return () => {
      s.dispose();
      l.dispose();
    };
  }, [modifiedEditor]);

  // Row-hover with ambiguity negation. The bubble's own mouseenter/leave
  // (always unambiguous) sets the id directly; row-hover only sets it when
  // exactly one comment claims the line, and clears it otherwise so a
  // previous single-owner highlight doesn't bleed onto an overlap row.
  useEffect(() => {
    if (!modifiedEditor) return;
    const move = modifiedEditor.onMouseMove((e) => {
      const line = e.target?.position?.lineNumber;
      if (!line) return;
      const ids = commentIdsAtLine(projected, line);
      onHoveredIdChange(ids.length === 1 ? ids[0] : null);
    });
    const leave = modifiedEditor.onMouseLeave(() => onHoveredIdChange(null));
    return () => {
      move.dispose();
      leave.dispose();
    };
  }, [modifiedEditor, projected, onHoveredIdChange]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (!area || !modifiedEditor || !monaco) return null;
  if (groups.length === 0 && !pendingRange) return null;
  const layout = modifiedEditor.getLayoutInfo();
  const scrollTop = modifiedEditor.getScrollTop();
  const lineHeight = modifiedEditor.getOption(monaco.editor.EditorOption.lineHeight) as number;

  const iconLeft = layout.decorationsLeft + 4;
  const contentLeft = layout.contentLeft;
  const bubbleLeft = contentLeft - 10;
  const bubbleWidth = Math.round(layout.contentWidth * bubbleWidthFraction);
  // Tail tip x (in editor-area coords) should equal contentLeft (first
  // char of code). Tip is at the center of a 14px-wide triangle, so the
  // triangle's left within the bubble is: (contentLeft - bubbleLeft) - 7.
  const tailLeftPx = contentLeft - bubbleLeft - 7;

  return (
    <>
      {groups.map(({ key, anchorLine, comments }) => {
        const anchorTop = modifiedEditor.getTopForLineNumber(anchorLine) - scrollTop;
        const isCollapsed = collapsed.has(key);
        const stacked = comments.length >= 2;
        const iconShade: Shade | null = stacked ? null : (shadeById.get(comments[0].id) ?? 1);

        return (
          <div key={key}>
            {/* Bubble column — zero-height anchor at (anchorTop - tailOverhang);
                inner div sits with bottom: 0 so the stack extends UPWARD,
                bubble-bottom-edge lands at the tail tip's y, and the tail's
                tip is at anchorTop. */}
            {!isCollapsed && (
              <div
                className="absolute"
                style={{
                  top: anchorTop - TAIL_OVERHANG_PX,
                  left: 0,
                  right: 0,
                  height: 0,
                  pointerEvents: 'none',
                }}
              >
                <div
                  className="absolute"
                  style={{
                    bottom: 0,
                    left: bubbleLeft,
                    width: bubbleWidth,
                    pointerEvents: 'auto',
                  }}
                >
                  <BubbleStack
                    comments={comments}
                    shadeById={shadeById}
                    hoveredId={hoveredId}
                    tailLeftPx={tailLeftPx}
                    onBubbleHover={onHoveredIdChange}
                    onEdit={onEditComment}
                  />
                </div>
              </div>
            )}
            {/* Trigger icon — vertically centered in the anchor row's gutter. */}
            <div
              className="absolute"
              style={{
                top: anchorTop + (lineHeight - ICON_HEIGHT_PX) / 2,
                left: iconLeft,
                pointerEvents: 'auto',
              }}
            >
              <CommentIcon
                shade={iconShade}
                state={isCollapsed ? 'collapsed' : 'expanded'}
                count={stacked ? comments.length : undefined}
                onClick={() => toggleGroup(key)}
                onMouseEnter={() => !stacked && onHoveredIdChange(comments[0].id)}
                onMouseLeave={() => !stacked && onHoveredIdChange(null)}
                title={stacked ? `Toggle ${comments.length} comments` : 'Toggle comment'}
              />
            </div>
          </div>
        );
      })}
      {pendingRange &&
        (() => {
          const draftTop = modifiedEditor.getTopForLineNumber(pendingRange.start) - scrollTop;
          return (
            <div
              className="absolute"
              style={{
                top: draftTop - TAIL_OVERHANG_PX,
                left: 0,
                right: 0,
                height: 0,
                pointerEvents: 'none',
              }}
            >
              <div
                className="absolute"
                style={{
                  bottom: 0,
                  left: bubbleLeft,
                  width: bubbleWidth,
                  pointerEvents: 'auto',
                }}
              >
                <DraftBubble
                  range={pendingRange}
                  initialText={pendingText}
                  tailLeftPx={tailLeftPx}
                  onSubmit={onSubmitDraft}
                  onCancel={onCancelDraft}
                />
              </div>
            </div>
          );
        })()}
    </>
  );
}
