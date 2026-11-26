import { useCallback, useRef, useState } from 'react';
import { EXPAND_EASE_MS, panelEaseMs } from '../components/ui/Resizable';
import type { SidebarMotion } from '../components/rightInspector/RightInspector';
import { whenFramesSettle } from './framesSettled';
import { useUi } from '../stores/uiStore';

/** The most a planned motion's ease waits for its held layout's long frames. */
const SETTLE_CAP_MS = 250;

/** One planned move of the task sidebar (narrow ⇄ expanded, hide ⇄ show). */
export interface MotionPlan {
  /** What the sidebar's content holds through it (see `SidebarMotion`). */
  hold: Omit<SidebarMotion, 'phase'>;
  /** Calls `go` once the held layout's content is ready (an editor opening
   *  for the first time has mounted); returns a cancel. Default: at once. */
  ready?: (go: () => void) => () => void;
  /** Moves the panels. Returns the held width (px) when it is only known
   *  once the panel has its end layout (showing: the library clamps it). */
  move: () => number | void;
  /** The left sidebar moves with it. */
  movesLeft?: boolean;
  /** After the ease. */
  done?: () => void;
}

/**
 * The task sidebar's planned motion (D258, D262, D264), one for every way it
 * moves (narrow ⇄ expanded, closing the editor, hide ⇄ show), so they can't
 * drift: the content takes its held layout first (`held`: it paints, clipped
 * by the panel), then, once frames settle, every panel eases over
 * EXPAND_EASE_MS with `ease-calm` (`easing`), and the content lets go after.
 * A new motion cancels the one running. `easeNow`: the ease in force, for
 * clearing panels' `animate` flags.
 */
export function usePlannedMotion() {
  const [motion, setMotion] = useState<SidebarMotion | null>(null);
  const runningRef = useRef(false);
  const cancelRef = useRef<() => void>(() => {});

  const easeNow = useCallback(
    () => panelEaseMs(runningRef.current ? EXPAND_EASE_MS : undefined),
    [],
  );

  /** Ends any motion at once, its content let go (nothing to move with). */
  const stop = useCallback(() => {
    cancelRef.current();
    cancelRef.current = () => {};
    runningRef.current = false;
    setMotion(null);
  }, []);

  /** Runs `plan`; returns its cancel. */
  const run = useCallback((plan: MotionPlan): (() => void) => {
    cancelRef.current();
    runningRef.current = true;
    setMotion({ ...plan.hold, phase: 'held' });
    const ui = useUi.getState();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelSettle = () => {};
    const ease = () => {
      ui.setChangesAnimating(true);
      if (plan.movesLeft) ui.setSidebarAnimating(true);
      const width = plan.move() ?? plan.hold.width;
      setMotion({ ...plan.hold, width, phase: 'easing' });
      timer = setTimeout(() => {
        runningRef.current = false;
        cancelRef.current = () => {};
        ui.setChangesAnimating(false);
        ui.setSidebarAnimating(false);
        setMotion(null);
        plan.done?.();
      }, panelEaseMs(EXPAND_EASE_MS));
    };
    // The ease starts once the held layout has painted and its long frames
    // are over, from a task of its own (D112): a transition's clock starts
    // at the frame its style change lands in.
    const settleThenEase = () => {
      cancelSettle = whenFramesSettle(ease, SETTLE_CAP_MS);
    };
    let cancelReady = () => {};
    if (plan.ready) cancelReady = plan.ready(settleThenEase);
    else settleThenEase();
    const cancel = () => {
      cancelReady();
      cancelSettle();
      clearTimeout(timer);
    };
    cancelRef.current = cancel;
    return cancel;
  }, []);

  return { motion, run, stop, easeNow };
}
