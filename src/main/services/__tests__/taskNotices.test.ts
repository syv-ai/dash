import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetTaskNotices,
  listenForNotices,
  rememberReturnAddress,
  resetTaskNotices,
  returnAddress,
  sendNotice,
  takeHeldNotices,
  type TaskNotice,
} from '../taskNotices';

const notice = (taskId: string, text = 'PR #12 got a review'): TaskNotice => ({
  taskId,
  inReplyTo: 'm_1',
  text,
  sentAt: 1,
});

beforeEach(() => resetTaskNotices());

describe('task notices', () => {
  it('reaches every listening watch of the sender that takes it', () => {
    const a: TaskNotice[] = [];
    const b: TaskNotice[] = [];
    listenForNotices('orchestrator', (n) => (a.push(n), true));
    listenForNotices('orchestrator', (n) => (b.push(n), true));
    listenForNotices('task:other', () => {
      throw new Error('not the sender');
    });
    expect(sendNotice('orchestrator', notice('t1'))).toBe('delivered');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(takeHeldNotices('orchestrator', () => true)).toEqual([]);
  });

  it('is held when no watch of the sender takes it, until one does', () => {
    const stop = listenForNotices('orchestrator', () => false); // doesn't watch t1
    expect(sendNotice('orchestrator', notice('t1'))).toBe('held');
    stop();
    expect(sendNotice('orchestrator', notice('t2'))).toBe('held');
    // A later watch takes the held notices of the tasks it sees, once.
    expect(takeHeldNotices('orchestrator', (n) => n.taskId === 't2')).toEqual([notice('t2')]);
    expect(takeHeldNotices('orchestrator', () => true)).toEqual([notice('t1')]);
    expect(takeHeldNotices('orchestrator', () => true)).toEqual([]);
  });

  it('stops reaching a watch once it unsubscribes', () => {
    const got: TaskNotice[] = [];
    const stop = listenForNotices('orchestrator', (n) => (got.push(n), true));
    stop();
    expect(sendNotice('orchestrator', notice('t1'))).toBe('held');
    expect(got).toEqual([]);
  });

  it('forgets a deleted task: its return addresses, notices it sent, and those held for it', () => {
    rememberReturnAddress('t1', 'm_1', 'orchestrator');
    sendNotice('orchestrator', notice('t1'));
    sendNotice('orchestrator', notice('t2'));
    sendNotice('task:t1', notice('t3'));
    forgetTaskNotices('t1');
    expect(returnAddress('t1', 'm_1')).toBeUndefined();
    expect(takeHeldNotices('orchestrator', () => true)).toEqual([notice('t2')]);
    expect(takeHeldNotices('task:t1', () => true)).toEqual([]);
  });

  it('keeps only the newest held notices per sender', () => {
    for (let i = 0; i < 120; i++) sendNotice('orchestrator', notice('t1', `n${i}`));
    const held = takeHeldNotices('orchestrator', () => true);
    expect(held).toHaveLength(100);
    expect(held[0]!.text).toBe('n20');
  });
});
