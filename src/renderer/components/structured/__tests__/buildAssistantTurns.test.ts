import { describe, it, expect } from 'vitest';
import { buildAssistantTurns } from '../StructuredView';
import type { ParsedSessionMessage, ContentBlock } from '../../../../shared/sessionTypes';

function msg(partial: Partial<ParsedSessionMessage>): ParsedSessionMessage {
  return {
    uuid: 'u',
    parentUuid: null,
    type: 'assistant',
    timestamp: '2025-01-01T00:00:00Z',
    content: '',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...partial,
  };
}

const text = (t: string): ContentBlock[] => [{ type: 'text', text: t }];

describe('buildAssistantTurns', () => {
  it('returns no turns when given an empty list', () => {
    expect(buildAssistantTurns([])).toEqual([]);
  });

  it('groups assistant messages until a real (non-meta) user message flushes the turn', () => {
    const turns = buildAssistantTurns([
      msg({ uuid: 'a1', type: 'assistant', content: text('hi') }),
      msg({ uuid: 'u1', type: 'user', content: text('next'), isMeta: false }),
      msg({ uuid: 'a2', type: 'assistant', content: text('yo') }),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0].id).toBe('a1');
    expect(turns[1].id).toBe('a2');
  });

  it('does NOT flush on a meta user message (tool result carrier)', () => {
    const turns = buildAssistantTurns([
      msg({ uuid: 'a1', type: 'assistant', content: text('first') }),
      msg({ uuid: 'um', type: 'user', isMeta: true, toolResults: [] }),
      msg({ uuid: 'a2', type: 'assistant', content: text('second') }),
    ]);
    // Single turn — meta user must not break it
    expect(turns).toHaveLength(1);
    expect(turns[0].id).toBe('a1');
    expect(turns[0].textOutput).toContain('first');
    expect(turns[0].textOutput).toContain('second');
  });

  it('skips sidechain entries entirely', () => {
    const turns = buildAssistantTurns([
      msg({ uuid: 'a1', type: 'assistant', content: text('main') }),
      msg({ uuid: 'side', type: 'assistant', isSidechain: true, content: text('subagent') }),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].textOutput).toBe('main');
  });

  it('skips synthetic assistant messages without splitting the turn', () => {
    const turns = buildAssistantTurns([
      msg({ uuid: 'a1', type: 'assistant', content: text('a') }),
      msg({ uuid: 'syn', type: 'assistant', model: '<synthetic>', content: text('skip me') }),
      msg({ uuid: 'a2', type: 'assistant', content: text('b') }),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].textOutput).toContain('a');
    expect(turns[0].textOutput).toContain('b');
    expect(turns[0].textOutput).not.toContain('skip me');
  });

  it('accumulates usage across multiple assistant entries in a turn (sum, not last-write-wins)', () => {
    const turns = buildAssistantTurns([
      msg({
        uuid: 'a1',
        type: 'assistant',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 },
      }),
      msg({
        uuid: 'a2',
        type: 'assistant',
        usage: { input_tokens: 20, output_tokens: 15, cache_read_input_tokens: 3 },
      }),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].usage).toEqual({
      input_tokens: 30,
      output_tokens: 20,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 0,
    });
  });

  it('links tool calls to their results and computes durationMs', () => {
    const turns = buildAssistantTurns([
      msg({
        uuid: 'a1',
        type: 'assistant',
        timestamp: '2025-01-01T00:00:00Z',
        toolCalls: [{ id: 'tu_1', name: 'Bash', input: { command: 'ls' } }],
      }),
      msg({
        uuid: 'um',
        type: 'user',
        timestamp: '2025-01-01T00:00:05Z',
        isMeta: true,
        toolResults: [{ toolUseId: 'tu_1', content: 'ok', isError: false }],
      }),
    ]);
    expect(turns[0].toolExecutions).toHaveLength(1);
    const exec = turns[0].toolExecutions[0];
    expect(exec.result?.content).toBe('ok');
    expect(exec.durationMs).toBe(5000);
  });

  it('leaves durationMs undefined when the matching result never arrived', () => {
    const turns = buildAssistantTurns([
      msg({
        uuid: 'a1',
        type: 'assistant',
        toolCalls: [{ id: 'tu_pending', name: 'Bash', input: {} }],
      }),
    ]);
    expect(turns[0].toolExecutions[0].durationMs).toBeUndefined();
    expect(turns[0].toolExecutions[0].result).toBeUndefined();
  });
});
