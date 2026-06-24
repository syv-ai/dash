import { useCallback, useEffect, useMemo, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { LineRange, LiveComment, Shade } from '../types';
import { commentIdsAtLine } from '../rowShades';
import { BubbleStack } from '../BubbleStack';
import { CommentIcon } from '../CommentIcon';
import { DraftBubble } from '../DraftBubble';
import { useViewzones, VIEWZONE_TOP_PAD_PX, type ViewzoneGroup } from './useViewzones';

interface Props {
  liveComments: LiveComment[];
  /** Shared shade assignment (from useCommentShades) — same map the band
   *  decorations use, so bubbles and bands never disagree on colour. */
  shadeById: ReadonlyMap<string, Shade>;
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
  /** Click the × on a bubble → permanently delete that comment. */
  onDeleteComment(id: string): void;
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
  /** Origin tag for every bubble (e.g. 'Commit abc1234') when the open view
   *  isn't the plain working tree; undefined otherwise. */
  scopeLabel?: string;
  /** Bubble width as a fraction of the editor's content width. */
  bubbleWidthFraction?: number;
}

const DEFAULT_BUBBLE_FRACTION = 0.4;
const ICON_HEIGHT_PX = 16;

/** Renders one bubble-stack + one icon per anchor group. Groups are formed
 *  by IDENTICAL (startLine, endLine) — partial overlap does NOT stack;
 *  only same-anchor comments share a trigger. The Monaco view-zone lifecycle
 *  (reserve space, measure, animate, position) lives in useViewzones; this
 *  component is rendering + geometry only. */
export function CommentOverlay({
  liveComments,
  shadeById,
  modifiedEditor,
  monaco,
  area,
  hoveredId,
  onHoveredIdChange,
  onEditComment,
  onDeleteComment,
  pendingRange,
  pendingText,
  editingId,
  onSubmitDraft,
  onCancelDraft,
  scopeLabel,
  bubbleWidthFraction = DEFAULT_BUBBLE_FRACTION,
}: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  // liveComments already carry live ranges (useFileComments re-projects on
  // edits), and shadeById is the shared single shade assignment. The comment
  // being edited stays in the list — the persisted bubble renders with opacity
  // 0 while the DraftBubble crossfades in beside it, both sharing the same
  // viewzone wrapper, so the read-only → editable transition morphs in place.
  const groups = useMemo<ViewzoneGroup[]>(() => {
    const byKey = new Map<string, LiveComment[]>();
    for (const c of liveComments) {
      const k = `${c.startLine}:${c.endLine}`;
      const list = byKey.get(k);
      if (list) list.push(c);
      else byKey.set(k, [c]);
    }
    return Array.from(byKey.entries())
      .map(([key, comments]) => ({ key, anchorLine: comments[0]!.startLine, comments }))
      .sort((a, b) => a.anchorLine - b.anchorLine);
  }, [liveComments]);

  // When editing an existing comment (editingId set), the draft reuses the
  // persisted group's zone key — so the draft target reuses the persisted
  // viewzone instead of triggering a remove+add (no flash). For fresh drafts
  // (gutter click, no editingId), a distinct `draft:` key creates a new zone.
  const draftKey = pendingRange
    ? editingId
      ? `${pendingRange.start}:${pendingRange.end}`
      : `draft:${pendingRange.start}:${pendingRange.end}`
    : null;

  // Owns the view-zone lifecycle + imperative bubble positioning + animation.
  const vz = useViewzones({ modifiedEditor, groups, collapsed, pendingRange, draftKey, editingId });

  // Row-hover with ambiguity negation. The bubble's own mouseenter/leave
  // (always unambiguous) sets the id directly; row-hover only sets it when
  // exactly one comment claims the line, and clears it otherwise so a
  // previous single-owner highlight doesn't bleed onto an overlap row.
  useEffect(() => {
    if (!modifiedEditor) return;
    const move = modifiedEditor.onMouseMove((e) => {
      const line = e.target?.position?.lineNumber;
      if (!line) return;
      const ids = commentIdsAtLine(liveComments, line);
      onHoveredIdChange(ids.length === 1 ? ids[0]! : null);
    });
    const leave = modifiedEditor.onMouseLeave(() => onHoveredIdChange(null));
    return () => {
      move.dispose();
      leave.dispose();
    };
  }, [modifiedEditor, liveComments, onHoveredIdChange]);

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
  // Bubble starts at the very left edge of the gutter (lineNumbersLeft is
  // 0 when there's no glyphMargin, which is our case). Width stays at the
  // configured fraction of the content area.
  const bubbleLeft = layout.lineNumbersLeft;
  const bubbleWidth = Math.round(layout.contentWidth * bubbleWidthFraction);
  // Tail tip should land at the first non-whitespace character of the
  // anchor line below — i.e. where the line's content actually starts
  // visually, not at indented whitespace. Computed per-anchor since
  // indentation differs per line. Falls back to contentLeft when the line
  // is entirely whitespace or getOffsetForColumn fails.
  const model = modifiedEditor.getModel();
  const tailLeftForAnchor = (anchorLine: number): number => {
    let tipX = contentLeft;
    if (model) {
      const col = model.getLineFirstNonWhitespaceColumn(anchorLine);
      if (col > 0) {
        const offset = modifiedEditor.getOffsetForColumn(anchorLine, col);
        if (offset > 0) tipX = offset;
      }
    }
    // Triangle is 14px wide; the tip is at its center, so subtract 7 from
    // the desired tip x to get the triangle's `left` within the bubble.
    return tipX - bubbleLeft - 7;
  };

  return (
    <>
      {/* Gutter icons — absolute overlay in editorAreaEl. These track
          scroll via the viewzone-driven re-render; they can't be portaled
          into the viewzone because they belong on the anchor row itself,
          not above it. */}
      {groups.map(({ key, anchorLine, comments }) => {
        const anchorTop = modifiedEditor.getTopForLineNumber(anchorLine) - scrollTop;
        const isCollapsed = collapsed.has(key);
        const stacked = comments.length >= 2;
        const iconShade: Shade | null = stacked ? null : (shadeById.get(comments[0]!.id) ?? 1);
        return (
          <div
            key={`icon-${key}`}
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
              onMouseEnter={() => !stacked && onHoveredIdChange(comments[0]!.id)}
              onMouseLeave={() => !stacked && onHoveredIdChange(null)}
              title={stacked ? `Toggle ${comments.length} comments` : 'Toggle comment'}
            />
          </div>
        );
      })}

      {/* Bubbles — rendered as React absolute overlays in editorAreaEl,
          OUTSIDE Monaco's DOM tree. Position + opacity are imperatively
          driven by the zone's onDomNodeTop / onComputedHeight callbacks via
          useViewzones — see VSCode's editor/contrib/zoneWidget for the same
          overlay-tracks-viewzone pattern. */}
      {groups.map(({ key, anchorLine, comments }) => {
        const tailLeftPx = tailLeftForAnchor(anchorLine);
        const isCollapsed = collapsed.has(key);
        // If this group contains the comment being edited, render the
        // DraftBubble alongside the BubbleStack inside the same wrapper.
        // The persisted bubble fades out (CommentBubble's own opacity
        // transition keyed off `editingId`), the DraftBubble fades in (CSS
        // `animate-fade-in`), and they overlap at the same top — read-only
        // morphs into editable in place, no DOM gap.
        const editingComment = comments.find((c) => c.id === editingId);
        return (
          <div
            key={`bubble-${key}`}
            ref={(el) => vz.registerWrapper(key, el)}
            className="absolute"
            style={{
              // top is imperatively driven by onDomNodeTop/onComputedHeight.
              // Start off-screen so the (briefly position-unknown) wrapper
              // can't flash in the wrong place on first mount.
              top: -9999,
              left: 0,
              right: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          >
            <div
              ref={(el) => vz.registerInner(key, el)}
              className="absolute"
              style={{
                top: VIEWZONE_TOP_PAD_PX,
                left: bubbleLeft,
                width: bubbleWidth,
                pointerEvents: isCollapsed ? 'none' : 'auto',
                // opacity is imperatively driven by onComputedHeight; start
                // at 0 and the CSS transition smooths the per-frame updates
                // into a single coherent fade-in.
                opacity: 0,
                transition: 'opacity 240ms ease-out',
              }}
            >
              <BubbleStack
                comments={comments}
                shadeById={shadeById}
                hoveredId={hoveredId}
                tailLeftPx={tailLeftPx}
                onBubbleHover={onHoveredIdChange}
                onEdit={onEditComment}
                onDelete={onDeleteComment}
                editingId={editingId}
                scopeLabel={scopeLabel}
              />
            </div>
            {editingComment && pendingRange && (
              <div
                ref={(el) => vz.attachDraftMeasure(`${key}@draft`, el)}
                className="absolute animate-fade-in"
                style={{
                  top: VIEWZONE_TOP_PAD_PX,
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
            )}
          </div>
        );
      })}

      {/* Standalone draft bubble — only for the new-comment-via-gutter
          case. Edit drafts render inside the group's wrapper above so they
          can crossfade with the persisted bubble. */}
      {pendingRange &&
        draftKey &&
        !editingId &&
        (() => {
          const tailLeftPx = tailLeftForAnchor(pendingRange.start);
          const k = draftKey;
          return (
            <div
              ref={(el) => vz.registerWrapper(k, el)}
              className="absolute"
              style={{
                top: -9999,
                left: 0,
                right: 0,
                height: 0,
                pointerEvents: 'none',
              }}
            >
              <div
                ref={(el) => vz.registerInner(k, el)}
                className="absolute"
                style={{
                  top: VIEWZONE_TOP_PAD_PX,
                  left: bubbleLeft,
                  width: bubbleWidth,
                  pointerEvents: 'auto',
                  opacity: 0,
                  transition: 'opacity 240ms ease-out',
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
