import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
const ICON_HEIGHT_PX = 16;
// Vertical padding inside the viewzone — asymmetric so the bubble sits
// closer to the code line above than to the anchor line below (the tail
// dangles into the lower pad, so it earns the extra space).
const VIEWZONE_TOP_PAD_PX = 8;
const VIEWZONE_BOTTOM_PAD_PX = 16;
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
  onDeleteComment,
  pendingRange,
  pendingText,
  editingId,
  onSubmitDraft,
  onCancelDraft,
  bubbleWidthFraction = DEFAULT_BUBBLE_FRACTION,
}: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  // Live-range projection (line numbers track edits via Monaco stickiness).
  // The comment being edited stays in the projection — the persisted bubble
  // renders with opacity 0 while the DraftBubble crossfades in beside it,
  // both sharing the same viewzone wrapper. That's what makes the read-only
  // → editable transition feel like the bubble morphs in place instead of
  // popping.
  const projected = useMemo<LiveComment[]>(() => {
    const model = modifiedEditor?.getModel();
    if (!modifiedEditor || !model) return [];
    return liveComments.flatMap((c) => {
      const r = model.getDecorationRange(c.decorationId);
      if (!r) return [];
      return [{ ...c, startLine: r.startLineNumber, endLine: r.endLineNumber }];
    });
  }, [liveComments, modifiedEditor]);

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

  // Re-render on scroll / resize / content-size change so absolute
  // positions track Monaco. onDidContentSizeChange fires when the editor's
  // total scrollable height changes — which happens on every viewzone
  // height mutation — so this is what drives the bubble overlay to follow
  // the viewzone smoothly during the animation tween.
  const [, bumpLayout] = useState(0);
  useEffect(() => {
    if (!modifiedEditor) return;
    const s = modifiedEditor.onDidScrollChange(() => bumpLayout((n) => n + 1));
    const l = modifiedEditor.onDidLayoutChange(() => bumpLayout((n) => n + 1));
    const c = modifiedEditor.onDidContentSizeChange(() => bumpLayout((n) => n + 1));
    return () => {
      s.dispose();
      l.dispose();
      c.dispose();
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
  // wrapper div — the viewzone's heightInPx = measured + 2 * vertical pad,
  // so the bubble ends up vertically centered with equal breathing room
  // above and below.
  // When editing an existing comment (editingId set), use the SAME key as
  // the persisted group's zone — so the draft target reuses the persisted
  // viewzone instead of triggering a remove+add. No Monaco layout pass with
  // the zone briefly missing, no flash. For fresh drafts (gutter click, no
  // editingId), keep a distinct key so a new zone is created.
  const draftKey = pendingRange
    ? editingId
      ? `${pendingRange.start}:${pendingRange.end}`
      : `draft:${pendingRange.start}:${pendingRange.end}`
    : null;

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

  // Previous editing-group set, used to detect edit ↔ read-only transitions
  // per group key. Height changes triggered by those transitions get the
  // smooth tween (so the viewzone visibly grows to accept the draft); other
  // height changes (submit, ResizeObserver wobble) stay instant.
  const wasEditingGroupKeysRef = useRef<Set<string>>(new Set());

  // Layout-callback bookkeeping. `IViewZone.onDomNodeTop` /
  // `.onComputedHeight` fire from Monaco's layout pass — i.e. the
  // authoritative moment when the zone's pixel position is known. We
  // imperatively re-position the bubble's wrapper from these callbacks,
  // which sidesteps the race where getTopForLineNumber() at React-render
  // time returns a stale value during an animation tween.
  //
  // This is the same pattern VSCode's editor/contrib/zoneWidget and
  // Theia's monaco-editor-zone-widget use for their inline-comment-style
  // widgets — viewzone reserves vertical space, an overlay tracks the
  // zone via the layout callbacks.
  const zoneTopsRef = useRef<Map<string, number>>(new Map());
  const zoneHeightsRef = useRef<Map<string, number>>(new Map());
  const bubbleWrapperRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const bubbleInnerRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const fullHeightForKey = useCallback((key: string): number => {
    const measured = measuredHeightsRef.current.get(key) ?? INITIAL_BUBBLE_HEIGHT_PX;
    return measured + VIEWZONE_TOP_PAD_PX + VIEWZONE_BOTTOM_PAD_PX;
  }, []);

  const applyBubbleTransform = useCallback(
    (key: string) => {
      const wrapper = bubbleWrapperRefs.current.get(key);
      const top = zoneTopsRef.current.get(key);
      const height = zoneHeightsRef.current.get(key);
      if (wrapper && top !== undefined && height !== undefined) {
        // Wrapper covers the entire viewzone box; the inner div is then
        // positioned with equal top/bottom padding to vertically center
        // the bubble inside the zone.
        wrapper.style.top = `${top}px`;
        wrapper.style.height = `${height}px`;
      }
      const inner = bubbleInnerRefs.current.get(key);
      if (inner && height !== undefined) {
        const full = fullHeightForKey(key);
        const opacity = full > 0 ? Math.max(0, Math.min(1, height / full)) : 0;
        inner.style.opacity = String(opacity);
      }
    },
    [fullHeightForKey],
  );

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
      const duration = 420;
      // ease-in-out cubic — symmetric, gentle at both ends. Pairs with
      // the CSS opacity transition on the bubble wrapper below.
      const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
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
        // layoutZone() doesn't reliably fire onDidLayoutChange, so the
        // bubble overlay (which reads heightInPx + getTopForLineNumber at
        // render-time) would freeze mid-tween. Force a re-render each
        // frame so opacity + Y position smoothly track the viewzone.
        bumpLayout((n) => n + 1);
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

  // useLayoutEffect (not useEffect) so the viewzone swap commits in the
  // same frame as the React DOM commit. Otherwise the browser would
  // paint between commit and useEffect, briefly showing the editor with
  // the just-unmounted bubble gone but the stale viewzone still
  // reserving its space — and that gap is what produced the "lines from
  // above flash overlaid at the comment's position" artifact on edit.
  useLayoutEffect(() => {
    if (!modifiedEditor) return;
    type Target = {
      key: string;
      afterLineNumber: number;
      targetHeight: number;
      domNode: HTMLDivElement;
      isDraft: boolean;
    };
    const targets = new Map<string, Target>();
    // Per-group: is this the group whose comment is currently being
    // edited? We expand its viewzone to fit max(persisted, draft) so the
    // crossfading DraftBubble — which is taller than a short comment —
    // doesn't overflow into the code line below the anchor.
    const editingGroupKeys = new Set<string>();
    for (const group of groups) {
      const persistedMeasured =
        measuredHeightsRef.current.get(group.key) ?? INITIAL_BUBBLE_HEIGHT_PX;
      const isCollapsed = collapsed.has(group.key);
      const isEditingGroup = !!editingId && group.comments.some((c) => c.id === editingId);
      if (isEditingGroup) editingGroupKeys.add(group.key);
      const draftMeasured = isEditingGroup
        ? (measuredHeightsRef.current.get(`${group.key}@draft`) ?? INITIAL_DRAFT_HEIGHT_PX)
        : 0;
      const measured = Math.max(persistedMeasured, draftMeasured);
      targets.set(group.key, {
        key: group.key,
        afterLineNumber: Math.max(0, group.anchorLine - 1),
        targetHeight: isCollapsed ? 0 : measured + VIEWZONE_TOP_PAD_PX + VIEWZONE_BOTTOM_PAD_PX,
        domNode: getOrCreateSpacerNode(group.key),
        isDraft: false,
      });
    }
    // Only register a separate draft viewzone for the gutter-click case
    // (new comment, no editingId). Edit drafts piggyback on the persisted
    // group's existing viewzone — see the crossfade in the JSX below.
    if (pendingRange && draftKey && !editingId) {
      const measured = measuredHeightsRef.current.get(draftKey) ?? INITIAL_DRAFT_HEIGHT_PX;
      targets.set(draftKey, {
        key: draftKey,
        afterLineNumber: Math.max(0, pendingRange.start - 1),
        targetHeight: measured + VIEWZONE_TOP_PAD_PX + VIEWZONE_BOTTOM_PAD_PX,
        domNode: getOrCreateSpacerNode(draftKey),
        isDraft: true,
      });
    }

    // Sync existence + afterLineNumber. A new persisted viewzone starts
    // at 0 (and animates up — the "entrance" reveal) UNLESS another
    // viewzone at the same anchor line was just removed in the same pass:
    // in that case it inherits that zone's height, so a draft → persisted
    // swap on submit doesn't replay the entrance animation that already
    // played when the draft appeared.
    modifiedEditor.changeViewZones((accessor) => {
      const handoffHeights = new Map<number, number>();
      const handoffTops = new Map<number, number>();
      for (const [key, entry] of viewzonesRef.current) {
        if (!targets.has(key)) {
          handoffHeights.set(entry.zone.afterLineNumber, entry.zone.heightInPx ?? 0);
          const t = zoneTopsRef.current.get(key);
          if (t !== undefined) handoffTops.set(entry.zone.afterLineNumber, t);
          accessor.removeZone(entry.id);
          viewzonesRef.current.delete(key);
          spacerNodesRef.current.delete(key);
          zoneTopsRef.current.delete(key);
          zoneHeightsRef.current.delete(key);
          cancelAnimation(key);
        }
      }
      for (const target of targets.values()) {
        if (viewzonesRef.current.has(target.key)) continue;
        const handoff = handoffHeights.get(target.afterLineNumber);
        const handoffTop = handoffTops.get(target.afterLineNumber);
        handoffHeights.delete(target.afterLineNumber);
        handoffTops.delete(target.afterLineNumber);
        // Drafts always appear at full height (typing into an animating
        // box feels broken). For persisted: use the handoff when there
        // is one (skip entrance replay), otherwise start at 0 and let
        // the height tween reveal the bubble.
        const startHeight =
          handoff !== undefined ? handoff : target.isDraft ? target.targetHeight : 0;
        const zoneKey = target.key;
        const zone: monacoEditor.IViewZone = {
          afterLineNumber: target.afterLineNumber,
          heightInPx: startHeight,
          domNode: target.domNode,
          // Monaco invokes these from its layout pass — the only moment
          // we can read the zone's real pixel top/height in sync with
          // what's actually painted. We imperatively position the bubble
          // overlay from here so it tracks the zone through scroll,
          // resize, and the animation tween without race conditions.
          onDomNodeTop: (top) => {
            zoneTopsRef.current.set(zoneKey, top);
            applyBubbleTransform(zoneKey);
          },
          onComputedHeight: (height) => {
            zoneHeightsRef.current.set(zoneKey, height);
            applyBubbleTransform(zoneKey);
          },
        };
        const id = accessor.addZone(zone);
        viewzonesRef.current.set(target.key, { id, zone });
        // Seed top/height from the just-removed same-line zone (edit
        // transitions: persisted → draft, draft → persisted). This way
        // applyBubbleTransform can position the new wrapper from frame 1
        // instead of waiting for Monaco's first onDomNodeTop callback —
        // which is what produced the brief "lines above flash at the
        // comment's position" on double-click-to-edit. Skipping the CSS
        // opacity fade-in for this case is also critical: the previous
        // bubble was at full opacity so the new one must take its spot
        // visibly at full opacity, no fade-from-zero.
        if (handoffTop !== undefined) {
          zoneTopsRef.current.set(zoneKey, handoffTop);
          zoneHeightsRef.current.set(zoneKey, startHeight);
          applyBubbleTransform(zoneKey);
          const inner = bubbleInnerRefs.current.get(zoneKey);
          if (inner) {
            const prevTransition = inner.style.transition;
            inner.style.transition = 'none';
            inner.style.opacity = '1';
            // Force a reflow so the no-transition opacity write commits
            // before we restore the transition — otherwise the browser
            // collapses both writes and animates anyway.
            void inner.offsetHeight;
            inner.style.transition = prevTransition || 'opacity 240ms ease-out';
          }
        }
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

    // Per-key: did the editing state flip this render? That's the cue to
    // animate the height change (otherwise the viewzone would snap to fit
    // the larger draft, which looks abrupt — and snap back on save).
    const editingFlippedKeys = new Set<string>();
    for (const k of editingGroupKeys) {
      if (!wasEditingGroupKeysRef.current.has(k)) editingFlippedKeys.add(k);
    }
    for (const k of wasEditingGroupKeysRef.current) {
      if (!editingGroupKeys.has(k)) editingFlippedKeys.add(k);
    }
    wasEditingGroupKeysRef.current = editingGroupKeys;

    // Height sync (outside changeViewZones). Animate for the three smooth
    // transitions: entrance reveal (0 → full), collapse toggle (full → 0),
    // and edit ↔ read-only height swaps. Everything else (submit, drafts,
    // ResizeObserver jiggle) snaps instantly.
    for (const target of targets.values()) {
      const entry = viewzonesRef.current.get(target.key);
      if (!entry) continue;
      const currentHeight = entry.zone.heightInPx ?? 0;
      if (currentHeight === target.targetHeight) continue;
      const diff = Math.abs(currentHeight - target.targetHeight);
      const isEntranceOrCollapse = currentHeight === 0 || target.targetHeight === 0;
      const isEditFlip = editingFlippedKeys.has(target.key);
      const shouldAnimate = (isEntranceOrCollapse || isEditFlip) && diff > 24 && !target.isDraft;
      if (!shouldAnimate) {
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
        zoneTopsRef.current.clear();
        zoneHeightsRef.current.clear();
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
          OUTSIDE Monaco's DOM tree (so they don't tangle in editor mouse
          / keyboard handling). Position + opacity are imperatively
          driven by the zone's onDomNodeTop / onComputedHeight callbacks
          via applyBubbleTransform — see VSCode's editor/contrib/zoneWidget
          for the same overlay-tracks-viewzone pattern. */}
      {groups.map(({ key, anchorLine, comments }) => {
        const tailLeftPx = tailLeftForAnchor(anchorLine);
        const isCollapsed = collapsed.has(key);
        // If this group contains the comment being edited, render the
        // DraftBubble alongside the BubbleStack inside the same wrapper.
        // The persisted bubble for that comment fades out (CommentBubble's
        // own opacity transition keyed off `editingId`), the DraftBubble
        // fades in (CSS `animate-fade-in`), and they overlap at the same
        // top — read-only morphs into editable in place, no DOM gap.
        const editingComment = comments.find((c) => c.id === editingId);
        return (
          <div
            key={`bubble-${key}`}
            ref={(el) => {
              if (el) {
                bubbleWrapperRefs.current.set(key, el);
                applyBubbleTransform(key);
              } else {
                bubbleWrapperRefs.current.delete(key);
              }
            }}
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
              ref={(el) => {
                attachMeasure(key, el);
                if (el) {
                  bubbleInnerRefs.current.set(key, el);
                  applyBubbleTransform(key);
                } else {
                  bubbleInnerRefs.current.delete(key);
                }
              }}
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
              />
            </div>
            {editingComment && pendingRange && (
              <div
                ref={(el) => attachMeasure(`${key}@draft`, el)}
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
          case. Edit drafts render inside the group's wrapper above so
          they can crossfade with the persisted bubble. */}
      {pendingRange &&
        draftKey &&
        !editingId &&
        (() => {
          const tailLeftPx = tailLeftForAnchor(pendingRange.start);
          const k = draftKey;
          return (
            <div
              ref={(el) => {
                if (el) {
                  bubbleWrapperRefs.current.set(k, el);
                  applyBubbleTransform(k);
                } else {
                  bubbleWrapperRefs.current.delete(k);
                }
              }}
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
                ref={(el) => {
                  attachMeasure(k, el);
                  if (el) {
                    bubbleInnerRefs.current.set(k, el);
                    applyBubbleTransform(k);
                  } else {
                    bubbleInnerRefs.current.delete(k);
                  }
                }}
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
