import { describe, it, expect, vi, afterEach } from 'vitest';
import { __testReset, startCommandPty, startPty, killPty } from '../ptyManager';

// Real node-pty under Electron's Node ABI (same as production).

function fakeSender() {
  return { send: vi.fn(), isDestroyed: () => false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

describe('PTY mirror', () => {
  it('output before first attach is in the reattach serializedState', async () => {
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
    expect(r.serializedState ?? '').toContain('BANNER_MARKER');
  }, 10_000);

  it('a second reattach still carries the content (mirror persists)', async () => {
    await spawnService('service:t1:web2', 'echo EARLY_MARKER; sleep 5');
    await sleep(500);

    await startPty({
      id: 'service:t1:web2',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      sender: fakeSender() as never,
    });
    const r2 = await startPty({
      id: 'service:t1:web2',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      sender: fakeSender() as never,
    });
    expect(r2.serializedState ?? '').toContain('EARLY_MARKER');
  }, 10_000);
});
