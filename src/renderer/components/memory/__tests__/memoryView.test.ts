import { describe, it, expect } from 'vitest';
import type { MemoryEntry, ProjectMemory, Task } from '../../../../shared/types';
import {
  listMemories,
  memoryIssueTexts,
  memoryMatches,
  memoryMention,
  memoryNotices,
  memoryTaskOf,
  newMemoriesLabel,
} from '../memoryView';

function entry(p: Partial<MemoryEntry> & { file: string }): MemoryEntry {
  return {
    name: p.file.replace(/\.md$/, ''),
    description: '',
    type: 'other',
    body: '',
    mtimeMs: 0,
    inIndex: true,
    pastIndexLimit: false,
    ...p,
  };
}

describe('listMemories', () => {
  it('flags what Claude will not recall and what has no type, and says so in words', () => {
    const listed = listMemories([
      entry({ file: 'fine.md', type: 'user' }),
      entry({ file: 'loose.md', type: 'user', inIndex: false }),
      entry({ file: 'untyped.md' }),
      entry({ file: 'all.md', inIndex: false }),
    ]);
    expect(Object.fromEntries(listed.map((m) => [m.entry.file, m.issues]))).toEqual({
      'fine.md': [],
      'loose.md': ['unindexed'],
      'untyped.md': ['untyped'],
      'all.md': ['unindexed', 'untyped'],
    });
    expect(memoryIssueTexts(listed[3]!)).toEqual([
      'Not in MEMORY.md, so Claude never recalls it.',
      "No known type, so it isn't filed with the rest.",
    ]);
  });
});

describe('memoryMatches', () => {
  const memory = entry({
    file: 'me.md',
    name: 'Role',
    description: 'Senior engineer',
    body: 'mentions Postgres',
  });

  it('matches name, description and text, ignoring case', () => {
    for (const q of ['role', 'SENIOR', 'postgres', '  '])
      expect(memoryMatches(memory, q)).toBe(true);
    expect(memoryMatches(memory, 'mysql')).toBe(false);
  });
});

describe('memoryNotices', () => {
  const memory: ProjectMemory = {
    dir: '/m',
    exists: true,
    hasIndex: true,
    entries: [entry({ file: 'a.md' })],
    dangling: [],
  };

  it('says nothing while Claude sees everything', () => {
    expect(memoryNotices(memory)).toEqual([]);
  });

  it('counts the memories past the part of the index Claude loads, and flags each', () => {
    const cut = entry({ file: 'b.md', pastIndexLimit: true });
    const [notice] = memoryNotices({ ...memory, entries: [...memory.entries, cut] });
    expect(notice!).toContain('200 lines or 25KB');
    expect(notice!).toContain("1 memory sits past the cut and isn't seen");
    expect(listMemories([cut])[0]!.issues).toContain('not-loaded');
  });

  it('names the index lines for memories that are gone', () => {
    expect(memoryNotices({ ...memory, dangling: ['old.md'] })).toEqual([
      'MEMORY.md points at a memory that no longer exists: old.md.',
    ]);
    const [two] = memoryNotices({ ...memory, dangling: ['a.md', 'b.md'] });
    expect(two!).toContain('2 memories that no longer exist: a.md, b.md');
  });
});

describe('newMemoriesLabel', () => {
  it('says how many, in the singular for one', () => {
    expect(newMemoriesLabel(1)).toBe('1 new memory');
    expect(newMemoriesLabel(3)).toBe('3 new memories');
  });
});

describe('memoryTaskOf', () => {
  const task = (id: string, over: Partial<Task> = {}): Task =>
    ({ id, name: `Task ${id}`, projectId: 'p', archivedAt: null, ...over }) as Task;

  it("is the active task when it is one of the project's", () => {
    expect(memoryTaskOf([task('a'), task('b')], 'b')?.id).toBe('b');
  });

  it("is the project's first open task otherwise", () => {
    expect(memoryTaskOf([task('a', { archivedAt: 'x' }), task('b')], 'elsewhere')?.id).toBe('b');
    expect(memoryTaskOf([task('a'), task('b')], null)?.id).toBe('a');
  });

  it('is never an archived task, and none without an open one', () => {
    expect(memoryTaskOf([task('a', { archivedAt: 'x' })], 'a')).toBeNull();
    expect(memoryTaskOf([], null)).toBeNull();
  });
});

describe('memoryMention', () => {
  it('@-mentions the path and leaves a space to keep typing', () => {
    expect(memoryMention('/h/.claude/projects/x/memory/a.md')).toBe(
      '@/h/.claude/projects/x/memory/a.md ',
    );
  });

  it('quotes a path with a space in it', () => {
    expect(memoryMention('/Users/Jo Doe/.claude/projects/x/memory/a b.md')).toBe(
      '@"/Users/Jo Doe/.claude/projects/x/memory/a b.md" ',
    );
  });
});
