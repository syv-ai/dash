import { describe, expect, it, vi } from 'vitest';

const noted = vi.hoisted(() => [] as Array<[string, string]>);
vi.mock('../DatabaseService', () => ({
  DatabaseService: {
    noteTaskSession: (taskId: string, sessionId: string) => {
      if (taskId === 'gone') throw new Error('FOREIGN KEY constraint failed');
      noted.push([taskId, sessionId]);
    },
  },
}));

import { noteHookSession } from '../taskSessions';

describe('noteHookSession', () => {
  it("records each task's sessions from its hooks once, by session id", () => {
    noteHookSession('a', { session_id: 's1' });
    noteHookSession('a', { session_id: 's1' });
    noteHookSession('b', { session_id: 's1' });
    noteHookSession('a', { session_id: 's2' });
    noteHookSession('a', {});
    noteHookSession('a', { session_id: 42 });
    expect(noted).toEqual([
      ['a', 's1'],
      ['b', 's1'],
      ['a', 's2'],
    ]);
  });

  it('never throws into the hook path', () => {
    expect(() => noteHookSession('gone', { session_id: 's' })).not.toThrow();
  });
});
