/*
 * How a windowed list moves when its rows change (`VirtualList`'s `animate`),
 * planned from layout data alone: the virtualizer already knows where every
 * row was and is, so nothing is measured. Pure; the list plays the plan on
 * the compositor (Web Animations on `transform`, `opacity`, `clip-path`).
 *
 *  - A row that stays slides from where it was to where it is (FLIP), no
 *    further than a run's edge travels in view, so it keeps pace with it.
 *  - A run of new rows uncovers top-down behind the rows below as they
 *    slide down to make room, so nothing overlaps: each row's reveal is
 *    the slice of the eased progress in which the moving edge crosses it.
 *  - A run of removed rows is kept briefly (the list renders them as
 *    inert ghosts) and covers bottom-up as the rows below slide up.
 */
import type { Key } from 'react';

/** A list row's motion: short, for rows (the panels' 1s ease is too slow
 *  for a list), on the app's calm curve (`ease-calm`). T14. */
export const LIST_MOTION_MS = 200;

/** A rendered row: its key and where it sits (px from the list's top). */
export interface Slot {
  key: Key;
  start: number;
  size: number;
}

/** A new or removed row, with the run of them it belongs to: the room the
 *  run spans, from its first row's start to the next row's (gaps included). */
export interface RunSlot extends Slot {
  runTop: number;
  runEnd: number;
}

/** A slice of the eased progress, 0–1. */
export type Window = readonly [number, number];

/** Consecutive runs of the slots that pass `test`, each row with its run's
 *  room: to the next slot's start, or to the run's own end at the end. */
function inRuns(slots: readonly Slot[], test: (s: Slot) => boolean): RunSlot[] {
  const out: RunSlot[] = [];
  let i = 0;
  while (i < slots.length) {
    if (!test(slots[i]!)) {
      i++;
      continue;
    }
    const run: Slot[] = [];
    while (i < slots.length && test(slots[i]!)) run.push(slots[i++]!);
    const runTop = run[0]!.start;
    const last = run.at(-1)!;
    const runEnd = i < slots.length ? slots[i]!.start : last.start + last.size;
    for (const s of run) out.push({ ...s, runTop, runEnd });
  }
  return out;
}

/** The rows rendered now that weren't in the list before. */
export const newRows = (after: readonly Slot[], wasListed: (key: Key) => boolean) =>
  inRuns(after, (s) => !wasListed(s.key));

/** The rows rendered before that are no longer in the list. */
export const goneRows = (before: readonly Slot[], isListed: (key: Key) => boolean) =>
  inRuns(before, (s) => !isListed(s.key));

/** Where a row sits in its run, and the room the run's edge travels: no
 *  further than the list's visible bottom, so a run taller than what shows
 *  of it uncovers over what shows instead of blurring past. */
function travel(s: RunSlot, viewBottom: number) {
  const shows = s.runTop < viewBottom ? viewBottom - s.runTop : Infinity;
  return { t: s.start - s.runTop, height: Math.max(Math.min(s.runEnd - s.runTop, shows), 1) };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A new row uncovers while the run's lower edge, moving down, crosses it. */
export function revealWindow(s: RunSlot, viewBottom: number): Window {
  const { t, height } = travel(s, viewBottom);
  return [clamp01(t / height), clamp01((t + s.size) / height)];
}

/** A removed row covers while the run's lower edge, moving up, crosses it. */
export function hideWindow(s: RunSlot, viewBottom: number): Window {
  const { t, height } = travel(s, viewBottom);
  return [clamp01(1 - (t + s.size) / height), clamp01(1 - t / height)];
}

/** A staying row's slide: `from` → `to` on screen; it sits at `at` (its
 *  place in the list) once the slide ends. */
export interface SlideMove {
  key: Key;
  from: number;
  to: number;
  at: number;
}

/** The room a change's rows slide through: its first run's (`travel`), the
 *  same the run's rows reveal or hide over, so the rows below move in step
 *  with the run's edge; none: `fallback`. */
export function slideRoom(runs: readonly RunSlot[], viewBottom: number, fallback: number): number {
  const first = runs.reduce<RunSlot | undefined>(
    (top, s) => (top === undefined || s.runTop < top.runTop ? s : top),
    undefined,
  );
  return first ? travel(first, viewBottom).height : fallback;
}

/** The rows that stay and moved: each slides from where it was to where it
 *  is. A move longer than `maxDistance` (the room in view) slides only that
 *  far, the part that shows: up, it comes in from `maxDistance` below its
 *  place; down, it goes `maxDistance` and then sits at its place, out of
 *  view. So a run taller than the view folds or opens in step with the rows
 *  below, none of them jumping over it. */
export function slides({
  after,
  startBefore,
  maxDistance,
}: {
  after: readonly Slot[];
  /** Where a key sat before, rendered or not; undefined if it wasn't listed. */
  startBefore: (key: Key) => number | undefined;
  maxDistance: number;
}): SlideMove[] {
  const out: SlideMove[] = [];
  for (const s of after) {
    const was = startBefore(s.key);
    if (was === undefined || was === s.start) continue;
    const d = Math.min(Math.abs(was - s.start), maxDistance);
    out.push(
      was > s.start
        ? { key: s.key, from: s.start + d, to: s.start, at: s.start }
        : { key: s.key, from: was, to: was + d, at: s.start },
    );
  }
  return out;
}

/** Whether two key lists are the same, in order. */
export function sameKeys(a: readonly Key[], b: readonly Key[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const SHOWN = { clipPath: 'inset(0 0 0px 0)', opacity: 1 };
const hidden = (size: number) => ({ clipPath: `inset(0 0 ${size}px 0)`, opacity: 0 });

/** Keyframes for a row uncovering top-down (clipped from the bottom) and
 *  fading in within `reveal` of the eased progress. */
export function enterKeyframes(size: number, [a, b]: Window): Keyframe[] {
  return [
    { ...hidden(size), offset: 0 },
    { ...hidden(size), offset: a },
    { ...SHOWN, offset: Math.max(a, b) },
    { ...SHOWN, offset: 1 },
  ];
}

/** Keyframes for a removed row covering bottom-up and fading out within
 *  `hide`; it stays hidden after (the ghost goes when it ends). */
export function exitKeyframes(size: number, [a, b]: Window): Keyframe[] {
  return [
    { ...SHOWN, offset: 0 },
    { ...SHOWN, offset: a },
    { ...hidden(size), offset: Math.max(a, b) },
    { ...hidden(size), offset: 1 },
  ];
}
