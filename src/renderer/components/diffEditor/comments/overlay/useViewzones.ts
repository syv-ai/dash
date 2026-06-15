import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { editor as monacoEditor } from 'monaco-editor';
import type { LineRange, LiveComment } from '../types';

// Vertical padding inside the viewzone — asymmetric so the bubble sits closer
// to the code line above than to the anchor line below (the tail dangles into
// the lower pad, so it earns the extra space). Exported because CommentOverlay
// positions the bubble's inner div with the same top pad.
export const VIEWZONE_TOP_PAD_PX = 8;
const VIEWZONE_BOTTOM_PAD_PX = 16;
// Conservative initial viewzone height before the bubble's actual height is
// measured. Just needs to be in the right ballpark so the first paint doesn't
// shift dramatically when ResizeObserver fires.
const INITIAL_BUBBLE_HEIGHT_PX = 96;
const INITIAL_DRAFT_HEIGHT_PX = 130;

export interface ViewzoneGroup {
  /** Stable key — same (startLine, endLine) → same key across renders. */
  key: string;
  anchorLine: number;
  comments: LiveComment[];
}

interface Args {
  modifiedEditor: monacoEditor.ICodeEditor | null;
  groups: ViewzoneGroup[];
  collapsed: ReadonlySet<string>;
  pendingRange: LineRange | null;
  /** Key for the active draft viewzone (null when no draft). Edit drafts reuse
   *  the persisted group key; fresh drafts get a `draft:` key. */
  draftKey: string | null;
  editingId: string | null;
}

export interface ViewzonesApi {
  /** Edit-draft inner: observe + synchronously seed its measured height so the
   *  first layout pass sees the real value (no one-frame overflow). */
  attachDraftMeasure: (measureKey: string, el: HTMLDivElement | null) => void;
  /** Bubble-wrapper ref callback: track the node + position it from the zone. */
  registerWrapper: (key: string, el: HTMLDivElement | null) => void;
  /** Bubble-inner ref callback: observe (measure), track, + position it. */
  registerInner: (key: string, el: HTMLDivElement | null) => void;
}

/** Owns the Monaco view-zone lifecycle for the comment bubbles: reserves empty
 *  space above each anchor line, measures bubble heights, drives the
 *  expand/collapse/edit height tweens, and imperatively positions the React
 *  bubble overlay from Monaco's layout callbacks (onDomNodeTop /
 *  onComputedHeight). CommentOverlay renders the bubbles and wires its
 *  ref-callbacks to the handles returned here.
 *
 *  Same pattern as VSCode's editor/contrib/zoneWidget and Theia's
 *  monaco-editor-zone-widget: viewzone reserves vertical space, an overlay
 *  tracks the zone via the layout callbacks (sidesteps the stale
 *  getTopForLineNumber() race during animation tweens). */
export function useViewzones({
  modifiedEditor,
  groups,
  collapsed,
  pendingRange,
  draftKey,
  editingId,
}: Args): ViewzonesApi {
  // Re-render on scroll / resize / content-size change so absolute positions
  // track Monaco. onDidContentSizeChange fires on every viewzone height
  // mutation — what drives the bubble overlay to follow the zone during the
  // animation tween.
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

  // The viewzone needs a DOM node (Monaco appends it to reserve space). We use
  // a stable empty spacer div per key; the actual bubble UI renders as a React
  // overlay OUTSIDE Monaco's DOM (in editorAreaEl).
  const spacerNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const getOrCreateSpacerNode = (key: string): HTMLDivElement => {
    let node = spacerNodesRef.current.get(key);
    if (!node) {
      node = document.createElement('div');
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
  // accessor.layoutZone(id) for in-place updates so resize doesn't flash.
  type ZoneEntry = { id: string; zone: monacoEditor.IViewZone };
  const viewzonesRef = useRef<Map<string, ZoneEntry>>(new Map());

  // Previous editing-group set, used to detect edit ↔ read-only transitions
  // per group key (those get the smooth tween; other changes snap).
  const wasEditingGroupKeysRef = useRef<Set<string>>(new Set());

  // Layout-callback bookkeeping. onDomNodeTop / onComputedHeight fire from
  // Monaco's layout pass — the authoritative moment the zone's pixel position
  // is known. We imperatively re-position the bubble wrapper from these.
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
  // expand/collapse height tween.
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
      // ease-in-out cubic — symmetric, gentle at both ends. Pairs with the CSS
      // opacity transition on the bubble wrapper.
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
        // layoutZone() doesn't reliably fire onDidLayoutChange, so force a
        // re-render each frame so opacity + Y position track the viewzone.
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

  // useLayoutEffect (not useEffect) so the viewzone swap commits in the same
  // frame as the React DOM commit. Otherwise the browser paints between commit
  // and useEffect, briefly showing the editor with the just-unmounted bubble
  // gone but the stale viewzone still reserving space — the source of the
  // "lines from above flash at the comment's position" artifact on edit.
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
    // Per-group: is this the group whose comment is currently being edited? We
    // expand its viewzone to fit max(persisted, draft) so the crossfading
    // DraftBubble doesn't overflow into the code line below the anchor.
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
    // Only register a separate draft viewzone for the gutter-click case (new
    // comment, no editingId). Edit drafts piggyback on the persisted group's
    // existing viewzone.
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

    // Sync existence + afterLineNumber. A new persisted viewzone starts at 0
    // (and animates up — the "entrance" reveal) UNLESS another viewzone at the
    // same anchor line was just removed in the same pass: it inherits that
    // zone's height, so a draft → persisted swap on submit doesn't replay the
    // entrance animation that already played when the draft appeared.
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
        // Drafts always appear at full height (typing into an animating box
        // feels broken). For persisted: use the handoff when there is one
        // (skip entrance replay), otherwise start at 0 and tween the reveal.
        const startHeight =
          handoff !== undefined ? handoff : target.isDraft ? target.targetHeight : 0;
        const zoneKey = target.key;
        const zone: monacoEditor.IViewZone = {
          afterLineNumber: target.afterLineNumber,
          heightInPx: startHeight,
          domNode: target.domNode,
          // Monaco invokes these from its layout pass — the only moment we can
          // read the zone's real pixel top/height in sync with what's painted.
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
        // transitions: persisted → draft, draft → persisted) so
        // applyBubbleTransform can position the new wrapper from frame 1
        // instead of waiting for Monaco's first onDomNodeTop callback —
        // which produced the brief "lines above flash" on dbl-click-to-edit.
        // Skipping the CSS opacity fade-in for this case is also critical: the
        // previous bubble was at full opacity so the new one must take its
        // spot at full opacity, no fade-from-zero.
        if (handoffTop !== undefined) {
          zoneTopsRef.current.set(zoneKey, handoffTop);
          zoneHeightsRef.current.set(zoneKey, startHeight);
          applyBubbleTransform(zoneKey);
          const inner = bubbleInnerRefs.current.get(zoneKey);
          if (inner) {
            const prevTransition = inner.style.transition;
            inner.style.transition = 'none';
            inner.style.opacity = '1';
            // Force a reflow so the no-transition opacity write commits before
            // we restore the transition — otherwise the browser collapses both
            // writes and animates anyway.
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
    // animate the height change (otherwise the viewzone snaps abruptly).
    const editingFlippedKeys = new Set<string>();
    for (const k of editingGroupKeys) {
      if (!wasEditingGroupKeysRef.current.has(k)) editingFlippedKeys.add(k);
    }
    for (const k of wasEditingGroupKeysRef.current) {
      if (!editingGroupKeys.has(k)) editingFlippedKeys.add(k);
    }
    wasEditingGroupKeysRef.current = editingGroupKeys;

    // Height sync (outside changeViewZones). Animate for the three smooth
    // transitions: entrance reveal (0 → full), collapse toggle (full → 0), and
    // edit ↔ read-only height swaps. Everything else snaps instantly.
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
    editingId,
    measureNonce,
    animateHeight,
    cancelAnimation,
    applyBubbleTransform,
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

  const attachDraftMeasure = useCallback(
    (measureKey: string, el: HTMLDivElement | null) => {
      attachMeasure(measureKey, el);
      if (el) {
        // Synchronously seed the draft's measured height so the first layout
        // pass already sees the real value (no one-frame overflow before
        // ResizeObserver fires).
        const h = Math.ceil(el.getBoundingClientRect().height);
        if (h > 0) measuredHeightsRef.current.set(measureKey, h);
      }
    },
    [attachMeasure],
  );

  const registerWrapper = useCallback(
    (key: string, el: HTMLDivElement | null) => {
      if (el) {
        bubbleWrapperRefs.current.set(key, el);
        applyBubbleTransform(key);
      } else {
        bubbleWrapperRefs.current.delete(key);
      }
    },
    [applyBubbleTransform],
  );

  const registerInner = useCallback(
    (key: string, el: HTMLDivElement | null) => {
      // The inner div is BOTH the ResizeObserver-measured element and the
      // opacity-driven node, so it gets observed + tracked here.
      attachMeasure(key, el);
      if (el) {
        bubbleInnerRefs.current.set(key, el);
        applyBubbleTransform(key);
      } else {
        bubbleInnerRefs.current.delete(key);
      }
    },
    [attachMeasure, applyBubbleTransform],
  );

  return { attachDraftMeasure, registerWrapper, registerInner };
}
