import { describe, expect, it } from 'vitest';
import type { ActivityInfo } from '@shared/types';
import { idleTaskIds } from '../idleTasks';

describe('idleTaskIds', () => {
  const activity: Record<string, ActivityInfo> = {
    done: { state: 'idle' },
    open: { state: 'idle' },
    working: { state: 'busy' },
    asking: { state: 'waiting' },
    failed: { state: 'error' },
    asleep: { state: 'stopped' },
    compacting: { state: 'idle', compacting: true },
  };

  it('takes live sessions at rest, never the task on screen', () => {
    expect(idleTaskIds(activity, 'open')).toEqual(['done']);
    expect(idleTaskIds(activity, null)).toEqual(['done', 'open']);
  });
});
