import { describe, it, expect, vi, afterEach } from 'vitest';
import { __testReset, startCommandPty, startPty, killPty, readPtyText } from '../ptyManager';

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

  it('readPtyText returns the mirror as plain text, null for an unknown PTY', async () => {
    await spawnService('service:t1:text', 'printf "\\033[32mgreen\\033[0m\\nplain\\n"; sleep 5');
    await sleep(500);
    expect(await readPtyText('service:t1:text', 2)).toBe('green\nplain');
    expect(await readPtyText('service:t1:none', 2)).toBeNull();
  }, 10_000);
});
