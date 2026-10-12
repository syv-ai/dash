import { describe, it, expect } from 'vitest';
import { MEMORY_TYPES } from '../../../../shared/types';
import type { MemoryEntry, ProjectMemory } from '../../../../shared/types';
import {
  listMemories,
  brokenLinks,
  memoryCounts,
  memoryIssueTexts,
  memorySections,
  memoryNotices,
  pickCurrent,
  rewriteMemoryLinks,
  KNOWN_MEMORY_TYPES,
  MEMORY_LINK_PREFIX,
  MEMORY_PREVIEW_SANDBOX,
  type MemoryFilter,
  type MemorySection,
} from '../memoryView';
import { memoryLinkFiles } from '../../../../shared/memoryLinks';

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
  it('flags what Claude will not recall, what has no type, and what cannot be followed', () => {
    const listed = listMemories([
      entry({ file: 'fine.md', type: 'user', name: 'fine', body: '[[linked]] [x](linked.md)' }),
      entry({
        file: 'linked.md',
        type: 'user',
        body: 'see [index](MEMORY.md), [web](https://x/y.md)',
      }),
      entry({ file: 'loose.md', type: 'user', inIndex: false }),
      entry({ file: 'untyped.md' }),
      entry({ file: 'dead-ref.md', type: 'user', body: '[[gone]]' }),
      entry({ file: 'dead-link.md', type: 'user', body: '[x](gone.md)' }),
      entry({ file: 'all.md', inIndex: false, body: '[[gone]]' }),
    ]);
    expect(Object.fromEntries(listed.map((m) => [m.entry.file, m.issues]))).toEqual({
      'fine.md': [],
      'linked.md': [],
      'loose.md': ['unindexed'],
      'untyped.md': ['untyped'],
      'dead-ref.md': ['unwritten'],
      'dead-link.md': ['dead-link'],
      'all.md': ['unindexed', 'untyped', 'unwritten'],
    });
  });

  it('names each link that opens nothing, once, and says so in words', () => {
    const entries = [
      entry({ file: 'user_profile.md', name: 'user-profile' }),
      entry({ file: 'prefer-ci.md', name: 'Prefer CI over local tests' }),
      entry({
        file: 'a.md',
        body: '[[User Profile]] [[user_profil]] [[prefer-ci]] [x](prefer_ci.md) [[nope]] [[nope]] `[[code]]` [[a]]',
      }),
    ];
    expect(brokenLinks(entries[2]!.body, entries)).toEqual([
      { kind: 'ref', target: 'User Profile' },
      { kind: 'ref', target: 'user_profil' },
      { kind: 'ref', target: 'nope' },
      { kind: 'file', target: 'prefer_ci.md' },
    ]);
    const loose = listMemories([entry({ file: 'a.md', inIndex: false, body: '[x](gone.md)' })]);
    expect(memoryIssueTexts(loose[0]!)).toEqual([
      'Not in MEMORY.md, so Claude never recalls it.',
      "No known type, so it isn't filed with the rest.",
      "Links to gone.md, which doesn't exist.",
    ]);
  });

  it('calls a link broken exactly when the preview cannot open it', () => {
    const entries = [
      entry({ file: 'a.md', type: 'user', name: 'A name', body: '[[b]] [[A name]] [[nope]]' }),
      entry({ file: 'b.md', type: 'user', body: '[[A name]] [a](./a.md)' }),
      entry({ file: 'c.md', type: 'user', body: '[x](gone.md) [i](MEMORY.md) `[y](gone2.md)`' }),
      entry({
        file: 'd.md',
        type: 'user',
        body: '[i](MEMORY.md) `[y](gone2.md)` [w](https://x/y.md)',
      }),
    ];
    const muted = (e: MemoryEntry) =>
      rewriteMemoryLinks(e.body, entries).split('memory-missing').length - 1;
    const listed = listMemories(entries);
    expect(listed.map((m) => [m.entry.file, m.broken.length, m.issues])).toEqual([
      ['a.md', 1, ['unwritten']],
      ['b.md', 0, []],
      ['c.md', 1, ['dead-link']],
      ['d.md', 0, []],
    ]);
    for (const m of listed)
      expect([m.entry.file, muted(m.entry)]).toEqual([m.entry.file, m.broken.length]);
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

  it('files a memory whose only issue is an unwritten link under its type, flag and all', () => {
    const later = [entry({ file: 'plan.md', type: 'project', mtimeMs: NOW, body: '[[to-write]]' })];
    const [section] = sectionsOf(later, 'all', '', NOW);
    expect(section).toMatchObject({ id: 'project', entries: [{ issues: ['unwritten'] }] });
    const dead = [{ ...later[0]!, body: '[x](gone.md)' }];
    expect(sectionsOf(dead, 'all', '', NOW).map((s) => s.id)).toEqual(['attention']);
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
    disabledBy: null,
  };

  it('says nothing while Claude sees everything', () => {
    expect(memoryNotices(memory)).toEqual([]);
  });

  it('says what turned auto memory off', () => {
    const [notice] = memoryNotices({ ...memory, disabledBy: 'autoMemoryEnabled in /s.json' });
    expect(notice!).toContain('off for this project (autoMemoryEnabled in /s.json)');
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

describe('rewriteMemoryLinks', () => {
  const entries = [
    entry({ file: 'feedback_ci.md', name: 'prefer-ci' }),
    entry({ file: 'user_profile.md', name: 'User profile, long title' }),
  ];

  it('resolves [[name]] by frontmatter name, then by basename', () => {
    const out = rewriteMemoryLinks('see [[prefer-ci]] and [[user_profile]]', entries);
    expect(out).toBe(
      `see [prefer-ci](${MEMORY_LINK_PREFIX}feedback_ci.md) and [user_profile](${MEMORY_LINK_PREFIX}user_profile.md)`,
    );
  });

  it('renders an unresolved [[name]] as escaped, muted text', () => {
    expect(rewriteMemoryLinks('[[<gone>]]', entries)).toBe(
      '<span class="memory-missing">&lt;gone&gt;</span>',
    );
  });

  it('rewrites relative links to known .md files and leaves other sites and the index link alone', () => {
    const md = '[CI](feedback_ci.md) [web](https://x.dev/a.md) [index](MEMORY.md)';
    expect(rewriteMemoryLinks(md, entries)).toBe(
      `[CI](${MEMORY_LINK_PREFIX}feedback_ci.md) [web](https://x.dev/a.md) [index](MEMORY.md)`,
    );
  });

  it('renders a link to a memory file that is gone as muted text, not a link to follow', () => {
    expect(rewriteMemoryLinks('see [the <old> one](missing.md).', entries)).toBe(
      'see <span class="memory-missing">the &lt;old&gt; one</span>.',
    );
  });

  it('rewrites ./x.md links, which the index also counts as indexed', () => {
    expect(rewriteMemoryLinks('[CI](./feedback_ci.md)', entries)).toBe(
      `[CI](${MEMORY_LINK_PREFIX}feedback_ci.md)`,
    );
  });
});

describe('MEMORY_PREVIEW_SANDBOX', () => {
  it('never lets untrusted memory HTML run scripts', () => {
    // With allow-same-origin present, allow-scripts would escape the sandbox.
    expect(MEMORY_PREVIEW_SANDBOX.split(/\s+/)).not.toContain('allow-scripts');
  });
});

describe('indexed ⇔ linked', () => {
  // MemoryService flags `inIndex` with memoryLinkFiles; the preview must make
  // exactly those links clickable, or the list and the index disagree.
  it.each(['x.md', './x.md', 'sub/x.md', '../other/x.md', '/abs/x.md'])('%s', (target) => {
    const md = `- [X](${target})`;
    const indexed = memoryLinkFiles(md).has('x.md');
    const linked = rewriteMemoryLinks(md, [entry({ file: 'x.md' })]).includes(MEMORY_LINK_PREFIX);
    expect(linked).toBe(indexed);
  });
});
