import { describe, it, expect, vi, afterEach } from 'vitest';
import { __testReset, startCommandPty, startPty, killPty } from '../ptyManager';

// Real node-pty under Electron's Node ABI (same as production) — these tests
// spawn actual shells; generous polls keep them robust under suite load.

function fakeSender() {
  return { send: vi.fn(), isDestroyed: () => false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollUntil(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await sleep(50);
  }
  return cond();
}

function sentData(sender: ReturnType<typeof fakeSender>): string {
  return (sender.send.mock.calls as Array<[string, unknown]>)
    .filter(([ch]) => ch.startsWith('pty:data:'))
    .map(([, chunk]) => String(chunk))
    .join('');
}

const IDS: string[] = [];

function spawnService(id: string, command: string): Promise<unknown> {
  IDS.push(id);
  return startCommandPty({
    id,
    command: '/bin/sh',
    args: ['-c', command],
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    env: {},
    owner: null,
    taskId: 't1',
    featureId: 'ports',
    kind: 'service',
  });
}

afterEach(() => {
  for (const id of IDS.splice(0)) killPty(id);
  __testReset();
});

describe('command PTY output before first attach', () => {
  it('output emitted before the renderer attaches reaches it after attach', async () => {
    await spawnService('service:t1:web', 'echo BANNER_MARKER; sleep 5');
    // Let the shell start and print while nobody is attached.
    await sleep(500);

    const sender = fakeSender();
    const r = await startPty({
      id: 'service:t1:web',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      sender: sender as never,
    });
    expect(r.reattached).toBe(true);
    const got = await pollUntil(() => sentData(sender).includes('BANNER_MARKER'), 3000);
    expect(got).toBe(true);
  }, 10_000);

  it('does not replay the early output to a second attach', async () => {
    await spawnService('service:t1:web2', 'echo EARLY_MARKER; sleep 5');
    await sleep(500);

    const first = fakeSender();
    await startPty({
      id: 'service:t1:web2',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      sender: first as never,
    });
    await pollUntil(() => sentData(first).includes('EARLY_MARKER'), 3000);

    const second = fakeSender();
    await startPty({
      id: 'service:t1:web2',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      sender: second as never,
    });
    await sleep(300);
    expect(sentData(second)).not.toContain('EARLY_MARKER');
  }, 10_000);

  it('caps the unowned buffer instead of growing without bound', async () => {
    await spawnService('service:t1:big', 'yes 0123456789 | head -c 2000000; sleep 5');
    // Wait for the 2MB burst to finish while unowned.
    await sleep(1500);

    const sender = fakeSender();
    await startPty({
      id: 'service:t1:big',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      sender: sender as never,
    });
    await sleep(300);
    const total = sentData(sender).length;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(600_000);
  }, 15_000);
});
