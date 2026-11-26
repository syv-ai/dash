import { describe, expect, it } from 'vitest';
import type { MemoryEntry } from '../../../../shared/types';
import { instructionFiles, memoryGroups } from '../agentTab';

const entry = (file: string, type: MemoryEntry['type'], name = file): MemoryEntry => ({
  file,
  name,
  description: '',
  type,
  body: '',
  mtimeMs: 0,
  inIndex: true,
  pastIndexLimit: false,
});

describe('memoryGroups', () => {
  it('groups by type in display order, each by name, without empty groups', () => {
    const groups = memoryGroups([
      entry('p.md', 'project'),
      entry('b.md', 'feedback', 'beta'),
      entry('x.md', 'other'),
      entry('a.md', 'feedback', 'Alpha'),
    ]);
    expect(groups.map((g) => [g.type, g.entries.map((e) => e.name)])).toEqual([
      ['feedback', ['Alpha', 'beta']],
      ['project', ['p.md']],
      ['other', ['x.md']],
    ]);
  });
});

describe('instructionFiles', () => {
  it("lists the repo's CLAUDE.md files root first, never a nested worktree's", () => {
    expect(
      instructionFiles([
        'src/main/CLAUDE.md',
        'README.md',
        'CLAUDE.md',
        '.claude/CLAUDE.md',
        'CLAUDE.local.md',
        '.claude/worktrees/t/CLAUDE.md',
        'docs/NOTCLAUDE.md',
      ]),
    ).toEqual(['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md', 'src/main/CLAUDE.md']);
  });
});
