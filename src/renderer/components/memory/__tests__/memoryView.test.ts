import { describe, it, expect } from 'vitest';
import { MEMORY_TYPES } from '../../../../shared/types';
import type { MemoryEntry, ProjectMemory } from '../../../../shared/types';
import {
  listMemories,
  memoryCounts,
  memorySections,
  memoryDocs,
  pickCurrent,
  rewriteMemoryLinks,
  memoryReferrers,
  newMemoryDraft,
  editMemoryDraft,
  isDraftDirty,
  canSaveDraft,
  draftTypes,
  memoryScaffold,
  retypeDraft,
  KNOWN_MEMORY_TYPES,
  MEMORY_LINK_PREFIX,
  MEMORY_PREVIEW_SANDBOX,
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
    sizeBytes: 0,
    inIndex: true,
    ...p,
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1000 * DAY;
const files = (sections: MemorySection[]) =>
  sections.map((s) => [s.id, ...s.entries.map((m) => m.entry.file)]);

describe('listMemories', () => {
  it('flags what Claude will not recall, cannot file, or cannot follow', () => {
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
      'dead-ref.md': ['dead-link'],
      'dead-link.md': ['dead-link'],
      'all.md': ['unindexed', 'untyped', 'dead-link'],
    });
  });

  it('calls a link dead exactly when the preview cannot open it', () => {
    const entries = [
      entry({ file: 'a.md', type: 'user', name: 'A name', body: '[[b]] [[A name]] [[nope]]' }),
      entry({ file: 'b.md', type: 'user', body: '[[A name]] [a](./a.md)' }),
    ];
    for (const { entry: e, issues } of listMemories(entries)) {
      const missing = rewriteMemoryLinks(e.body, entries).includes('memory-missing');
      expect(issues.includes('dead-link')).toBe(missing);
    }
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
    expect(files(memorySections(entries, 'feedback', '', NOW))).toEqual([
      ['attention', 'loose.md'],
      ['recent', 'newer.md', 'new.md'],
      ['older', 'old.md'],
    ]);
  });

  it('files "all" by type in display order, under the ones needing attention', () => {
    expect(files(memorySections(entries, 'all', '', NOW))).toEqual([
      ['attention', 'loose.md', 'untyped.md'],
      ['feedback', 'newer.md', 'new.md', 'old.md'],
      ['user', 'me.md'],
      ['project', 'fact.md'],
    ]);
  });

  it('shows every memory exactly once under "all", so none can be hidden', () => {
    const all = MEMORY_TYPES.map((type, i) => entry({ file: `${type}.md`, type, mtimeMs: i }));
    const sections = memorySections(all, 'all', '', NOW);
    expect(sections.map((s) => s.id)).toEqual(['attention', ...KNOWN_MEMORY_TYPES]);
    expect(sections.flatMap((s) => s.entries.map((m) => m.entry.file)).sort()).toEqual(
      all.map((e) => e.file).sort(),
    );
  });

  it('filters case-insensitively on name, description, and body, within the filter', () => {
    expect(files(memorySections(entries, 'all', 'senior', NOW))).toEqual([['user', 'me.md']]);
    expect(files(memorySections(entries, 'all', 'POSTGRES', NOW))).toEqual([
      ['attention', 'untyped.md'],
    ]);
    expect(memorySections(entries, 'feedback', 'senior', NOW)).toEqual([]);
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

describe('memoryDocs / pickCurrent', () => {
  const memory: ProjectMemory = {
    dir: '/m',
    exists: true,
    index: '- [A](a.md)',
    entries: [
      entry({ file: 'a.md', type: 'project', mtimeMs: 1, body: 'A' }),
      entry({ file: 'b.md', type: 'user', mtimeMs: 2 }),
    ],
  };

  it('lists memories in "all" order, then the index as an untyped doc', () => {
    const docs = memoryDocs(memory);
    expect(docs.map((d) => d.key)).toEqual(['b.md', 'a.md', 'MEMORY.md']);
    expect(docs[2]).toEqual({
      key: 'MEMORY.md',
      file: 'MEMORY.md',
      title: 'Index',
      markdown: '- [A](a.md)',
    });
    expect(docs[1]).toMatchObject({ title: 'a', markdown: 'A', type: 'project' });
  });

  it('keeps the selected doc', () => {
    expect(pickCurrent(memoryDocs(memory), 'a.md')?.key).toBe('a.md');
    expect(pickCurrent(memoryDocs(memory), 'MEMORY.md')?.key).toBe('MEMORY.md');
  });

  it('falls back to the first memory in list order when the selected file was deleted', () => {
    expect(pickCurrent(memoryDocs(memory), 'gone.md')?.key).toBe('b.md');
  });

  it('falls back to the index when it is all the folder has', () => {
    expect(pickCurrent(memoryDocs({ ...memory, entries: [] }), null)?.key).toBe('MEMORY.md');
  });

  it('returns null for an empty folder', () => {
    expect(pickCurrent(memoryDocs({ ...memory, index: null, entries: [] }), null)).toBeNull();
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

  it('rewrites relative links to known .md files and leaves others alone', () => {
    const md = '[CI](feedback_ci.md) [web](https://x.dev/a.md) [nope](missing.md)';
    expect(rewriteMemoryLinks(md, entries)).toBe(
      `[CI](${MEMORY_LINK_PREFIX}feedback_ci.md) [web](https://x.dev/a.md) [nope](missing.md)`,
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

describe('memory drafts', () => {
  const saved = entry({
    file: 'ci.md',
    name: 'prefer-ci',
    description: 'CI over local',
    type: 'feedback',
    body: '\nUse CI.\n',
    mtimeMs: 7,
    sizeBytes: 42,
  });

  it('opens an edit on the memory as shown, guarded by the stat it was read at', () => {
    const draft = editMemoryDraft(saved);
    expect(draft.target).toEqual({ file: 'ci.md', mtimeMs: 7, sizeBytes: 42 });
    expect(draft.fields).toEqual({
      name: 'prefer-ci',
      description: 'CI over local',
      type: 'feedback',
      body: 'Use CI.',
    });
    expect(isDraftDirty(draft)).toBe(false);
    expect(canSaveDraft(draft)).toBe(false);
  });

  it('is dirty and saveable once any field differs, and clean again when put back', () => {
    const draft = editMemoryDraft(saved);
    for (const patch of [{ name: 'x' }, { description: 'x' }, { type: 'user' }, { body: 'x' }]) {
      const edited = { ...draft, fields: { ...draft.fields, ...patch } as typeof draft.fields };
      expect(isDraftDirty(edited)).toBe(true);
      expect(canSaveDraft(edited)).toBe(true);
    }
    expect(isDraftDirty({ ...draft, fields: { ...draft.fields } })).toBe(false);
  });

  it('cannot save a memory without a name', () => {
    const draft = newMemoryDraft();
    expect(draft.target).toBeNull();
    expect(canSaveDraft(draft)).toBe(false);
    expect(canSaveDraft({ ...draft, fields: { ...draft.fields, body: 'text' } })).toBe(false);
    expect(canSaveDraft({ ...draft, fields: { ...draft.fields, name: '  ' } })).toBe(false);
    expect(canSaveDraft({ ...draft, fields: { ...draft.fields, name: 'a' } })).toBe(true);
  });

  it('offers `other` only to a memory that already has no known type', () => {
    expect(draftTypes(newMemoryDraft())).toEqual([...KNOWN_MEMORY_TYPES]);
    expect(draftTypes(editMemoryDraft(saved))).not.toContain('other');
    expect(draftTypes(editMemoryDraft(entry({ file: 'o.md', type: 'other' })))).toEqual([
      ...MEMORY_TYPES,
    ]);
  });

  it('keeps a memory as the doc behind its row, and none behind the index', () => {
    const docs = memoryDocs({ dir: '/m', exists: true, index: '', entries: [saved] });
    expect(docs.map((d) => d.entry)).toEqual([saved, undefined]);
  });

  it('starts a new memory as the given type, with the reasoning scaffold where one applies', () => {
    expect(newMemoryDraft().fields.type).toBe('project');
    const draft = newMemoryDraft('feedback');
    expect(draft.fields).toMatchObject({ type: 'feedback', body: memoryScaffold('feedback') });
    expect(draft.fields.body).toContain('**Why:**');
    expect(draft.fields.body).toContain('**How to apply:**');
    expect(newMemoryDraft('reference').fields.body).toBe('');
    // The scaffold alone is nothing to lose.
    expect(isDraftDirty(draft)).toBe(false);
  });

  it('moves an untouched scaffold with the type, and never touches written text', () => {
    const draft = newMemoryDraft('feedback');
    expect(retypeDraft(draft, 'user')).toMatchObject({ type: 'user', body: '' });
    const asUser = { ...draft, fields: retypeDraft(draft, 'user') };
    // Only a type was picked: cancelling loses nothing, so it must not ask.
    expect(isDraftDirty(asUser)).toBe(false);
    expect(retypeDraft(asUser, 'project').body).toBe(memoryScaffold('project'));
    const written = { ...draft, fields: { ...draft.fields, body: 'Use CI.' } };
    expect(retypeDraft(written, 'user')).toMatchObject({ type: 'user', body: 'Use CI.' });
    expect(isDraftDirty(written)).toBe(true);
    // An existing memory's body is its own, even when empty.
    const existing = editMemoryDraft(entry({ file: 'e.md', type: 'user' }));
    expect(retypeDraft(existing, 'feedback')).toMatchObject({ type: 'feedback', body: '' });
  });
});

describe('memoryReferrers', () => {
  const target = entry({ file: 'feedback_ci.md', name: 'prefer-ci' });
  const entries = [
    target,
    entry({ file: 'by-name.md', body: 'see [[prefer-ci]]' }),
    entry({ file: 'by-basename.md', body: 'see [[ feedback_ci ]]' }),
    entry({ file: 'by-link.md', body: 'see [CI](./feedback_ci.md)' }),
    entry({ file: 'unrelated.md', body: 'see [[by-name]] and [x](https://x/feedback_ci.md)' }),
  ];

  it('finds the memories that name or link the target, and not the target itself', () => {
    const self = { ...target, body: 'I am [[prefer-ci]]' };
    expect(memoryReferrers([self, ...entries.slice(1)], self).map((e) => e.file)).toEqual([
      'by-name.md',
      'by-basename.md',
      'by-link.md',
    ]);
  });

  it('agrees with the preview about what a [[ref]] means', () => {
    // `[[feedback_ci]]` names another memory outright, so it is not a link to the target.
    const shadow = entry({ file: 'shadow.md', name: 'feedback_ci' });
    expect(memoryReferrers([...entries, shadow], target).map((e) => e.file)).toEqual([
      'by-name.md',
      'by-link.md',
    ]);
  });
});
