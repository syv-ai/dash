/**
 * A task's reply to a message Dash wrote into its inbox (taskInbox.ts), read
 * from the session's transcript JSONL. Pure: the caller reads the file.
 *
 * Claude Code writes an inbox message as a `user` entry (`isMeta`, `origin:
 * { kind: 'peer' }`) whose text wraps the message, header line included, so
 * the message's id finds it. The reply is the last assistant text after it,
 * up to the next prompt (a person's, or another session's message).
 */

/** The header the task sees above a message's body; `messageIdMarker` finds it again. */
export function messageHeader(opts: { from: string; messageId: string; noReply: boolean }): string {
  const ask = opts.noReply
    ? 'no reply needed'
    : 'your last message of this turn is read as the reply';
  return `[Message from ${opts.from} via Dash · id ${opts.messageId} · ${ask}]`;
}

const messageIdMarker = (messageId: string) => `via Dash · id ${messageId} ·`;

interface Entry {
  type?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  origin?: { kind?: unknown };
  message?: { id?: unknown; content?: unknown };
}

/** The text blocks of an entry's content (a plain string counts as one). */
function textOf(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        !!b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string',
    )
    .map((b) => b.text);
}

/** A user entry that starts new work: a person's prompt or another session's message
 *  (tool results and Claude Code's own meta lines don't). */
function isPrompt(e: Entry): boolean {
  const kind = e.origin?.kind;
  if (kind === 'human' || kind === 'peer') return true;
  return kind === undefined && e.isMeta !== true && textOf(e.message?.content).length > 0;
}

export interface TranscriptReply {
  /** The message is in the transcript (the session took it). */
  found: boolean;
  /** The last assistant text after it; null when there is none yet. */
  text: string | null;
}

export function replyAfterMessage(jsonl: string, messageId: string): TranscriptReply {
  const marker = messageIdMarker(messageId);
  let found = false;
  let lastId: unknown = null;
  let parts: string[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let e: Entry;
    try {
      e = JSON.parse(line) as Entry;
    } catch {
      continue; // a line being written
    }
    if (!e || typeof e !== 'object' || e.isSidechain === true) continue;
    if (e.type === 'user') {
      if (!found) {
        found = textOf(e.message?.content).some((t) => t.includes(marker));
      } else if (isPrompt(e)) {
        break;
      }
      continue;
    }
    if (!found || e.type !== 'assistant') continue;
    const texts = textOf(e.message?.content).filter((t) => t.trim());
    if (texts.length === 0) continue;
    // Claude Code writes one line per content block; blocks of one message share its id.
    const id = e.message?.id ?? null;
    if (id === null || id !== lastId) parts = [];
    lastId = id;
    parts.push(...texts);
  }
  return { found, text: found && parts.length > 0 ? parts.join('\n\n') : null };
}
