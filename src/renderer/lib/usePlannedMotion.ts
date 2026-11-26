import { useCallback, useMemo, useRef, useState } from 'react';
import { EXPAND_EASE_MS, panelEaseMs } from '../components/ui/Resizable';
import type { SidebarMotion } from '../components/rightInspector/RightInspector';
import { whenFramesSettle } from './framesSettled';
import { useUi } from '../stores/uiStore';

/** The most a planned motion's ease waits for its held layout's long frames. */
const SETTLE_CAP_MS = 250;

type Hold = Omit<SidebarMotion, 'phase'>;

/** One planned move of the shell's panels (the task sidebar narrow ⇄
 *  expanded or hide ⇄ show, the left sidebar's own toggle). */
export interface MotionPlan {
  /** What the task sidebar's content holds through it (see `SidebarMotion`);
   *  none when the move leaves it to the panels (the left sidebar's toggle). */
  hold?: Hold;
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
 * The shell's planned motion (D258, D262, D264, D266), one for every way its
 * sidebars move (narrow ⇄ expanded, closing the editor, hide ⇄ show, ⌘B),
 * so they can't drift: the content takes its held layout first (`held`: it
 * paints, clipped by the panel), then, once frames settle, every panel eases
 * over EXPAND_EASE_MS with `ease-calm` (`easing`), and the content lets go
 * after. A new motion cancels the one running. `motion`: the task sidebar's
 * hold, if the plan has one; `phase`: where any motion is. `easeNow`: the
 * ease in force, for clearing panels' `animate` flags.
 */
export function usePlannedMotion() {
  const [state, setState] = useState<{ phase: SidebarMotion['phase']; hold?: Hold } | null>(null);
  const motion = useMemo<SidebarMotion | null>(
    () => (state?.hold ? { ...state.hold, phase: state.phase } : null),
    [state],
  );
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
    setState(null);
  }, []);

  /** Runs `plan`; returns its cancel. */
  const run = useCallback((plan: MotionPlan): (() => void) => {
    cancelRef.current();
    runningRef.current = true;
    setState({ phase: 'held', hold: plan.hold });
    const ui = useUi.getState();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelSettle = () => {};
    const ease = () => {
      ui.setChangesAnimating(true);
      if (plan.movesLeft) ui.setSidebarAnimating(true);
      const width = plan.move();
      const hold = plan.hold && { ...plan.hold, width: width ?? plan.hold.width };
      setState({ phase: 'easing', hold });
      timer = setTimeout(() => {
        runningRef.current = false;
        cancelRef.current = () => {};
        ui.setChangesAnimating(false);
        ui.setSidebarAnimating(false);
        setState(null);
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

  return { motion, phase: state?.phase ?? null, run, stop, easeNow };
}
