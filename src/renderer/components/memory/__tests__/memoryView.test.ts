import { describe, it, expect } from 'vitest';
import { MEMORY_TYPES } from '../../../../shared/types';
import type { MemoryEntry, ProjectMemory } from '../../../../shared/types';
import {
  groupMemories,
  memoryDocs,
  pickCurrent,
  rewriteMemoryLinks,
  MEMORY_LINK_PREFIX,
  MEMORY_PREVIEW_SANDBOX,
} from '../memoryView';

function entry(p: Partial<MemoryEntry> & { file: string }): MemoryEntry {
  return {
    name: p.file.replace(/\.md$/, ''),
    description: '',
    type: 'other',
    body: '',
    mtimeMs: 0,
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
