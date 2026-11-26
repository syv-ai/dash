import type { EventEmitter } from 'events';
import type { ActivityInfo } from '@shared/types';
import type { WaitKind } from './hookPayload';
import { countBucket, durationBucket } from './telemetryBuckets';

/** One analytics event, shape only (docs/telemetry.md). */
export interface TelemetryEvent {
  event: string;
  properties: Record<string, string | number | boolean>;
}

interface TaskTrack {
  state: ActivityInfo['state'];
  turnStart: number | null;
  waitStart: number | null;
  /** What opened the current wait (`waiting` from the listing alone has none). */
  waitKind: WaitKind | null;
}

/** What the hook stream said about a task's turn so far. */
interface TurnShape {
  toolCalls: number;
  subagent: boolean;
  /** The kind of the next wait, named by its hook just before the state turns. */
  pendingWait: WaitKind | null;
}

/**
 * Turns and waits from ActivityMonitor's snapshots: a turn runs from the
 * first `busy` to the next `idle`/`stopped` (`turn_completed`) or `error`
 * (`turn_failed`, by error type); a `waiting` inside it ends in
 * `wait_ended`. The hook stream adds what the snapshots don't carry: what
 * opened a wait (`noteWait`), a turn's tool calls and subagents, and when a
 * task was created, for `first_turn_started`. Pure: the caller passes each
 * snapshot and the time.
 */
export class ActivityTelemetry {
  private readonly tasks = new Map<string, TaskTrack>();
  private readonly shapes = new Map<string, TurnShape>();
  private readonly created = new Map<string, number>();

  /** A hook opened a wait on the user; the first one names it. */
  noteWait(id: string, kind: WaitKind): void {
    if (this.tasks.get(id)?.state === 'waiting') return;
    const shape = this.shape(id);
    shape.pendingWait ??= kind;
  }

  /** A PreToolUse, the main agent's or a subagent's. */
  noteToolCall(id: string): void {
    this.shape(id).toolCalls++;
  }

  noteSubagent(id: string): void {
    this.shape(id).subagent = true;
  }

  noteTaskCreated(id: string, now: number): void {
    this.created.set(id, now);
  }

  observe(all: Readonly<Record<string, ActivityInfo>>, now: number): TelemetryEvent[] {
    const events: TelemetryEvent[] = [];
    for (const id of this.tasks.keys()) {
      if (id in all) continue;
      this.tasks.delete(id);
      this.shapes.delete(id);
    }
    for (const [id, info] of Object.entries(all)) {
      const known = this.tasks.get(id);
      if (!known) {
        const track: TaskTrack = {
          state: info.state,
          turnStart: null,
          waitStart: null,
          waitKind: null,
        };
        if (info.state === 'busy') {
          track.turnStart = now;
          this.firstTurn(id, now, events);
        }
        this.tasks.set(id, track);
        continue;
      }
      if (info.state !== known.state) this.transition(id, known, info, now, events);
    }
    return events;
  }

  private transition(
    id: string,
    track: TaskTrack,
    info: ActivityInfo,
    now: number,
    events: TelemetryEvent[],
  ): void {
    if (track.state === 'waiting' && track.waitStart !== null) {
      events.push({
        event: 'wait_ended',
        properties: {
          duration_bucket: durationBucket(now - track.waitStart),
          kind: track.waitKind ?? 'unknown',
        },
      });
      track.waitStart = null;
      track.waitKind = null;
    }
    if (info.state === 'busy') {
      this.firstTurn(id, now, events);
      track.turnStart ??= now;
    }
    if (info.state === 'waiting') {
      const shape = this.shape(id);
      track.waitStart = now;
      track.waitKind = shape.pendingWait;
      shape.pendingWait = null;
    }
    if (track.turnStart !== null && (info.state === 'idle' || info.state === 'stopped')) {
      const shape = this.shape(id);
      events.push({
        event: 'turn_completed',
        properties: {
          duration_bucket: durationBucket(now - track.turnStart),
          interrupted: info.interrupted === true,
          tool_call_bucket: countBucket(shape.toolCalls),
          subagent_used: shape.subagent,
        },
      });
      track.turnStart = null;
      this.shapes.delete(id);
    }
    if (info.state === 'error') {
      events.push({
        event: 'turn_failed',
        properties: { error_type: info.error?.type ?? 'unknown' },
      });
      track.turnStart = null;
      this.shapes.delete(id);
    }
    track.state = info.state;
  }

  private firstTurn(id: string, now: number, events: TelemetryEvent[]): void {
    const createdAt = this.created.get(id);
    if (createdAt === undefined) return;
    this.created.delete(id);
    events.push({
      event: 'first_turn_started',
      properties: { duration_bucket: durationBucket(now - createdAt) },
    });
  }

  private shape(id: string): TurnShape {
    let shape = this.shapes.get(id);
    if (!shape) {
      shape = { toolCalls: 0, subagent: false, pendingWait: null };
      this.shapes.set(id, shape);
    }
    return shape;
  }
}

/** Live sessions (any not asleep) and how many of them are working right now. */
export function sessionCounts(all: Readonly<Record<string, ActivityInfo>>): {
  live: number;
  busy: number;
} {
  let live = 0;
  let busy = 0;
  for (const info of Object.values(all)) {
    if (info.state !== 'stopped') live++;
    if (info.state === 'busy') busy++;
  }
  return { live, busy };
}

/** The hook stream's facts the tracker needs (HookServer's `hookEvents`). */
export interface HookFacts {
  'wait-opened': { ptyId: string; kind: WaitKind };
  'tool-called': { ptyId: string };
  'subagent-started': { ptyId: string };
}

/**
 * Feed ActivityMonitor's `change` events, the hook stream's facts and task
 * creations through a tracker into `capture`.
 */
export function trackActivity(
  sources: { activity: EventEmitter; hooks: EventEmitter; tasks: EventEmitter },
  capture: (event: string, properties: TelemetryEvent['properties']) => void,
): void {
  const tracker = new ActivityTelemetry();
  sources.hooks.on('wait-opened', (e: HookFacts['wait-opened']) =>
    tracker.noteWait(e.ptyId, e.kind),
  );
  sources.hooks.on('tool-called', (e: HookFacts['tool-called']) => tracker.noteToolCall(e.ptyId));
  sources.hooks.on('subagent-started', (e: HookFacts['subagent-started']) =>
    tracker.noteSubagent(e.ptyId),
  );
  sources.tasks.on('task-created', (taskId: string) => tracker.noteTaskCreated(taskId, Date.now()));
  sources.activity.on('change', (all: Record<string, ActivityInfo>) => {
    for (const e of tracker.observe(all, Date.now())) capture(e.event, e.properties);
  });
}
