import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { claudeConfigDir, claudeProjectDir, encodeProjectPath } from '../claudePaths';

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

describe('claudeConfigDir / claudeProjectDir', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
  });

  it('defaults to ~/.claude', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(claudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
  });

  it('honours CLAUDE_CONFIG_DIR, treating empty as unset', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/alt-claude';
    expect(claudeConfigDir()).toBe('/tmp/alt-claude');
    process.env.CLAUDE_CONFIG_DIR = '';
    expect(claudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
  });

  it('places a cwd under <config dir>/projects/<encoded>', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/alt-claude';
    expect(claudeProjectDir('/repo/.claude/worktrees/x')).toBe(
      '/tmp/alt-claude/projects/-repo--claude-worktrees-x',
    );
  });
});
