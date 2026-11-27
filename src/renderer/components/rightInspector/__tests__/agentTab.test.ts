import { describe, expect, it } from 'vitest';
import type { MemoryEntry } from '../../../../shared/types';
import { instructionFiles, memoryGroups, scratchpadScope } from '../agentTab';

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

describe('scratchpadScope', () => {
  const home = '/Users/a';
  const jobDir = { dir: '/Users/a/.claude/jobs/d8048393/tmp', jobId: 'd8048393' };

  it("names the job, and says a main-checkout task's checkout outlives it", () => {
    const main = scratchpadScope({ name: 'main', useWorktree: false }, jobDir, home);
    expect(main.text).toBe('Goes with the session · job d8048393');
    expect(main.tooltip).toContain('~/.claude/jobs/d8048393/tmp');
    expect(main.tooltip).toContain('(the main checkout stays)');
    const wt = scratchpadScope({ name: 'fix', useWorktree: true }, jobDir, home);
    expect(wt.tooltip).not.toContain('main checkout');
  });

  it("says the session's own scratchpad lives in the system temp folder", () => {
    const scope = scratchpadScope(
      { name: 'main', useWorktree: false },
      { dir: '/private/tmp/claude-501/-r/s/scratchpad', jobId: null },
      home,
    );
    expect(scope.text).toBe("In the system temp folder · main's session");
    expect(scope.tooltip).toContain('/private/tmp/claude-501/-r/s/scratchpad');
    expect(scope.tooltip).not.toMatch(/job [0-9a-f]{8}/);
  });
});
