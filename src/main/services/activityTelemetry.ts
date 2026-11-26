import type { EventEmitter } from 'events';
import type { ActivityInfo } from '@shared/types';

/** One analytics event, shape only (docs/telemetry.md). */
export interface TelemetryEvent {
  event: string;
  properties: Record<string, string | number | boolean>;
}

/** Coarse durations, so no event carries a timing precise enough to fingerprint. */
export function durationBucket(ms: number): string {
  if (ms < 10_000) return 'lt_10s';
  if (ms < 60_000) return '10s_1m';
  if (ms < 5 * 60_000) return '1m_5m';
  if (ms < 15 * 60_000) return '5m_15m';
  if (ms < 60 * 60_000) return '15m_1h';
  return 'gt_1h';
}

interface TaskTrack {
  state: ActivityInfo['state'];
  turnStart: number | null;
  waitStart: number | null;
}

/**
 * Turns and waits from ActivityMonitor's snapshots: a turn runs from the
 * first `busy` to the next `idle`/`stopped` (`turn_completed`) or `error`
 * (`turn_failed`, by error type); a `waiting` inside it ends in
 * `wait_ended`. Pure: the caller passes each snapshot and the time.
 */
export class ActivityTelemetry {
  private readonly tasks = new Map<string, TaskTrack>();

  observe(all: Readonly<Record<string, ActivityInfo>>, now: number): TelemetryEvent[] {
    const events: TelemetryEvent[] = [];
    for (const id of this.tasks.keys()) if (!(id in all)) this.tasks.delete(id);
    for (const [id, info] of Object.entries(all)) {
      const track = this.tasks.get(id) ?? { state: info.state, turnStart: null, waitStart: null };
      if (!this.tasks.has(id)) {
        if (info.state === 'busy') track.turnStart = now;
        this.tasks.set(id, track);
        continue;
      }
      if (info.state === track.state) continue;
      if (track.state === 'waiting' && track.waitStart !== null) {
        events.push({
          event: 'wait_ended',
          properties: { duration_bucket: durationBucket(now - track.waitStart) },
        });
        track.waitStart = null;
      }
      if (info.state === 'busy' && track.turnStart === null) track.turnStart = now;
      if (info.state === 'waiting') track.waitStart = now;
      if (track.turnStart !== null && (info.state === 'idle' || info.state === 'stopped')) {
        events.push({
          event: 'turn_completed',
          properties: {
            duration_bucket: durationBucket(now - track.turnStart),
            interrupted: info.interrupted === true,
          },
        });
        track.turnStart = null;
      }
      if (info.state === 'error') {
        events.push({
          event: 'turn_failed',
          properties: { error_type: info.error?.type ?? 'unknown' },
        });
        track.turnStart = null;
      }
      track.state = info.state;
    }
    return events;
  }
}

/** Feed ActivityMonitor's `change` events through a tracker into `capture`. */
export function trackActivity(
  events: EventEmitter,
  capture: (event: string, properties: TelemetryEvent['properties']) => void,
): void {
  const tracker = new ActivityTelemetry();
  events.on('change', (all: Record<string, ActivityInfo>) => {
    for (const e of tracker.observe(all, Date.now())) capture(e.event, e.properties);
  });
}
