/**
 * A task session's inbox: the Unix socket Claude Code binds for every session
 * that is not `--bare`, and the per-session token that goes with it. Claude
 * Code exports both to the session's hooks as `CLAUDE_CODE_MESSAGING_SOCKET`
 * and `CLAUDE_CODE_MESSAGING_TOKEN`; Dash's SessionStart and UserPromptSubmit
 * hooks send them to the HookServer, which keeps them here.
 *
 * In memory only: the token is a secret, never persisted or logged. An inbox
 * is dropped when its session ends, when its task goes, and when a write to it
 * fails.
 *
 * One connection per message: the auth line, the one user line, then close.
 * The token makes the message count as the session's own child, so a session
 * in bypassPermissions takes it without a Deliver click; Claude Code tells the
 * model it came from another session, so it approves nothing. An idle session
 * starts a turn with it; a working one reads it after the tool call in flight.
 * The socket answers nothing, so all this can say is whether the bytes were
 * taken. It never retries: a message sent twice is a turn taken twice.
 *
 * No `electron` import, so this loads under vitest.
 */
import { createConnection } from 'net';

/** Where one session takes messages, as its hooks reported it. */
export interface TaskInbox {
  socket: string;
  token: string;
  /** The session's transcript, from the same hook payload; null when it sent none. */
  transcriptPath: string | null;
}

const inboxes = new Map<string, TaskInbox>();

export function setTaskInbox(taskId: string, inbox: TaskInbox): void {
  inboxes.set(taskId, inbox);
}

export function getTaskInbox(taskId: string): TaskInbox | undefined {
  return inboxes.get(taskId);
}

export function dropTaskInbox(taskId: string): void {
  inboxes.delete(taskId);
}

/** Claude Code closes a connection that sends no complete line in 30 s; a
 *  message is two short lines, so a few seconds is already a dead session. */
const TIMEOUT_MS = 5_000;

/** Why a write did not go through. `delivered: false` means the session
 *  certainly did not get it; true means it may have (sending again could make
 *  it take the turn twice). */
export class InboxWriteError extends Error {
  readonly delivered: 'no' | 'unknown';
  constructor(message: string, delivered: 'no' | 'unknown') {
    super(message);
    this.name = 'InboxWriteError';
    this.delivered = delivered;
  }
}

/** The bytes one message is: the auth line, then the user line. */
export function inboxLines(token: string, text: string): string {
  return (
    JSON.stringify({ type: 'auth', token }) +
    '\n' +
    JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) +
    '\n'
  );
}

/** Write one message into a session's inbox. Resolves once the socket took the
 *  bytes; rejects with an InboxWriteError otherwise. */
export function postToInbox(
  inbox: Pick<TaskInbox, 'socket' | 'token'>,
  text: string,
  timeoutMs = TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let connected = false;
    const done = (error?: InboxWriteError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const conn = createConnection(inbox.socket);
    const timer = setTimeout(() => {
      conn.destroy();
      done(
        new InboxWriteError(
          "the session's inbox did not answer in time",
          connected ? 'unknown' : 'no',
        ),
      );
    }, timeoutMs);
    conn.on('error', (err: NodeJS.ErrnoException) => {
      const gone = err.code === 'ENOENT' || err.code === 'ECONNREFUSED';
      done(
        new InboxWriteError(
          gone
            ? 'the session is no longer taking messages (its inbox socket is gone)'
            : `the session's inbox did not take the message: ${err.message}`,
          connected ? 'unknown' : 'no',
        ),
      );
    });
    conn.on('connect', () => {
      connected = true;
      conn.end(inboxLines(inbox.token, text), () => {
        conn.destroy();
        done();
      });
    });
  });
}

/** One message Dash wrote into a task's inbox, kept for `tasks reply`. */
export interface TaskMessageRecord {
  messageId: string;
  sentAt: number;
  /** The task was working when it was sent, so its running turn read it. */
  queued: boolean;
  noReply: boolean;
  /** The transcript the session wrote to when the message went out. */
  transcriptPath: string | null;
}

/** How many messages per task are kept for reply lookups. */
const MESSAGES_PER_TASK = 20;
const messages = new Map<string, TaskMessageRecord[]>();

export function recordTaskMessage(taskId: string, record: TaskMessageRecord): void {
  const list = messages.get(taskId) ?? [];
  list.push(record);
  if (list.length > MESSAGES_PER_TASK) list.splice(0, list.length - MESSAGES_PER_TASK);
  messages.set(taskId, list);
}

export function findTaskMessage(taskId: string, messageId: string): TaskMessageRecord | undefined {
  return messages.get(taskId)?.find((m) => m.messageId === messageId);
}

export function taskMessages(taskId: string): readonly TaskMessageRecord[] {
  return messages.get(taskId) ?? [];
}

/** Forget a task: its inbox and its messages (task archived or deleted). */
export function forgetTask(taskId: string): void {
  inboxes.delete(taskId);
  messages.delete(taskId);
}

/** Tests only. */
export function resetTaskInboxes(): void {
  inboxes.clear();
  messages.clear();
}
