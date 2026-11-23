/**
 * Notices: what a task with Dash access sends, any time later, to whoever
 * messaged it with `tasks message`. The message's id is the return address.
 *
 * Delivery: a notice goes at once to every running `tasks watch` of its sender
 * that sees the task. With none, it is held, and the first of the sender's
 * watches to see the task on a later check takes it. Senders are callers as
 * `callerString` writes them (`orchestrator`, `task:<id>`), so every outside
 * orchestrator is the one sender "orchestrator": each of their watches gets the
 * notice, and `inReplyTo` (the id `tasks message` returned) tells a sender its own.
 *
 * In memory only: a restart drops return addresses and held notices, and so
 * does deleting the task. No `electron` import, so this loads
 * under vitest.
 */
import { callerString } from '../control/callers';

export interface TaskNotice {
  /** The task that sent it. */
  taskId: string;
  /** The message whose sender it goes to. */
  inReplyTo: string;
  text: string;
  sentAt: number;
}

/** A watch's take on a notice: true when it reported it (it sees that task). */
export type NoticeListener = (notice: TaskNotice) => boolean;

const listeners = new Map<string, Set<NoticeListener>>();
const held = new Map<string, TaskNotice[]>();
/** Each task's return addresses: message id → sender, oldest first. */
const addresses = new Map<string, Map<string, string>>();

/** How many held notices are kept per sender; the oldest go first. */
const HELD_PER_SENDER = 100;
/** How many return addresses are kept per task, far more than the replies `tasks reply` reads. */
const ADDRESSES_PER_TASK = 500;

/** Note that `sender` sent the task message `messageId`, so the task can notify it later. */
export function rememberReturnAddress(taskId: string, messageId: string, sender: string): void {
  const list = addresses.get(taskId) ?? new Map<string, string>();
  list.set(messageId, sender);
  for (const id of list.keys()) {
    if (list.size <= ADDRESSES_PER_TASK) break;
    list.delete(id);
  }
  addresses.set(taskId, list);
}

/** Who sent the task message `messageId`; undefined when unknown (or forgotten). */
export function returnAddress(taskId: string, messageId: string): string | undefined {
  return addresses.get(taskId)?.get(messageId);
}

/** Report `sender`'s notices to `listener` until the returned unsubscribe. */
export function listenForNotices(sender: string, listener: NoticeListener): () => void {
  const set = listeners.get(sender) ?? new Set<NoticeListener>();
  set.add(listener);
  listeners.set(sender, set);
  return () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(sender) === set) listeners.delete(sender);
  };
}

/** Send a notice to `sender`'s watches: every one that sees the task reports it.
 *  Held when none does. */
export function sendNotice(sender: string, notice: TaskNotice): 'delivered' | 'held' {
  let taken = false;
  for (const listener of [...(listeners.get(sender) ?? [])]) {
    if (listener(notice)) taken = true;
  }
  if (taken) return 'delivered';
  const list = held.get(sender) ?? [];
  list.push(notice);
  if (list.length > HELD_PER_SENDER) list.splice(0, list.length - HELD_PER_SENDER);
  held.set(sender, list);
  return 'held';
}

/** Take `sender`'s held notices that `accept` wants (the tasks a watch sees), oldest first. */
export function takeHeldNotices(
  sender: string,
  accept: (notice: TaskNotice) => boolean,
): TaskNotice[] {
  const list = held.get(sender);
  if (!list) return [];
  const taken = list.filter(accept);
  if (taken.length === 0) return [];
  const rest = list.filter((n) => !taken.includes(n));
  if (rest.length > 0) held.set(sender, rest);
  else held.delete(sender);
  return taken;
}

/** Forget a deleted task: its return addresses, the notices it
 *  sent that are still held, and those held for it as a sender. */
export function forgetTaskNotices(taskId: string): void {
  addresses.delete(taskId);
  const asSender = callerString({ kind: 'task', taskId });
  held.delete(asSender);
  listeners.delete(asSender);
  for (const [sender, list] of held) {
    const rest = list.filter((n) => n.taskId !== taskId);
    if (rest.length > 0) held.set(sender, rest);
    else held.delete(sender);
  }
}

/** Tests only. */
export function resetTaskNotices(): void {
  listeners.clear();
  held.clear();
  addresses.clear();
}
