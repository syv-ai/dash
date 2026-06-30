import { describe, it, expect, beforeEach } from 'vitest';
import { LoopScheduler, type LoopDriver } from '../LoopScheduler';
import type { LoopConfig, LoopStatus } from '@shared/types';

/** Flush the microtask queue a few times so chained awaits in the scheduler settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

class FakeDriver implements LoopDriver {
  spawns: number[] = [];
  kills = 0;
  log: string[] = [];
  statuses: LoopStatus[] = [];
  checkResult = false;
  outputNeedle: string | null = null;
  pendingTimer: { ms: number; cb: () => void } | null = null;
  private clock = 1_700_000_000_000;

  async spawnWorker(iteration: number): Promise<void> {
    this.spawns.push(iteration);
  }
  async killWorker(): Promise<void> {
    this.kills++;
  }
  async runShellCheck(): Promise<boolean> {
    return this.checkResult;
  }
  workerOutputContains(needle: string): boolean {
    return this.outputNeedle === needle;
  }
  emitStatus(status: LoopStatus): void {
    this.statuses.push(status);
  }
  async appendRunLog(entry: string): Promise<void> {
    this.log.push(entry);
  }
  now(): number {
    return this.clock;
  }
  setTimer(ms: number, cb: () => void): () => void {
    this.pendingTimer = { ms, cb };
    return () => {
      this.pendingTimer = null;
    };
  }
}

function makeConfig(over: Partial<LoopConfig>): LoopConfig {
  return { policy: 'ralph', goal: 'do the thing', level: 'L2', ...over };
}

/** Drive one worker iteration to completion: busy then idle. */
async function completeIteration(s: LoopScheduler): Promise<void> {
  s.notifyWorkerState('busy');
  s.notifyWorkerState('idle');
  await flush();
}

describe('LoopScheduler', () => {
  let driver: FakeDriver;
  beforeEach(() => {
    driver = new FakeDriver();
  });

  it('runs iteration 1 on start', async () => {
    const s = new LoopScheduler('t1', makeConfig({}), 'PROMPT', driver);
    await s.start();
    expect(driver.spawns).toEqual([1]);
    expect(s.getStatus().state).toBe('running');
  });

  it('ignores the registration idle before any work (no advance)', async () => {
    const s = new LoopScheduler('t1', makeConfig({ stopPredicate: 'true' }), 'P', driver);
    await s.start();
    s.notifyWorkerState('idle'); // never went busy
    await flush();
    expect(driver.spawns).toEqual([1]); // still iteration 1
  });

  it('ralph: continues to a fresh iteration when the stop check fails', async () => {
    const s = new LoopScheduler('t1', makeConfig({ stopPredicate: 'pnpm test' }), 'P', driver);
    driver.checkResult = false;
    await s.start();
    await completeIteration(s);
    expect(driver.kills).toBe(1); // Ralph reset
    expect(driver.spawns).toEqual([1, 2]); // fresh iteration 2
    expect(s.getStatus().state).toBe('running');
  });

  it('ralph: finishes "done" when the stop check passes', async () => {
    const s = new LoopScheduler('t1', makeConfig({ stopPredicate: 'pnpm test' }), 'P', driver);
    driver.checkResult = true;
    await s.start();
    await completeIteration(s);
    expect(s.getStatus().state).toBe('done');
    expect(driver.spawns).toEqual([1]); // no respawn after done
  });

  it('stops at maxIterations', async () => {
    const s = new LoopScheduler(
      't1',
      makeConfig({ stopPredicate: 'x', maxIterations: 2 }),
      'P',
      driver,
    );
    driver.checkResult = false;
    await s.start();
    await completeIteration(s); // iter 1 -> 2
    await completeIteration(s); // iter 2 -> hits max
    expect(s.getStatus().state).toBe('stopped');
    expect(s.getStatus().reason).toContain('max iterations');
    expect(driver.spawns).toEqual([1, 2]);
  });

  it('count: finishes when the completion promise appears in output', async () => {
    const s = new LoopScheduler(
      't1',
      makeConfig({ policy: 'count', completionPromise: 'ALL DONE', maxIterations: 10 }),
      'P',
      driver,
    );
    driver.outputNeedle = 'ALL DONE';
    await s.start();
    await completeIteration(s);
    expect(s.getStatus().state).toBe('done');
  });

  it('cadence: never self-terminates and waits cadenceMs between runs', async () => {
    const s = new LoopScheduler(
      't1',
      makeConfig({ policy: 'cadence', cadenceMs: 60_000 }),
      'P',
      driver,
    );
    await s.start();
    await completeIteration(s);
    // Did not respawn immediately — a timer is pending.
    expect(driver.spawns).toEqual([1]);
    expect(driver.pendingTimer?.ms).toBe(60_000);
    driver.pendingTimer!.cb(); // fire the cadence timer
    await flush();
    expect(driver.spawns).toEqual([1, 2]);
  });

  it('auto-pauses when the token budget is exceeded', async () => {
    const s = new LoopScheduler('t1', makeConfig({ tokenBudget: 1000 }), 'P', driver);
    await s.start();
    s.noteTokens(1200);
    expect(s.getStatus().state).toBe('paused');
    expect(s.getStatus().reason).toContain('budget');
  });

  it('pause halts advancement; resume kicks the next iteration', async () => {
    const s = new LoopScheduler('t1', makeConfig({ stopPredicate: 'x' }), 'P', driver);
    driver.checkResult = false;
    await s.start();
    s.pause();
    await completeIteration(s); // idle while paused must NOT advance
    expect(driver.spawns).toEqual([1]);
    await s.resume();
    expect(driver.spawns).toEqual([1, 2]);
  });

  it('stop kills the worker and is terminal', async () => {
    const s = new LoopScheduler('t1', makeConfig({}), 'P', driver);
    await s.start();
    await s.stop('user');
    expect(driver.kills).toBe(1);
    expect(s.getStatus().state).toBe('stopped');
    await completeIteration(s); // no effect after stop
    expect(driver.spawns).toEqual([1]);
  });
});
