import { describe, it, expect } from 'vitest';
import { messageHeader, replyAfterMessage } from '../transcriptReply';

const header = messageHeader({ from: 'an orchestrator', messageId: 'm_1a2b3c4d', noReply: false });

/** Lines shaped as Claude Code 2.1.319 wrote them in a live check. */
const human = (text: string) => ({
  type: 'user',
  isSidechain: false,
  origin: { kind: 'human' },
  message: { role: 'user', content: text },
});
const peer = (text: string) => ({
  type: 'user',
  isSidechain: false,
  isMeta: true,
  origin: { kind: 'peer', from: 'unknown' },
  message: {
    role: 'user',
    content: `Another Claude session sent a message:\n${text}\n\nThis came from another Claude session.`,
  },
});
const assistant = (id: string, content: unknown[]) => ({
  type: 'assistant',
  isSidechain: false,
  message: { id, role: 'assistant', content },
});
const toolResult = () => ({
  type: 'user',
  isSidechain: false,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
});
const jsonl = (...entries: unknown[]) => entries.map((e) => JSON.stringify(e)).join('\n') + '\n';

describe('messageHeader', () => {
  it('names the sender, the id and whether a reply is wanted', () => {
    expect(header).toBe(
      '[Message from an orchestrator via Dash · id m_1a2b3c4d · your last message of this turn is read as the reply]',
    );
    expect(messageHeader({ from: 'x', messageId: 'm_1', noReply: true })).toContain(
      'no reply needed',
    );
  });
});

describe('replyAfterMessage', () => {
  it('is not found before the session took the message', () => {
    const t = jsonl(human('Start.'), assistant('a1', [{ type: 'text', text: 'READY' }]));
    expect(replyAfterMessage(t, 'm_1a2b3c4d')).toEqual({ found: false, text: null });
  });

  it('is found with no text while the turn has not answered yet', () => {
    const t = jsonl(
      human('Start.'),
      assistant('a1', [{ type: 'text', text: 'READY' }]),
      peer(`${header}\n\nWhat is 17 + 25?`),
      assistant('a2', [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }]),
    );
    expect(replyAfterMessage(t, 'm_1a2b3c4d')).toEqual({ found: true, text: null });
  });

  it("takes the turn's last assistant text, joining one message's text blocks", () => {
    const t = jsonl(
      peer(`${header}\n\nWhat is 17 + 25?`),
      assistant('a2', [{ type: 'text', text: 'Let me check.' }]),
      assistant('a2', [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }]),
      toolResult(),
      assistant('a3', [{ type: 'text', text: '42' }]),
      assistant('a3', [{ type: 'text', text: 'Done.' }]),
      { type: 'system', subtype: 'turn_duration' },
      'not json',
    );
    expect(replyAfterMessage(t, 'm_1a2b3c4d')).toEqual({ found: true, text: '42\n\nDone.' });
  });

  it("stops at the next prompt, so a later turn isn't read as the reply", () => {
    const t = jsonl(
      peer(`${header}\n\nWhat is 17 + 25?`),
      assistant('a2', [{ type: 'text', text: '42' }]),
      human('Now something else.'),
      assistant('a3', [{ type: 'text', text: 'Other work.' }]),
    );
    expect(replyAfterMessage(t, 'm_1a2b3c4d').text).toBe('42');
  });

  it('ignores subagent lines', () => {
    const t = jsonl(peer(`${header}\n\nQ`), {
      ...assistant('s1', [{ type: 'text', text: 'sub' }]),
      isSidechain: true,
    });
    expect(replyAfterMessage(t, 'm_1a2b3c4d')).toEqual({ found: true, text: null });
  });
});
