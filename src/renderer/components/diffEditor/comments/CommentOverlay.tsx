import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
// Conservative initial viewzone height before the bubble's actual height
// is measured. Just needs to be in the right ballpark so the first paint
// doesn't shift dramatically when ResizeObserver fires.
const INITIAL_BUBBLE_HEIGHT_PX = 96;
const INITIAL_DRAFT_HEIGHT_PX = 130;

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

  // ── View-zone management ─────────────────────────────────────────────
  // Reserve real empty space above each anchor line via Monaco's viewzone
  // API. Code shifts down to make room; the bubble overlay paints into
  // that empty space. This is what keeps the bubble from covering code
  // above and from getting clipped at the top of the editor.
  //
  // Each visible group + the draft (if any) maps to one viewzone keyed by
  // its stable key. Heights are MEASURED via ResizeObserver on the bubble's
  // wrapper div — the viewzone's heightInPx = measured + TAIL_OVERHANG_PX
  // so the tail's tip lands exactly at the first character of the anchor
  // line below.
  const draftKey = pendingRange ? `draft:${pendingRange.start}:${pendingRange.end}` : null;

  // The viewzone needs a DOM node (Monaco appends it into the editor's
  // internal layer to reserve space). We use a stable empty div per key —
  // it's just a spacer. The actual bubble UI is rendered as a React
  // overlay OUTSIDE Monaco's DOM (in editorAreaEl) so it doesn't get
  // tangled in Monaco's mouse/keyboard handling.
  const spacerNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const getOrCreateSpacerNode = (key: string): HTMLDivElement => {
    let node = spacerNodesRef.current.get(key);
    if (!node) {
      node = document.createElement('div');
      // Empty spacer — no pointer events; the overlay handles interaction.
      node.style.pointerEvents = 'none';
      spacerNodesRef.current.set(key, node);
    }
    return node;
  };

  const measuredHeightsRef = useRef<Map<string, number>>(new Map());
  const [measureNonce, setMeasureNonce] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.viewzoneKey;
        if (!key) continue;
        const h = Math.ceil(entry.contentRect.height);
        if (measuredHeightsRef.current.get(key) !== h) {
          measuredHeightsRef.current.set(key, h);
          changed = true;
        }
      }
      if (changed) setMeasureNonce((n) => n + 1);
    });
    observerRef.current = observer;
    return () => observer.disconnect();
  }, []);

  const attachMeasure = useCallback((key: string, el: HTMLDivElement | null) => {
    if (!el || !observerRef.current) return;
    el.dataset.viewzoneKey = key;
    observerRef.current.observe(el);
  }, []);

  // Refs to live IViewZone objects — we mutate heightInPx and call
  // accessor.layoutZone(id) for in-place updates so resize doesn't cause a
  // remove+add flash.
  type ZoneEntry = { id: string; zone: monacoEditor.IViewZone };
  const viewzonesRef = useRef<Map<string, ZoneEntry>>(new Map());

  // Per-key animation handles — requestAnimationFrame IDs for the
  // expand/collapse height tween. Mutating heightInPx + layoutZone every
  // frame yields smooth code-shift animations.
  const animationsRef = useRef<Map<string, number>>(new Map());

  const cancelAnimation = useCallback((key: string) => {
    const raf = animationsRef.current.get(key);
    if (raf !== undefined) {
      cancelAnimationFrame(raf);
      animationsRef.current.delete(key);
    }
  }, []);

  const animateHeight = useCallback(
    (key: string, from: number, to: number) => {
      if (!modifiedEditor) return;
      cancelAnimation(key);
      const start = performance.now();
      const duration = 280;
      const ease = (t: number) => 1 - Math.pow(1 - t, 3); // ease-out cubic
      const tick = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(1, elapsed / duration);
        const eased = ease(progress);
        const height = Math.round(from + (to - from) * eased);
        const entry = viewzonesRef.current.get(key);
        if (!entry) {
          animationsRef.current.delete(key);
          return;
        }
        entry.zone.heightInPx = height;
        modifiedEditor.changeViewZones((accessor) => {
          accessor.layoutZone(entry.id);
        });
        if (progress < 1) {
          animationsRef.current.set(key, requestAnimationFrame(tick));
        } else {
          animationsRef.current.delete(key);
        }
      };
      animationsRef.current.set(key, requestAnimationFrame(tick));
    },
    [modifiedEditor, cancelAnimation],
  );

  useEffect(() => {
    if (!modifiedEditor) return;
    type Target = {
      key: string;
      afterLineNumber: number;
      targetHeight: number;
      domNode: HTMLDivElement;
      isDraft: boolean;
    };
    const targets = new Map<string, Target>();
    for (const group of groups) {
      const measured = measuredHeightsRef.current.get(group.key) ?? INITIAL_BUBBLE_HEIGHT_PX;
      const isCollapsed = collapsed.has(group.key);
      targets.set(group.key, {
        key: group.key,
        afterLineNumber: Math.max(0, group.anchorLine - 1),
        targetHeight: isCollapsed ? 0 : measured + TAIL_OVERHANG_PX,
        domNode: getOrCreateSpacerNode(group.key),
        isDraft: false,
      });
    }
    if (pendingRange && draftKey) {
      const measured = measuredHeightsRef.current.get(draftKey) ?? INITIAL_DRAFT_HEIGHT_PX;
      targets.set(draftKey, {
        key: draftKey,
        afterLineNumber: Math.max(0, pendingRange.start - 1),
        targetHeight: measured + TAIL_OVERHANG_PX,
        domNode: getOrCreateSpacerNode(draftKey),
        isDraft: true,
      });
    }

    // Sync existence + afterLineNumber. New viewzones start at heightInPx
    // 0 so we can animate them to their target — see height-sync block
    // below.
    modifiedEditor.changeViewZones((accessor) => {
      // Remove viewzones whose key is no longer requested (delete event).
      for (const [key, entry] of viewzonesRef.current) {
        if (!targets.has(key)) {
          accessor.removeZone(entry.id);
          viewzonesRef.current.delete(key);
          spacerNodesRef.current.delete(key);
          cancelAnimation(key);
        }
      }
      // Add new viewzones at height 0 — height-sync below will animate them.
      for (const target of targets.values()) {
        if (viewzonesRef.current.has(target.key)) continue;
        const zone: monacoEditor.IViewZone = {
          afterLineNumber: target.afterLineNumber,
          heightInPx: target.isDraft ? target.targetHeight : 0,
          domNode: target.domNode,
        };
        const id = accessor.addZone(zone);
        viewzonesRef.current.set(target.key, { id, zone });
      }
      // Update afterLineNumber on existing entries (code shifted, etc).
      for (const target of targets.values()) {
        const entry = viewzonesRef.current.get(target.key);
        if (!entry) continue;
        if (entry.zone.afterLineNumber !== target.afterLineNumber) {
          entry.zone.afterLineNumber = target.afterLineNumber;
          accessor.layoutZone(entry.id);
        }
      }
    });

    // Height sync (outside changeViewZones): animate persisted comments
    // through expand/collapse and new-comment arrival; apply instantly for
    // draft + small adjustments (ResizeObserver natural-resize jiggle).
    for (const target of targets.values()) {
      const entry = viewzonesRef.current.get(target.key);
      if (!entry) continue;
      const currentHeight = entry.zone.heightInPx ?? 0;
      if (currentHeight === target.targetHeight) continue;
      const diff = Math.abs(currentHeight - target.targetHeight);
      if (target.isDraft || diff <= 24) {
        // Instant — draft never animates, and small natural-resize tweaks
        // shouldn't jiggle.
        entry.zone.heightInPx = target.targetHeight;
        modifiedEditor.changeViewZones((accessor) => {
          accessor.layoutZone(entry.id);
        });
      } else {
        animateHeight(target.key, currentHeight, target.targetHeight);
      }
    }
  }, [
    modifiedEditor,
    groups,
    collapsed,
    pendingRange,
    draftKey,
    measureNonce,
    animateHeight,
    cancelAnimation,
  ]);

  // Final cleanup — remove all viewzones on unmount or editor swap.
  useEffect(() => {
    return () => {
      if (!modifiedEditor) return;
      modifiedEditor.changeViewZones((accessor) => {
        for (const entry of viewzonesRef.current.values()) {
          accessor.removeZone(entry.id);
        }
        viewzonesRef.current.clear();
        spacerNodesRef.current.clear();
      });
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
          scroll via the bumpLayout-on-scroll re-render; they can't be
          portaled into the viewzone because they belong on the anchor
          row itself, not above it. */}
      {groups.map(({ key, anchorLine, comments }) => {
        const anchorTop = modifiedEditor.getTopForLineNumber(anchorLine) - scrollTop;
        const isCollapsed = collapsed.has(key);
        const stacked = comments.length >= 2;
        const iconShade: Shade | null = stacked ? null : (shadeById.get(comments[0].id) ?? 1);
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
              onMouseEnter={() => !stacked && onHoveredIdChange(comments[0].id)}
              onMouseLeave={() => !stacked && onHoveredIdChange(null)}
              title={stacked ? `Toggle ${comments.length} comments` : 'Toggle comment'}
            />
          </div>
        );
      })}

      {/* Bubbles — rendered as React absolute overlays in editorAreaEl,
          OUTSIDE Monaco's DOM tree. This keeps interactive content (the
          draft textarea especially) clear of Monaco's mouse/keyboard
          handling. The viewzone reserves space; the bubble paints into
          that space via getTopForLineNumber math. Always rendered (even
          when collapsed) so the wrapper stays measured and we can fade
          opacity in sync with the viewzone height animation. */}
      {groups.map(({ key, anchorLine, comments }) => {
        const anchorTop = modifiedEditor.getTopForLineNumber(anchorLine) - scrollTop;
        const tailLeftPx = tailLeftForAnchor(anchorLine);
        const isCollapsed = collapsed.has(key);
        return (
          <div
            key={`bubble-${key}`}
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
              ref={(el) => attachMeasure(key, el)}
              className="absolute"
              style={{
                bottom: 0,
                left: bubbleLeft,
                width: bubbleWidth,
                pointerEvents: isCollapsed ? 'none' : 'auto',
                opacity: isCollapsed ? 0 : 1,
                transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
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
        );
      })}

      {/* Draft bubble — same overlay treatment, anchored to the pending
          range's start line. */}
      {pendingRange &&
        draftKey &&
        (() => {
          const draftTop = modifiedEditor.getTopForLineNumber(pendingRange.start) - scrollTop;
          const tailLeftPx = tailLeftForAnchor(pendingRange.start);
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
                ref={(el) => attachMeasure(draftKey, el)}
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
