import { describe, it, expect } from 'vitest';
import { MEMORY_TYPES } from '../../../../shared/types';
import type { MemoryEntry, ProjectMemory } from '../../../../shared/types';
import {
  listMemories,
  memoryCounts,
  memoryIssueTexts,
  memorySections,
  memoryNotices,
  pickCurrent,
  KNOWN_MEMORY_TYPES,
  type MemoryFilter,
  type MemorySection,
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

const sectionsOf = (entries: MemoryEntry[], ...rest: [MemoryFilter, string, number]) =>
  memorySections(listMemories(entries), ...rest);

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1000 * DAY;
const files = (sections: MemorySection[]) =>
  sections.map((s) => [s.id, ...s.entries.map((m) => m.entry.file)]);

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

describe('memorySections', () => {
  const entries = [
    entry({ file: 'old.md', type: 'feedback', mtimeMs: NOW - 31 * DAY }),
    entry({ file: 'new.md', type: 'feedback', mtimeMs: NOW - DAY }),
    entry({ file: 'newer.md', type: 'feedback', mtimeMs: NOW }),
    entry({ file: 'loose.md', type: 'feedback', mtimeMs: NOW, inIndex: false }),
    entry({ file: 'me.md', type: 'user', mtimeMs: NOW, description: 'Senior engineer' }),
    entry({ file: 'fact.md', type: 'project', mtimeMs: NOW - 90 * DAY }),
    entry({ file: 'untyped.md', mtimeMs: NOW - 90 * DAY, body: 'mentions Postgres' }),
  ];

  it('files a type by state: needing attention, recent, then older, newest first', () => {
    expect(files(sectionsOf(entries, 'feedback', '', NOW))).toEqual([
      ['attention', 'loose.md'],
      ['recent', 'newer.md', 'new.md'],
      ['older', 'old.md'],
    ]);
  });

  it('files "all" by type in display order, under the ones needing attention', () => {
    expect(files(sectionsOf(entries, 'all', '', NOW))).toEqual([
      ['attention', 'loose.md', 'untyped.md'],
      ['feedback', 'newer.md', 'new.md', 'old.md'],
      ['user', 'me.md'],
      ['project', 'fact.md'],
    ]);
  });

  it('shows every memory exactly once under "all", so none can be hidden', () => {
    const all = MEMORY_TYPES.map((type, i) => entry({ file: `${type}.md`, type, mtimeMs: i }));
    const sections = sectionsOf(all, 'all', '', NOW);
    expect(sections.map((s) => s.id)).toEqual(['attention', ...KNOWN_MEMORY_TYPES]);
    expect(sections.flatMap((s) => s.entries.map((m) => m.entry.file)).sort()).toEqual(
      all.map((e) => e.file).sort(),
    );
  });

  it('filters case-insensitively on name, description, and body, within the filter', () => {
    expect(files(sectionsOf(entries, 'all', 'senior', NOW))).toEqual([['user', 'me.md']]);
    expect(files(sectionsOf(entries, 'all', 'POSTGRES', NOW))).toEqual([
      ['attention', 'untyped.md'],
    ]);
    expect(sectionsOf(entries, 'feedback', 'senior', NOW)).toEqual([]);
  });

  it('counts the matches under each tab; an untyped memory only counts under "all"', () => {
    expect(memoryCounts(entries, '')).toEqual({
      all: 7,
      feedback: 4,
      user: 1,
      reference: 0,
      project: 1,
    });
    expect(memoryCounts(entries, 'senior')).toMatchObject({ all: 1, user: 1, feedback: 0 });
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

describe('pickCurrent', () => {
  const memories = listMemories([
    entry({ file: 'a.md', type: 'project', mtimeMs: 1 }),
    entry({ file: 'b.md', type: 'user', mtimeMs: 2 }),
  ]);

  it('keeps the selected memory', () => {
    expect(pickCurrent(memories, 'a.md')?.entry.file).toBe('a.md');
  });

  it('falls back to the first memory in list order when the selected file was deleted', () => {
    expect(pickCurrent(memories, 'gone.md')?.entry.file).toBe('b.md');
    expect(pickCurrent(memories, null)?.entry.file).toBe('b.md');
  });

  it('returns null without memories', () => {
    expect(pickCurrent([], 'MEMORY.md')).toBeNull();
  });
});
