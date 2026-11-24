import { describe, expect, it } from 'vitest';
import type { LspServerState, LspServerStatus } from '../../../shared/lsp';
import { stepHealth, type HealthStep, type TrackedServer } from '../health';

const GRACE = 3000;

function server(state: LspServerState, message?: string): LspServerStatus {
  return { serverId: 'ts', name: 'TypeScript', state, message };
}

/** Feed a sequence of (time, state) through stepHealth, as the watch does. */
function run(steps: Array<[number, LspServerState]>): HealthStep[] {
  let tracked: ReadonlyMap<string, TrackedServer> = new Map();
  return steps.map(([now, state]) => {
    const next = stepHealth(tracked, [server(state)], now, GRACE);
    tracked = next.tracked;
    return next;
  });
}

/** The `i`th step (each test feeds the steps it reads). */
const nth = (steps: HealthStep[], i: number): HealthStep => steps[i]!;

const levels = (s: HealthStep) => s.logs.map((l) => `${l.level}:${l.status.state}`);

describe('stepHealth', () => {
  it('keeps a running server quiet', () => {
    const step = nth(run([[0, 'running']]), 0);
    expect(step.unhealthy).toEqual([]);
    expect(step.logs).toEqual([]);
    expect(step.recheckAt).toBeNull();
  });

  it('hides starting within the grace, and asks to look again when it runs out', () => {
    const steps = run([
      [0, 'starting'],
      [1000, 'starting'],
    ]);
    const first = nth(steps, 0);
    const again = nth(steps, 1);
    expect(first.unhealthy).toEqual([]);
    expect(first.recheckAt).toBe(GRACE);
    // The grace counts from when it started, not from the last push.
    expect(again.recheckAt).toBe(GRACE);
  });

  it('warns once when starting overruns the grace', () => {
    const steps = run([
      [0, 'starting'],
      [GRACE, 'starting'],
      [GRACE + 500, 'starting'],
    ]);
    expect(steps.map(levels)).toEqual([[], ['warn:starting'], []]);
    expect(nth(steps, 1).unhealthy.map((s) => s.state)).toEqual(['starting']);
    expect(nth(steps, 1).recheckAt).toBeNull();
  });

  it('warns on each move into an unhealthy state, once', () => {
    const steps = run([
      [0, 'running'],
      [10, 'restarting'],
      [20, 'restarting'],
      [30, 'failed'],
      [40, 'failed'],
    ]);
    expect(steps.map(levels)).toEqual([[], ['warn:restarting'], [], ['warn:failed'], []]);
  });

  it('logs info on recovery to running, and nothing for a quick start', () => {
    const steps = run([
      [0, 'failed'],
      [10, 'restarting'],
      [20, 'running'],
      [30, 'running'],
    ]);
    expect(steps.map(levels)).toEqual([['warn:failed'], ['warn:restarting'], ['info:running'], []]);
    expect(
      run([
        [0, 'starting'],
        [100, 'running'],
      ]).map(levels),
    ).toEqual([[], []]);
  });

  it('treats unavailable as unhealthy and stopped as quiet', () => {
    expect(nth(run([[0, 'unavailable']]), 0).logs.map((l) => l.level)).toEqual(['warn']);
    expect(nth(run([[0, 'stopped']]), 0).unhealthy).toEqual([]);
  });

  it('carries the message for the log line', () => {
    const step = stepHealth(new Map(), [server('failed', 'exited with code 1')], 0, GRACE);
    expect(step.logs[0]!.status.message).toBe('exited with code 1');
  });

  it('forgets servers that are gone', () => {
    const first = stepHealth(new Map(), [server('failed')], 0, GRACE);
    const next = stepHealth(first.tracked, [], 10, GRACE);
    expect(next.tracked.size).toBe(0);
    expect(next.unhealthy).toEqual([]);
  });
});
