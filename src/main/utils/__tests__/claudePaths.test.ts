import { describe, it, expect } from 'vitest';
import { encodeProjectPath } from '../claudePaths';

describe('encodeProjectPath', () => {
  // Real directory names Claude Code 2.1.282 created under ~/.claude/projects.
  it.each([
    [
      '/home/fabian-scott/Documents/Git-Projects/dash',
      '-home-fabian-scott-Documents-Git-Projects-dash',
    ],
    [
      '/home/fabian-scott/Documents/Git-Projects/dash/.claude/worktrees/claude-s-memories-f6c',
      '-home-fabian-scott-Documents-Git-Projects-dash--claude-worktrees-claude-s-memories-f6c',
    ],
  ])('encodes %s like Claude Code', (input, expected) => {
    expect(encodeProjectPath(input)).toBe(expected);
  });

  it('hyphenates every non-alphanumeric character, on every platform', () => {
    expect(encodeProjectPath('/tmp/a:b_c d.e')).toBe('-tmp-a-b-c-d-e');
    expect(encodeProjectPath('C:\\Users\\foo')).toBe('C--Users-foo');
  });

  it('truncates names over 200 chars and appends a base36 hash of the raw path', () => {
    const long = '/home/u/' + 'very-long-directory-name/'.repeat(9) + 'repo';
    expect(encodeProjectPath(long)).toBe(
      '-home-u-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directory-name-very-long-directo-xabdzz',
    );
  });

  it('leaves names of exactly 200 chars untouched', () => {
    const p = '/' + 'a'.repeat(199);
    expect(encodeProjectPath(p)).toBe('-' + 'a'.repeat(199));
  });
});
