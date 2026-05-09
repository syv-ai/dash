import { describe, it, expect } from 'vitest';
import {
  parseJsonlLine,
  deduplicateByRequestId,
  calculateMetrics,
  encodeProjectPath,
} from '../jsonlParser';
import type { ParsedSessionMessage } from '../../../shared/sessionTypes';

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

describe('parseJsonlLine', () => {
  it('returns null for empty / whitespace-only lines', () => {
    expect(parseJsonlLine('')).toBeNull();
    expect(parseJsonlLine('   ')).toBeNull();
    expect(parseJsonlLine('\n\t')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseJsonlLine('not json')).toBeNull();
    expect(parseJsonlLine('{"unterminated')).toBeNull();
  });

  it('returns null for entries without a uuid', () => {
    expect(parseJsonlLine(JSON.stringify({ type: 'assistant', timestamp: 'now' }))).toBeNull();
  });

  it('returns null for unknown entry types — forward-compat with schema bumps', () => {
    expect(
      parseJsonlLine(JSON.stringify({ uuid: 'x', type: 'something-new', timestamp: 'now' })),
    ).toBeNull();
  });

  it('parses a minimal assistant entry', () => {
    const line = JSON.stringify({
      uuid: 'a1',
      type: 'assistant',
      timestamp: '2025-01-01T00:00:00Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    });
    const out = parseJsonlLine(line);
    expect(out).not.toBeNull();
    expect(out!.uuid).toBe('a1');
    expect(out!.type).toBe('assistant');
    expect(out!.role).toBe('assistant');
  });

  it('extracts tool_use and tool_result blocks', () => {
    const line = JSON.stringify({
      uuid: 'a2',
      type: 'assistant',
      timestamp: 't',
      message: {
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false },
        ],
      },
    });
    const out = parseJsonlLine(line)!;
    expect(out.toolCalls).toEqual([{ id: 'tu_1', name: 'Bash', input: { command: 'ls' } }]);
    expect(out.toolResults).toEqual([{ toolUseId: 'tu_1', content: 'ok', isError: false }]);
  });
});

describe('deduplicateByRequestId', () => {
  it('keeps only the LAST entry per requestId — Claude Code streams multiple, only last has final tokens', () => {
    const a = msg({ uuid: 'a', requestId: 'r1', usage: { input_tokens: 10, output_tokens: 0 } });
    const b = msg({ uuid: 'b', requestId: 'r1', usage: { input_tokens: 10, output_tokens: 50 } });
    const c = msg({ uuid: 'c', requestId: 'r2' });
    const out = deduplicateByRequestId([a, b, c]);
    expect(out.map((m) => m.uuid)).toEqual(['b', 'c']);
  });

  it('preserves entries without requestId untouched', () => {
    const a = msg({ uuid: 'a' });
    const b = msg({ uuid: 'b' });
    expect(deduplicateByRequestId([a, b])).toHaveLength(2);
  });

  it('returns the input array unchanged when nothing has a requestId', () => {
    const input = [msg({ uuid: 'a' }), msg({ uuid: 'b' })];
    expect(deduplicateByRequestId(input)).toBe(input);
  });
});

describe('calculateMetrics', () => {
  it('returns zeroed metrics for an empty list', () => {
    expect(calculateMetrics([])).toEqual({
      durationMs: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      messageCount: 0,
    });
  });

  it('sums input/output/cache tokens across entries', () => {
    const a = msg({ usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 } });
    const b = msg({ usage: { input_tokens: 200, output_tokens: 75, cache_read_input_tokens: 10 } });
    const m = calculateMetrics([a, b]);
    expect(m.inputTokens).toBe(300);
    expect(m.outputTokens).toBe(125);
    expect(m.cacheReadTokens).toBe(30);
    expect(m.totalTokens).toBe(300 + 125 + 30);
    expect(m.messageCount).toBe(2);
  });

  it('computes durationMs from min/max valid timestamps; ignores NaN', () => {
    const a = msg({ timestamp: '2025-01-01T00:00:00Z' });
    const b = msg({ timestamp: 'not a date' });
    const c = msg({ timestamp: '2025-01-01T00:00:30Z' });
    const m = calculateMetrics([a, b, c]);
    expect(m.durationMs).toBe(30_000);
  });

  it('returns durationMs=0 when only one valid timestamp exists', () => {
    const a = msg({ timestamp: '2025-01-01T00:00:00Z' });
    expect(calculateMetrics([a]).durationMs).toBe(0);
  });
});

describe('encodeProjectPath', () => {
  it('replaces forward slashes with hyphens (POSIX behavior)', () => {
    // This branch runs on whatever platform the tests execute on; on Windows
    // CI the colon would also be replaced. The POSIX assertion is the
    // contract on Linux/macOS hosts.
    if (process.platform !== 'win32') {
      expect(encodeProjectPath('/Users/foo/bar')).toBe('-Users-foo-bar');
    }
  });

  it('does NOT replace colons on POSIX (a path can legally contain :)', () => {
    if (process.platform !== 'win32') {
      expect(encodeProjectPath('/tmp/a:b')).toBe('-tmp-a:b');
    }
  });

  it('replaces \\, /, and : on Windows', () => {
    if (process.platform === 'win32') {
      expect(encodeProjectPath('C:\\Users\\foo')).toBe('C--Users-foo');
      expect(encodeProjectPath('C:/Users/foo')).toBe('C--Users-foo');
    }
  });
});
