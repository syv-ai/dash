import { describe, it, expect } from 'vitest';
import { resolveHookRouting } from '../hookTaskResolver';

const tasks = [
  { id: 'root', sessionId: 'sess-root' },
  { id: 'ball', sessionId: 'sess-ball' },
  { id: 'fresh', sessionId: null },
];

describe('resolveHookRouting', () => {
  it("handles the copy delivered under the session owner's own id", () => {
    expect(resolveHookRouting('ball', { session_id: 'sess-ball' }, tasks)).toEqual({
      taskId: 'ball',
      duplicate: false,
    });
  });

  it('marks the leaked root-settings copy of a worktree session as a duplicate', () => {
    expect(resolveHookRouting('root', { session_id: 'sess-ball' }, tasks)).toEqual({
      taskId: 'ball',
      duplicate: true,
    });
  });

  it('ignores cwd: a root session that cd-ed into a worktree stays the root task', () => {
    const payload = { session_id: 'sess-root', cwd: '/p/.claude/worktrees/ball' };
    expect(resolveHookRouting('root', payload, tasks)).toEqual({
      taskId: 'root',
      duplicate: false,
    });
  });

  it('falls back to the URL id for an unknown session (e.g. a non-task worktree)', () => {
    expect(resolveHookRouting('root', { session_id: 'sess-sub' }, tasks)).toEqual({
      taskId: 'root',
      duplicate: false,
    });
  });

  it('falls back to the URL id without a session id', () => {
    expect(resolveHookRouting('fresh', {}, tasks)).toEqual({ taskId: 'fresh', duplicate: false });
  });
});
