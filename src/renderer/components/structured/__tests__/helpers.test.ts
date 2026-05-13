import { describe, it, expect } from 'vitest';
import { shortenPath } from '../viewers/FilePathLink';
import { extractResultText } from '../viewers/extractResultText';
import { formatDuration } from '../ToolCallCard';
import type { LinkedToolExecution } from '../../../../shared/sessionTypes';

describe('shortenPath', () => {
  it('strips everything before the task parent for paths inside the worktree', () => {
    expect(
      shortenPath(
        '/Users/foo/repos/syv/worktrees/abc/src/main.ts',
        '/Users/foo/repos/syv/worktrees/abc',
      ),
    ).toBe('worktrees/abc/src/main.ts');
  });

  it('handles Windows-style backslash paths inside the worktree', () => {
    expect(
      shortenPath('C:\\Users\\foo\\worktrees\\abc\\src\\main.ts', 'C:\\Users\\foo\\worktrees\\abc'),
    ).toBe('worktrees/abc/src/main.ts');
  });

  it('returns the absolute path unchanged when it is not inside the task', () => {
    expect(shortenPath('/etc/hosts', '/Users/foo/worktrees/abc')).toBe('/etc/hosts');
  });

  it('returns the absolute path unchanged when taskPath is empty', () => {
    expect(shortenPath('/Users/foo/bar.ts', '')).toBe('/Users/foo/bar.ts');
  });

  it('returns the prefix-only display when absPath equals taskPath', () => {
    expect(shortenPath('/Users/foo/worktrees/abc', '/Users/foo/worktrees/abc')).toBe(
      'worktrees/abc',
    );
  });
});

describe('formatDuration', () => {
  it('returns null for sub-2s durations — UX contract: not worth surfacing', () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(500)).toBeNull();
    expect(formatDuration(1999)).toBeNull();
  });

  it('formats 2s+ as integer seconds below 1 minute', () => {
    expect(formatDuration(2000)).toBe('2s');
    expect(formatDuration(15500)).toBe('16s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('formats minutes+seconds at the minute boundary', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(125_000)).toBe('2m 5s');
  });

  it('omits the seconds suffix when it would be zero', () => {
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(120_000)).toBe('2m');
  });
});

describe('extractResultText', () => {
  function exec(
    content: LinkedToolExecution['result'] extends infer R ? R : never,
  ): LinkedToolExecution {
    return {
      toolCall: { id: 't', name: 'Bash', input: {} },
      result: content,
      startTime: '0',
    };
  }

  it('returns the empty string when there is no result', () => {
    expect(extractResultText(exec(undefined))).toBe('');
  });

  it('passes string content through unchanged', () => {
    expect(extractResultText(exec({ toolUseId: 't', content: 'hello', isError: false }))).toBe(
      'hello',
    );
  });

  it('joins text blocks from a content array, ignoring non-text blocks', () => {
    const result = extractResultText(
      exec({
        toolUseId: 't',
        content: [
          { type: 'text', text: 'one' },
          { type: 'image', source: {} },
          { type: 'text', text: 'two' },
        ],
        isError: false,
      }),
    );
    expect(result).toBe('one\ntwo');
  });
});
