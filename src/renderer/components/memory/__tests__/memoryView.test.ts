import { describe, it, expect } from 'vitest';
import { MEMORY_TYPES } from '../../../../shared/types';
import type { MemoryEntry, ProjectMemory } from '../../../../shared/types';
import {
  listMemories,
  brokenLinks,
  repointLink,
  unlinkLink,
  fixedDraft,
  memoryCounts,
  memorySections,
  memoryDocs,
  memoryNotices,
  pickCurrent,
  rewriteMemoryLinks,
  memoryReferrers,
  newMemoryDraft,
  editMemoryDraft,
  isDraftDirty,
  canSaveDraft,
  draftHook,
  draftTypes,
  redescribeDraft,
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
    ownLine: true,
    pastIndexLimit: false,
    hook: '',
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
      'dead-ref.md': ['unwritten'],
      'dead-link.md': ['dead-link'],
      'all.md': ['unindexed', 'untyped', 'unwritten'],
    });
  });

  it('names each link that opens nothing, once, with the memory it likely meant', () => {
    const entries = [
      entry({ file: 'user_profile.md', name: 'user-profile' }),
      entry({ file: 'prefer-ci.md', name: 'Prefer CI over local tests' }),
      entry({
        file: 'a.md',
        body: '[[User Profile]] [[user_profil]] [[prefer-ci]] [x](prefer_ci.md) [[nope]] [[nope]] `[[code]]` [[a]]',
      }),
    ];
    expect(brokenLinks(entries[2]!.body, entries, 'a.md')).toEqual([
      { kind: 'ref', target: 'User Profile', suggestion: 'user_profile.md' },
      { kind: 'ref', target: 'user_profil', suggestion: 'user_profile.md' },
      { kind: 'ref', target: 'nope', suggestion: undefined },
      { kind: 'file', target: 'prefer_ci.md', suggestion: 'prefer-ci.md' },
    ]);
    // Never guessed to have meant the memory it is written in.
    expect(brokenLinks('[[a.]]', entries, 'a.md')).toEqual([
      { kind: 'ref', target: 'a.', suggestion: undefined },
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

  it('guesses the memory a broken link meant: same but for punctuation, then contained, then one slip', () => {
    const es = [
      entry({ file: 'deploy-notes.md' }),
      entry({ file: 'deploy-notes-old.md' }),
      entry({ file: 'user_profile.md' }),
    ];
    const guess = (body: string, self?: string) => brokenLinks(body, es, self)[0]?.suggestion;
    expect(guess('[[Deploy Notes]]')).toBe('deploy-notes.md');
    expect(guess('[[deploy_note]]', 'deploy-notes.md')).toBe('deploy-notes-old.md');
    expect(guess('[[user_profole]]')).toBe('user_profile.md');
    expect(guess('[[usr_profile]]')).toBe('user_profile.md');
    expect(guess('[[profiles-x]]')).toBeUndefined();
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

  it('leaves a memory whose only issue is an unwritten link where it was, flag and all', () => {
    const later = [entry({ file: 'plan.md', type: 'project', mtimeMs: NOW, body: '[[to-write]]' })];
    const [section] = memorySections(later, 'all', '', NOW);
    expect(section).toMatchObject({ id: 'project', entries: [{ issues: ['unwritten'] }] });
    const dead = [{ ...later[0]!, body: '[x](gone.md)' }];
    expect(memorySections(dead, 'all', '', NOW).map((s) => s.id)).toEqual(['attention']);
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

describe('memoryNotices', () => {
  const memory: ProjectMemory = {
    dir: '/m',
    exists: true,
    index: '',
    entries: [entry({ file: 'a.md' })],
    dangling: [],
    disabledBy: null,
  };

  it('says nothing while Claude sees everything', () => {
    expect(memoryNotices(memory)).toEqual([]);
  });

  it('says what turned auto memory off', () => {
    const [notice] = memoryNotices({ ...memory, disabledBy: 'autoMemoryEnabled in /s.json' });
    expect(notice!.text).toContain('off for this project (autoMemoryEnabled in /s.json)');
  });

  it('counts the memories past the part of the index Claude loads, and flags each', () => {
    const cut = entry({ file: 'b.md', pastIndexLimit: true });
    const [notice] = memoryNotices({ ...memory, entries: [...memory.entries, cut] });
    expect(notice!.text).toContain('200 lines or 25KB');
    expect(notice!.text).toContain("1 memory sits past the cut and isn't seen");
    expect(listMemories([cut])[0]!.issues).toContain('not-loaded');
  });

  it('offers to drop index lines for memories that are gone', () => {
    expect(memoryNotices({ ...memory, dangling: ['old.md'] })).toEqual([
      { text: 'MEMORY.md points at a memory that no longer exists: old.md.', action: 'prune' },
    ]);
    const [two] = memoryNotices({ ...memory, dangling: ['a.md', 'b.md'] });
    expect(two!.text).toContain('2 memories that no longer exist: a.md, b.md');
  });
});

describe('memoryDocs / pickCurrent', () => {
  const memory: ProjectMemory = {
    dir: '/m',
    exists: true,
    dangling: [],
    disabledBy: null,
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

  it('rewrites relative links to known .md files and leaves other sites alone', () => {
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

describe('memory drafts', () => {
  const saved = entry({
    file: 'ci.md',
    name: 'prefer-ci',
    description: 'CI over local',
    type: 'feedback',
    body: '\nUse CI.\n',
    mtimeMs: 7,
    sizeBytes: 42,
    hook: 'when tests are slow',
  });

  it('opens an edit on the memory as shown, guarded by the stat it was read at', () => {
    const draft = editMemoryDraft(saved);
    expect(draft.target).toEqual({ file: 'ci.md', mtimeMs: 7, sizeBytes: 42 });
    expect(draft.fields).toEqual({
      name: 'prefer-ci',
      description: 'CI over local',
      hook: 'when tests are slow',
      type: 'feedback',
      body: 'Use CI.',
    });
    expect(isDraftDirty(draft)).toBe(false);
    expect(canSaveDraft(draft)).toBe(false);
  });

  it('is dirty and saveable once any field differs, and clean again when put back', () => {
    const draft = editMemoryDraft(saved);
    const patches = [
      { name: 'x' },
      { description: 'x' },
      { hook: 'x' },
      { type: 'user' },
      { body: 'x' },
    ];
    for (const patch of patches) {
      const edited = { ...draft, fields: { ...draft.fields, ...patch } as typeof draft.fields };
      expect(isDraftDirty(edited)).toBe(true);
      expect(canSaveDraft(edited)).toBe(true);
    }
    expect(isDraftDirty({ ...draft, fields: { ...draft.fields } })).toBe(false);
  });

  it("sends the hook only when it was edited, so Claude's rewording isn't undone", () => {
    const draft = editMemoryDraft(saved);
    expect(draft.line).toBe('own');
    expect(draftHook(draft)).toBeUndefined();
    const edit = (hook: string) => ({ ...draft, fields: { ...draft.fields, hook } });
    expect(draftHook(edit(' when CI is green '))).toBe('when CI is green');
    // Cleared is a hook too: the line keeps only its title.
    expect(draftHook(edit(''))).toBe('');
  });

  it('sends a hook for a memory with no index line only when one is written', () => {
    // The save defaults the new line to the description; sent from here, that
    // default would pass for a typed hook and reword a line Claude added since.
    const orphan = editMemoryDraft({ ...saved, inIndex: false, ownLine: false, hook: null });
    expect(orphan.line).toBe('missing');
    expect(draftHook(orphan)).toBeUndefined();
    expect(draftHook({ ...orphan, fields: { ...orphan.fields, hook: 'mine' } })).toBe('mine');

    const fresh = newMemoryDraft();
    expect(fresh.line).toBe('missing');
    const described = { ...fresh, fields: redescribeDraft(fresh, 'What it is') };
    expect(described.fields.hook).toBe('');
    expect(draftHook(described)).toBeUndefined();
    expect(isDraftDirty({ ...fresh, fields: { ...fresh.fields, hook: 'x' } })).toBe(true);
  });

  it('never rewords a line shared with another link, or its own in another shape', () => {
    for (const ownLine of [false, true]) {
      const fixed = editMemoryDraft({ ...saved, ownLine, hook: null });
      expect(fixed.line).toBe('fixed');
      expect(draftHook({ ...fixed, fields: { ...fixed.fields, hook: 'x' } })).toBeUndefined();
    }
  });

  it('moves a hook that mirrors the description along with it, and no other', () => {
    const own = editMemoryDraft(saved);
    expect(redescribeDraft(own, 'CI first')).toMatchObject({
      description: 'CI first',
      hook: 'when tests are slow',
    });
    const mirrored = editMemoryDraft({ ...saved, hook: 'CI over local' });
    const moved = { ...mirrored, fields: redescribeDraft(mirrored, 'CI first') };
    expect(moved.fields).toMatchObject({ description: 'CI first', hook: 'CI first' });
    expect(draftHook(moved)).toBe('CI first');
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
    const docs = memoryDocs({
      dir: '/m',
      exists: true,
      index: '',
      entries: [saved],
      dangling: [],
      disabledBy: null,
    });
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

describe('fixing a broken link', () => {
  const entries = [
    entry({ file: 'prefer-ci.md', name: 'prefer-ci' }),
    entry({ file: 'odd name (1).md', name: 'has ] bracket' }),
    entry({ file: 'twin-a.md', name: 'twin' }),
    entry({ file: 'twin-b.md', name: 'twin' }),
  ];
  const ref = { kind: 'ref', target: 'ci' } as const;
  const link = { kind: 'file', target: 'ci.md' } as const;
  const body = 'a [[ci]] b [[ ci ]] c [[other]] d [the CI one](ci.md) e [o](./ci.md) `[[ci]]`';

  it('points every use of it at the chosen memory, and nothing else', () => {
    expect(repointLink(body, ref, entries[0]!, entries)).toBe(
      'a [[prefer-ci]] b [[prefer-ci]] c [[other]] d [the CI one](ci.md) e [o](./ci.md) `[[ci]]`',
    );
    expect(repointLink(body, link, entries[1]!, entries)).toBe(
      'a [[ci]] b [[ ci ]] c [[other]] d [the CI one](<odd name (1).md>) e [o](<odd name (1).md>) `[[ci]]`',
    );
  });

  it('writes a link the preview resolves to that memory, whatever its name', () => {
    const tricky = [
      ...entries,
      // Neither can be carried by a [[name]]: code hides one, the bracket ends the other.
      entry({ file: 'use-pnpm.md', name: 'Use `pnpm` here' }),
      entry({ file: 'a]b.md', name: 'x ] y' }),
    ];
    for (const to of tricky) {
      const fixed = repointLink('[[ci]]', ref, to, tricky);
      expect(rewriteMemoryLinks(fixed, tricky)).toContain(
        `(${MEMORY_LINK_PREFIX}${encodeURIComponent(to.file)})`,
      );
      expect(brokenLinks(fixed, tricky)).toEqual([]);
    }
    expect(repointLink('[[ci]]', ref, tricky[4]!, tricky)).toBe('[[use-pnpm]]');
    expect(repointLink('[[ci]]', ref, tricky[5]!, tricky)).toBe('[ci](a]b.md)');
  });

  it('opens a fix as an unsaved edit of the memory as it is on disk', () => {
    const m = listMemories([entry({ file: 'a.md', type: 'user', body: '[x](gone.md)\n' })])[0]!;
    const draft = fixedDraft(m.entry, (f) => ({ ...f, body: unlinkLink(f.body, m.broken[0]!) }));
    expect(draft.fields.body).toBe('x');
    expect(draft.saved.body).toBe('[x](gone.md)');
    expect(draft.target).toMatchObject({ file: 'a.md' });
    expect(canSaveDraft(draft)).toBe(true);
  });

  it('unlinks it down to the text it showed', () => {
    expect(unlinkLink(body, ref)).toBe(
      'a ci b ci c [[other]] d [the CI one](ci.md) e [o](./ci.md) `[[ci]]`',
    );
    expect(unlinkLink(body, link)).toBe(
      'a [[ci]] b [[ ci ]] c [[other]] d the CI one e o `[[ci]]`',
    );
  });

  it('unlinks every link it calls dead, however its text is written', () => {
    const odd = 'a [`cfg`](gone.md) b [see [1]](gone.md) c [two\nlines](gone.md) d ](gone.md)';
    const [dead] = brokenLinks(odd, entries);
    expect(dead).toMatchObject({ kind: 'file', target: 'gone.md' });
    const fixed = unlinkLink(odd, dead!);
    expect(fixed).toBe('a `cfg` b see [1] c two\nlines d ](gone.md)');
    // What is left was never a link: not flagged, and nothing to follow in the preview.
    expect(brokenLinks(fixed, entries)).toEqual([]);
    expect(rewriteMemoryLinks(odd, entries)).not.toContain('[`cfg`](gone.md)');
  });

  it('leaves nothing broken behind', () => {
    for (const fixed of [repointLink(body, ref, entries[0]!, entries), unlinkLink(body, ref)]) {
      expect(brokenLinks(fixed, entries).map((l) => l.target)).toEqual(['other', 'ci.md']);
    }
  });

  it('starts the memory a [[name]] was waiting for under that name', () => {
    const draft = newMemoryDraft('project', 'ci');
    expect(draft.fields.name).toBe('ci');
    expect(canSaveDraft(draft)).toBe(true);
  });
});
