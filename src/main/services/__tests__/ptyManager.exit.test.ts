import { describe, it, expect, vi, afterEach } from 'vitest';
import { __testReset, startCommandPty, killPty } from '../ptyManager';

// Real node-pty under Electron's Node ABI (same as production).

const IDS: string[] = [];

afterEach(() => {
  for (const id of IDS.splice(0)) killPty(id);
  __testReset();
});

describe('startCommandPty onExit hook', () => {
  it('fires when the process exits on its own', async () => {
    const onExit = vi.fn();
    IDS.push('service:t1:quick');
    await startCommandPty({
      id: 'service:t1:quick',
      command: '/bin/sh',
      args: ['-c', 'exit 0'],
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      env: {},
      owner: null,
      taskId: 't1',
      featureId: 'ports',
      kind: 'service',
      onExit,
    });
    await vi.waitFor(() => expect(onExit).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('does NOT fire on an explicit killPty (callers notify themselves on stop)', async () => {
    const onExit = vi.fn();
    IDS.push('service:t1:long');
    await startCommandPty({
      id: 'service:t1:long',
      command: '/bin/sh',
      args: ['-c', 'sleep 30'],
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      env: {},
      owner: null,
      taskId: 't1',
      featureId: 'ports',
      kind: 'service',
      onExit,
    });
    await new Promise((r) => setTimeout(r, 300)); // let the shell start
    killPty('service:t1:long');
    await new Promise((r) => setTimeout(r, 500)); // give a stray onExit time to fire
    expect(onExit).not.toHaveBeenCalled();
  });
});
