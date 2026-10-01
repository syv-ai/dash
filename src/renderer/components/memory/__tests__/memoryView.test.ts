import { describe, it, expect } from 'vitest';
import { MEMORY_TYPES } from '../../../../shared/types';
import type { MemoryEntry, ProjectMemory } from '../../../../shared/types';
import {
  groupMemories,
  memoryDocs,
  pickCurrent,
  rewriteMemoryLinks,
  memoryReferrers,
  newMemoryDraft,
  editMemoryDraft,
  isDraftDirty,
  canSaveDraft,
  draftTypes,
  MEMORY_LINK_PREFIX,
  MEMORY_PREVIEW_SANDBOX,
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

describe('groupMemories', () => {
  const entries = [
    entry({ file: 'a.md', type: 'feedback', mtimeMs: 1 }),
    entry({ file: 'b.md', type: 'feedback', mtimeMs: 5 }),
    entry({ file: 'c.md', type: 'user', mtimeMs: 2, description: 'Senior engineer' }),
    entry({ file: 'd.md', type: 'other', body: 'mentions Postgres' }),
  ];

  it('orders groups user → feedback → project → reference → other, newest first, skipping empty groups', () => {
    const groups = groupMemories(entries, '');
    expect(groups.map((g) => g.type)).toEqual(['user', 'feedback', 'other']);
    expect(groups[1]!.entries.map((e) => e.file)).toEqual(['b.md', 'a.md']);
  });

  it('gives every memory type a group, so none can be hidden', () => {
    const all = MEMORY_TYPES.map((type, i) => entry({ file: `${type}.md`, type, mtimeMs: i }));
    expect(groupMemories(all, '').map((g) => g.type)).toEqual([...MEMORY_TYPES]);
  });

  it('filters case-insensitively on name, description, and body', () => {
    expect(groupMemories(entries, 'senior').flatMap((g) => g.entries.map((e) => e.file))).toEqual([
      'c.md',
    ]);
    expect(groupMemories(entries, 'POSTGRES').flatMap((g) => g.entries.map((e) => e.file))).toEqual(
      ['d.md'],
    );
  });
});

describe('memoryDocs / pickCurrent', () => {
  const memory: ProjectMemory = {
    dir: '/m',
    exists: true,
    index: '- [A](a.md)',
    entries: [
      entry({ file: 'a.md', type: 'feedback', mtimeMs: 1, body: 'A' }),
      entry({ file: 'b.md', type: 'user', mtimeMs: 2 }),
    ],
  };

  it('puts the index first as an untyped doc, then memories in list order', () => {
    const docs = memoryDocs(memory);
    expect(docs.map((d) => d.key)).toEqual(['MEMORY.md', 'b.md', 'a.md']);
    expect(docs[0]).toEqual({
      key: 'MEMORY.md',
      file: 'MEMORY.md',
      title: 'Index',
      markdown: '- [A](a.md)',
    });
    expect(docs[2]).toMatchObject({ title: 'a', markdown: 'A', type: 'feedback' });
  });

  it('keeps the selected doc', () => {
    expect(pickCurrent(memoryDocs(memory), 'a.md')?.key).toBe('a.md');
  });

  it('falls back to the index when the selected file was deleted', () => {
    expect(pickCurrent(memoryDocs(memory), 'gone.md')?.key).toBe('MEMORY.md');
  });

  it('falls back to the first memory in list order when there is no index', () => {
    expect(pickCurrent(memoryDocs({ ...memory, index: null }), null)?.key).toBe('b.md');
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
    expect(draftTypes(newMemoryDraft())).toEqual(['user', 'feedback', 'project', 'reference']);
    expect(draftTypes(editMemoryDraft(saved))).not.toContain('other');
    expect(draftTypes(editMemoryDraft(entry({ file: 'o.md', type: 'other' })))).toEqual([
      ...MEMORY_TYPES,
    ]);
  });

  it('keeps a memory as the doc behind its row, and none behind the index', () => {
    const docs = memoryDocs({ dir: '/m', exists: true, index: '', entries: [saved] });
    expect(docs.map((d) => d.entry)).toEqual([undefined, saved]);
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
