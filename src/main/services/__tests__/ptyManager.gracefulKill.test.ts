import { describe, it, expect, afterEach } from 'vitest';
import {
  __testReset,
  startCommandPty,
  killPty,
  killPtyAwait,
  killAll,
  hasPty,
  buildClaudeArgs,
  setUltracode,
} from '../ptyManager';

describe('buildClaudeArgs', () => {
  it('resumes by id when a session exists, and never adds --name alongside', () => {
    expect(buildClaudeArgs({ resumeSessionId: 'abc-123', name: 'my-task' })).toEqual([
      '--resume',
      'abc-123',
    ]);
  });

  it('sets --name only on a fresh spawn (no resume id)', () => {
    expect(buildClaudeArgs({ resumeSessionId: null, name: 'my-task' })).toEqual([
      '--name',
      'my-task',
    ]);
  });

  it('omits both when fresh with no name', () => {
    expect(buildClaudeArgs({ resumeSessionId: null })).toEqual([]);
  });

  it('appends permission-mode and keeps the initial prompt last', () => {
    expect(
      buildClaudeArgs({
        resumeSessionId: null,
        name: 'my-task',
        permissionMode: 'acceptEdits',
        initialPrompt: 'do the thing',
      }),
    ).toEqual(['--name', 'my-task', '--permission-mode', 'acceptEdits', 'do the thing']);
  });

  it('maps bypassPermissions to the skip flag', () => {
    expect(
      buildClaudeArgs({ resumeSessionId: 'abc-123', permissionMode: 'bypassPermissions' }),
    ).toEqual(['--resume', 'abc-123', '--dangerously-skip-permissions']);
  });

  it('appends the ultracode --settings flag before the prompt when enabled', () => {
    setUltracode(true);
    try {
      expect(buildClaudeArgs({ resumeSessionId: null, name: 't', initialPrompt: 'go' })).toEqual([
        '--name',
        't',
        '--settings',
        '{"ultracode":true}',
        'go',
      ]);
    } finally {
      setUltracode(false); // module-global; don't leak into other cases
    }
  });

  it('omits the ultracode flag when disabled (default)', () => {
    expect(buildClaudeArgs({ resumeSessionId: null })).toEqual([]);
  });
});

// Real node-pty under Electron's Node ABI (same as production). Graceful kill
// sends SIGTERM and waits for the child to exit before resolving, escalating to
// SIGKILL only past the grace window.

const IDS: string[] = [];

async function spawnSleep(id: string, script = 'sleep 30') {
  IDS.push(id);
  await startCommandPty({
    id,
    command: '/bin/sh',
    args: ['-c', script],
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    env: {},
    owner: null,
    taskId: 't1',
    featureId: 'ports',
    kind: 'service',
  });
  await new Promise((r) => setTimeout(r, 200)); // let the shell start
}

afterEach(() => {
  for (const id of IDS.splice(0)) killPty(id);
  __testReset();
});

describe('killPtyAwait (graceful kill)', () => {
  it('resolves only after the process is gone, and removes it from the registry', async () => {
    await spawnSleep('service:t1:graceful');
    expect(hasPty('service:t1:graceful')).toBe(true);

    await killPtyAwait('service:t1:graceful');

    expect(hasPty('service:t1:graceful')).toBe(false);
  });

  it('exits a SIGTERM-respecting child well within the grace window', async () => {
    await spawnSleep('service:t1:fast');
    const start = Date.now();
    await killPtyAwait('service:t1:fast');
    // `sleep` dies on SIGTERM immediately — must not wait out the 3s grace.
    expect(Date.now() - start).toBeLessThan(1500);
  });

  it('resolves immediately when the id is unknown', async () => {
    await expect(killPtyAwait('service:t1:nope')).resolves.toBeUndefined();
  });

  it('killAll awaits every child and empties the registry', async () => {
    await spawnSleep('service:t1:a');
    await spawnSleep('service:t1:b');
    await killAll();
    expect(hasPty('service:t1:a')).toBe(false);
    expect(hasPty('service:t1:b')).toBe(false);
  });
});
