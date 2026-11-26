import type { ActivityInfo, ActivityState } from '../../shared/types';

/** A busy spell shorter than this is a flash, not a finished turn. */
export const MIN_BUSY_DURATION_MS = 3000;

/** What the renderer remembers between activity updates. */
export interface ActivityTracker {
  /** Each task's state at the last update. */
  state: Record<string, ActivityState>;
  /** When each busy task went busy (or was first seen busy). */
  busySince: Record<string, number>;
}

export const emptyTracker = (): ActivityTracker => ({ state: {}, busySince: {} });

/**
 * Fold an activity update into the tracker. `finished`: tasks that went from
 * busy to idle on their own after at least MIN_BUSY_DURATION_MS of work (an
 * idle the user interrupted into is seen, so it doesn't count); `started`: tasks
 * that went from idle to busy. A task first seen busy (Dash opened mid-turn,
 * or the supervisor listing created its entry) is timed from that sighting,
 * so its turn still finishes.
 */
export function observeActivity(
  tracker: ActivityTracker,
  activity: Record<string, ActivityInfo>,
  now: number,
): { tracker: ActivityTracker; finished: string[]; started: string[] } {
  const finished: string[] = [];
  const started: string[] = [];
  const state: Record<string, ActivityState> = {};
  const busySince: Record<string, number> = {};
  for (const [id, info] of Object.entries(activity)) {
    const was = tracker.state[id];
    if (was === 'idle' && info.state === 'busy') started.push(id);
    if (was === 'busy' && info.state === 'idle' && !info.interrupted) {
      if (now - (tracker.busySince[id] ?? now) >= MIN_BUSY_DURATION_MS) finished.push(id);
    }
    if (info.state === 'busy')
      busySince[id] = was === 'busy' ? (tracker.busySince[id] ?? now) : now;
    state[id] = info.state;
  }
  return { tracker: { state, busySince }, finished, started };
}
