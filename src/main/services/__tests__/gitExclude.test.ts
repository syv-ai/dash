import { describe, it, expect } from 'vitest';
import {
  hasExcludeEntry,
  LOCAL_CONFIG_EXCLUDE_ENTRY,
  withExcludeEntry,
  WORKTREES_EXCLUDE_ENTRY,
} from '../gitExclude';

describe('gitExclude', () => {
  it('appends the entry with a comment to an empty file', () => {
    expect(withExcludeEntry('', WORKTREES_EXCLUDE_ENTRY)).toBe(
      '# Dash task worktrees\n.claude/worktrees/\n',
    );
  });

  it('says why above each entry it adds: the personal config gets its own line', () => {
    expect(withExcludeEntry('', LOCAL_CONFIG_EXCLUDE_ENTRY)).toBe(
      '# Dash personal project config\n.dash/config.local.json\n',
    );
  });

  it('adds a newline before appending when the file has no trailing newline', () => {
    expect(withExcludeEntry('node_modules', WORKTREES_EXCLUDE_ENTRY)).toBe(
      'node_modules\n# Dash task worktrees\n.claude/worktrees/\n',
    );
  });

  it('returns null when the entry is already present in any spelling', () => {
    for (const existing of [
      '.claude/worktrees/',
      '.claude/worktrees',
      '/.claude/worktrees/',
      '  .claude/worktrees  ',
      'foo\r\n.claude/worktrees/\r\n',
    ]) {
      expect(withExcludeEntry(existing, WORKTREES_EXCLUDE_ENTRY)).toBeNull();
      expect(hasExcludeEntry(existing, WORKTREES_EXCLUDE_ENTRY)).toBe(true);
    }
  });

  it('does not treat a broader or narrower pattern as the entry', () => {
    expect(hasExcludeEntry('.claude/', WORKTREES_EXCLUDE_ENTRY)).toBe(false);
    expect(hasExcludeEntry('.claude/worktrees/foo', WORKTREES_EXCLUDE_ENTRY)).toBe(false);
  });
});
