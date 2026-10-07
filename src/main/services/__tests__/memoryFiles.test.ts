import { describe, it, expect } from 'vitest';
import type { MemoryFields } from '@shared/types';
import {
  indexHook,
  loadedIndex,
  memoryFileName,
  parseMemoryFile,
  raiseIndexLine,
  removeIndexLines,
  serializeMemoryFile,
  setIndexLine,
  toMemoryType,
} from '../memoryFiles';

describe('parseMemoryFile', () => {
  it('reads the current shape (type under metadata:)', () => {
    const md = [
      '---',
      'name: prefer-ci',
      'description: Run tests in CI, not locally',
      'metadata:',
      '  type: feedback',
      '---',
      '',
      'Body **here**.',
    ].join('\n');
    expect(parseMemoryFile(md)).toEqual({
      name: 'prefer-ci',
      description: 'Run tests in CI, not locally',
      type: 'feedback',
      body: '\nBody **here**.',
    });
  });

  it('reads the legacy shape (top-level type, quoted values, extra keys)', () => {
    const md = [
      '---',
      'name: "Keep fixes scoped"',
      "description: 'Scope = the active iteration'",
      'type: project',
      'originSessionId: 6eabdf28',
      '---',
      'Body',
    ].join('\n');
    const parsed = parseMemoryFile(md);
    expect(parsed.name).toBe('Keep fixes scoped');
    expect(parsed.description).toBe('Scope = the active iteration');
    expect(parsed.type).toBe('project');
    expect(parsed.body).toBe('Body');
  });

  it('treats a file without frontmatter as an untyped body', () => {
    expect(parseMemoryFile('# Just notes')).toEqual({
      name: '',
      description: '',
      type: 'other',
      body: '# Just notes',
    });
  });

  it('handles CRLF line endings', () => {
    const md = '---\r\nname: a\r\ntype: user\r\n---\r\nbody';
    expect(parseMemoryFile(md)).toMatchObject({ name: 'a', type: 'user', body: 'body' });
  });
});

describe('toMemoryType', () => {
  it('maps unknown or empty values to other', () => {
    expect(toMemoryType('reference')).toBe('reference');
    expect(toMemoryType('Feedback')).toBe('feedback');
    expect(toMemoryType('bogus')).toBe('other');
    expect(toMemoryType('')).toBe('other');
  });
});

describe('serializeMemoryFile', () => {
  const fields: MemoryFields = {
    name: 'prefer-ci',
    description: 'Run tests in CI, not locally',
    type: 'feedback',
    body: 'Use CI.',
  };

  const now = new Date('2026-10-01T12:00:00.000Z');

  // The blank line after the frontmatter and the final newline are the file's, not the body's.
  const readBack = (content: string): MemoryFields => {
    const parsed = parseMemoryFile(content);
    return { ...parsed, body: parsed.body.replace(/^\n|\n$/g, '') };
  };

  it('writes a new memory in the current shape', () => {
    expect(serializeMemoryFile(fields, '', now)).toBe(
      [
        '---',
        'name: prefer-ci',
        'description: Run tests in CI, not locally',
        'metadata:',
        '  node_type: memory',
        '  type: feedback',
        '  modified: 2026-10-01T12:00:00.000Z',
        '---',
        '',
        'Use CI.',
        '',
      ].join('\n'),
    );
  });

  it('round-trips values a bare YAML scalar could not hold', () => {
    const tricky: MemoryFields = {
      name: 'Scope: the "active" iteration',
      description: "true # don't — [really]",
      type: 'project',
      body: 'Line one\n\n    indented code',
    };
    expect(readBack(serializeMemoryFile(tricky))).toEqual(tricky);
    for (const word of ['true', 'null', '42', ' padded']) {
      const quoted = serializeMemoryFile({ ...fields, name: word });
      expect(quoted).toContain(`name: ${JSON.stringify(word)}`);
      expect(parseMemoryFile(quoted).name).toBe(word);
    }
  });

  it('leaves out the description and type it was not given', () => {
    expect(serializeMemoryFile({ ...fields, description: '', type: 'other' }, '', now)).toBe(
      '---\nname: prefer-ci\nmetadata:\n  node_type: memory\n  modified: 2026-10-01T12:00:00.000Z\n---\n\nUse CI.\n',
    );
  });

  it('edits a legacy file in place, keeping unknown keys and the top-level type', () => {
    const legacy = [
      '---',
      'name: "Keep fixes scoped"',
      "description: 'Scope = the active iteration'",
      'type: project',
      'originSessionId: 6eabdf28',
      '---',
      'Old body',
    ].join('\n');
    // The stamp goes where Claude Code 2.1.287 puts it in this shape: last,
    // at the top level. The body stays right under the frontmatter, as it was.
    expect(serializeMemoryFile({ ...fields, type: 'reference' }, legacy, now)).toBe(
      [
        '---',
        'name: prefer-ci',
        'description: Run tests in CI, not locally',
        'type: reference',
        'originSessionId: 6eabdf28',
        'modified: 2026-10-01T12:00:00.000Z',
        '---',
        'Use CI.',
        '',
      ].join('\n'),
    );
    const later = new Date('2026-10-02T08:30:00.000Z');
    const again = serializeMemoryFile({ ...fields, type: 'reference' }, legacy, later);
    expect(serializeMemoryFile({ ...fields, type: 'reference' }, again, now)).toBe(
      again.replace('2026-10-02T08:30:00.000Z', '2026-10-01T12:00:00.000Z'),
    );
  });

  it('keeps an unrecognised type when saved as other', () => {
    const custom = '---\nname: a\nmetadata:\n  type: experiment\n---\nbody';
    expect(serializeMemoryFile({ ...fields, type: 'other' }, custom)).toContain(
      '  type: experiment',
    );
  });

  it('adds missing keys: description after name, type under an existing metadata block', () => {
    const sparse = '---\nmetadata:\n  source: chat\nname: a\n---\nbody';
    expect(serializeMemoryFile(fields, sparse, now)).toBe(
      [
        '---',
        'metadata:',
        '  type: feedback',
        '  source: chat',
        '  modified: 2026-10-01T12:00:00.000Z',
        'name: prefer-ci',
        'description: Run tests in CI, not locally',
        '---',
        'Use CI.',
        '',
      ].join('\n'),
    );
  });

  it('gives a file without frontmatter one', () => {
    expect(readBack(serializeMemoryFile(fields, '# Just notes'))).toEqual(fields);
  });

  it("stamps Claude's modified time on an edit, replacing an earlier stamp", () => {
    const current = [
      '---',
      'name: prefer-ci',
      'description: Run tests in CI, not locally',
      'metadata: ',
      '  node_type: memory',
      '  type: feedback',
      '  originSessionId: 6eabdf28',
      '---',
      '',
      'Use CI.',
      '',
    ].join('\n');
    const edited = serializeMemoryFile({ ...fields, body: 'Always.' }, current, now);
    expect(edited).toBe(
      current
        .replace('Use CI.', 'Always.')
        .replace('6eabdf28', '6eabdf28\n  modified: 2026-10-01T12:00:00.000Z'),
    );
    const later = new Date('2026-10-02T08:30:00.000Z');
    expect(serializeMemoryFile({ ...fields, body: 'Always.' }, edited, later)).toBe(
      edited.replace('2026-10-01T12:00:00.000Z', '2026-10-02T08:30:00.000Z'),
    );
  });

  it('changes nothing but the stamp when saving what was read', () => {
    const once = serializeMemoryFile(fields, '', new Date('2026-09-01T00:00:00.000Z'));
    expect(serializeMemoryFile(readBack(once), once, now)).toBe(
      once.replace('2026-09-01T00:00:00.000Z', '2026-10-01T12:00:00.000Z'),
    );
  });

  it("keeps a value that hasn't changed as Claude wrote it", () => {
    // Bare where Dash would quote, quoted where Dash would not.
    const claudes = [
      '---',
      "name: 'prefer-ci'",
      'description: Pulling+embedding the corpus; how to monitor: it — and recover',
      'metadata:',
      '  type: "feedback"',
      '---',
      '',
      'Use CI.',
      '',
    ].join('\n');
    const read = readBack(claudes);
    expect(read).toMatchObject({ name: 'prefer-ci', type: 'feedback' });
    expect(serializeMemoryFile({ ...read, body: 'Always.' }, claudes, now)).toBe(
      claudes
        .replace('Use CI.', 'Always.')
        .replace('"feedback"', '"feedback"\n  modified: 2026-10-01T12:00:00.000Z'),
    );
  });

  it('reads a block-scalar description as one line and replaces all of it', () => {
    const block = [
      '---',
      'name: a',
      'description: >-',
      '  Folded over',
      '  two lines, type: not a key',
      'metadata:',
      '  type: project',
      '---',
      'body',
    ].join('\n');
    const read = parseMemoryFile(block);
    expect(read).toMatchObject({
      description: 'Folded over two lines, type: not a key',
      type: 'project',
    });
    // Untouched, the block stays a block.
    expect(serializeMemoryFile(read, block, now)).toContain('description: >-\n  Folded over\n');
    const edited = serializeMemoryFile({ ...read, description: 'Short' }, block, now);
    expect(edited).toContain('name: a\ndescription: Short\nmetadata:\n');
    expect(edited).not.toContain('Folded');
  });

  it("reads YAML's doubled single quote", () => {
    expect(parseMemoryFile("---\nname: 'it''s fine'\n---\n").name).toBe("it's fine");
  });
});

describe('memoryFileName', () => {
  it('slugs the name', () => {
    expect(memoryFileName('Prefer CI over local!')).toBe('prefer-ci-over-local.md');
  });
  it('never yields the index or an empty name', () => {
    expect(memoryFileName('Memory')).toBe('memory-note.md');
    expect(memoryFileName('?!')).toBe('memory-note.md');
  });
  it('keeps letters of any script, so such names do not collide', () => {
    expect(memoryFileName('Ærø færge')).toBe('ærø-færge.md');
    expect(memoryFileName('日本語')).toBe('日本語.md');
  });
});

describe('index lines', () => {
  const fields: MemoryFields = { name: 'CI [fast]', description: 'hook', type: 'user', body: '' };

  it('appends a pointer, starting a new line when the index lacks a trailing newline', () => {
    expect(setIndexLine('', 'ci.md', fields)).toBe('- [CI fast](ci.md) — hook\n');
    expect(setIndexLine('- [A](a.md)', 'ci.md', { ...fields, description: '' })).toBe(
      '- [A](a.md)\n- [CI fast](ci.md)\n',
    );
  });

  it('appends with the hook it is given instead of the description', () => {
    expect(setIndexLine('', 'ci.md', fields, { hook: 'when CI is slow' })).toBe(
      '- [CI fast](ci.md) — when CI is slow\n',
    );
    expect(setIndexLine('', 'ci.md', fields, { hook: '' })).toBe('- [CI fast](ci.md)\n');
  });

  it('moves a title that was the old name, and writes a given hook, where the line stands', () => {
    const index = '# Index\n\n- [Old name](ci.md) — old hook\n- [B](b.md) — two\n';
    expect(setIndexLine(index, 'ci.md', fields, { wasName: 'Old [name]', hook: 'new hook' })).toBe(
      '# Index\n\n- [CI fast](ci.md) — new hook\n- [B](b.md) — two\n',
    );
    // A hook appears when first given, and goes when cleared.
    expect(setIndexLine('- [x](ci.md)\n', 'ci.md', fields, { hook: 'now' })).toBe(
      '- [x](ci.md) — now\n',
    );
    expect(setIndexLine('* [CI fast](ci.md) - hook\n', 'ci.md', fields, { hook: '' })).toBe(
      '* [CI fast](ci.md)\n',
    );
    // The line keeps the dash it was written with.
    expect(setIndexLine('* [CI fast](ci.md) - hook\n', 'ci.md', fields, { hook: 'new' })).toBe(
      '* [CI fast](ci.md) - new\n',
    );
  });

  it("keeps Claude's own title and hook when the save gives no hook", () => {
    // How Claude writes it: a title that isn't the name, a hook that isn't the description.
    const index = '- [Keep review fixes small](ci.md) — minimal diffs, one test per fix \n';
    const wasName = 'feedback-small-review-fixes';
    expect(setIndexLine(index, 'ci.md', fields, { wasName })).toBe(index);
    // Given the hook it already has, the line keeps its bytes too.
    expect(
      setIndexLine(index, 'ci.md', fields, { wasName, hook: 'minimal diffs, one test per fix' }),
    ).toBe(index);
    // A line in some other shape isn't reworded at all.
    const prose = 'See [feedback-small-review-fixes](ci.md), which matters.\n';
    expect(setIndexLine(prose, 'ci.md', fields, { wasName, hook: 'x' })).toBe(prose);
  });

  it('puts a new pointer where Claude loads it: on top once the end is past the cut', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `- [m${i}](m${i}.md)`);
    const full = ['# Index', ...lines, ''].join('\n');
    expect(setIndexLine(full, 'ci.md', fields).split('\n').slice(0, 3)).toEqual([
      '# Index',
      '- [CI fast](ci.md) — hook',
      '- [m0](m0.md)',
    ]);
    // With room left, at the end.
    const roomy = ['# Index', ...lines.slice(0, 5), ''].join('\n');
    expect(setIndexLine(roomy, 'ci.md', fields)).toBe(`${roomy}- [CI fast](ci.md) — hook\n`);
  });

  it('puts a new pointer on top when the 25KB limit, not the line limit, is what cuts', () => {
    const wide = Array.from({ length: 30 }, (_, i) => `- [w${i}](w${i}.md) — ${'x'.repeat(980)}`);
    const out = setIndexLine(['# Index', ...wide, ''].join('\n'), 'ci.md', fields);
    expect(out.split('\n')[1]).toBe('- [CI fast](ci.md) — hook');
  });

  it('cuts the index where Claude stops loading it: 200 lines or 25KB of whole lines', () => {
    const short = '# Index\n\n- [A](a.md) — one\n';
    expect(loadedIndex(short)).toBe(short);

    const lines = Array.from({ length: 250 }, (_, i) => `- [m${i}](m${i}.md)`);
    expect(loadedIndex(lines.join('\n')).split('\n')).toEqual(lines.slice(0, 200));

    // Twenty-six 1000-byte lines, 'é' being two bytes: the 25th is the last whole one in.
    const wide = Array.from({ length: 26 }, (_, i) => `- [w${i}](w${i}.md) ${'é'.repeat(490)}`);
    const fat = wide.map((l) => l.padEnd(999 - 490, ' '));
    expect(Buffer.byteLength(fat[0]!)).toBe(999);
    expect(loadedIndex(fat.join('\n')).split('\n')).toHaveLength(25);
  });

  it("reads a memory's hook from its own line only", () => {
    const index = [
      '- [A](a.md) — one ',
      '- [B](b.md)',
      '- see [C](c.md) and [A](a.md)',
      'Prose about [D](d.md).',
      '',
    ].join('\n');
    expect(indexHook(index, 'a.md')).toBe('one');
    expect(indexHook(index, 'b.md')).toBe('');
    expect(indexHook(index, 'c.md')).toBeNull();
    expect(indexHook(index, 'd.md')).toBeNull();
    expect(indexHook(index, 'missing.md')).toBeNull();
  });

  it('links a file name a bare target cannot hold, and finds that line again', () => {
    const once = setIndexLine('', 'my note (old).md', fields);
    expect(once).toBe('- [CI fast](<my note (old).md>) — hook\n');
    expect(setIndexLine(once, 'my note (old).md', fields)).toBe(once);
    expect(removeIndexLines(once, 'my note (old).md')).toBe('');
  });

  it('leaves a line shared with another memory alone', () => {
    const index = '- see [CI](ci.md) and [B](b.md)\n';
    expect(setIndexLine(index, 'ci.md', fields)).toBe(index);
  });

  it("moves a memory's own line above the other memories', under what heads the index", () => {
    const index = ['# Memory Index', '', '- [A](a.md) — one', '- [B](b.md)', '- [C](c.md)', ''];
    expect(raiseIndexLine(index.join('\n'), 'c.md').split('\n')).toEqual([
      '# Memory Index',
      '',
      '- [C](c.md)',
      '- [A](a.md) — one',
      '- [B](b.md)',
      '',
    ]);
    // Already on top, not indexed, or sharing its line: nothing to move.
    expect(raiseIndexLine(index.join('\n'), 'a.md')).toBe(index.join('\n'));
    expect(() => raiseIndexLine(index.join('\n'), 'missing.md')).toThrow(/no line of its own/);
    const shared = '- [A](a.md)\n- see [C](c.md) and [B](b.md)\n';
    expect(() => raiseIndexLine(shared, 'c.md')).toThrow(/no line of its own/);
  });

  describe('code in the index', () => {
    const fence = '```';
    const sample = ['# Memory', fence, '- [X](x.md) — sample', fence, '- [A](a.md) — a', ''];
    const x: MemoryFields = { name: 'X', description: 'real', type: 'user', body: '' };

    it('is no line of any memory: a fenced sample is not reworded, dropped or counted', () => {
      const index = sample.join('\n');
      expect(indexHook(index, 'x.md')).toBeNull();
      expect(removeIndexLines(index, 'x.md')).toBe(index);
      expect(setIndexLine(index, 'x.md', x)).toBe(`${index}- [X](x.md) — real\n`);
    });

    it('is never where a line is raised to', () => {
      const filler = Array.from({ length: 200 }, (_, i) => `- [m${i}](m${i}.md)`);
      const index = [...sample.slice(0, 4), ...filler, ''].join('\n');
      const out = setIndexLine(index, 'ci.md', { ...x, name: 'CI' });
      expect(out.split('\n').slice(0, 6)).toEqual([
        ...sample.slice(0, 4),
        '- [CI](ci.md) — real',
        '- [m0](m0.md)',
      ]);
    });
  });

  it('refuses to write a line that would not read as the link it is', () => {
    const tick = { ...fields, name: 'use ` char', description: 'the ` thing' };
    expect(() => setIndexLine('', 'x.md', tick)).toThrow(/would not read as a link/);
  });

  it('puts a new line on top even when its hook links another memory', () => {
    const lines = Array.from({ length: 201 }, (_, i) => `- [m${i}](m${i}.md)`);
    const out = setIndexLine([...lines, ''].join('\n'), 'x.md', {
      ...fields,
      description: 'see [M1](m1.md)',
    });
    expect(out.split('\n')[0]).toBe('- [CI fast](x.md) — see [M1](m1.md)');
  });

  it('refuses a line it cannot put where Claude loads it', () => {
    const prose = Array.from({ length: 205 }, (_, i) => `prose ${i}`);
    const index = [...prose, '- [A](a.md) — a', ''].join('\n');
    expect(() => setIndexLine(index, 'x.md', fields)).toThrow(/before its first memory line/);
  });

  it('raises below a heading, even one that links a file', () => {
    const index = '# Memory ([how](README.md))\n\n- [A](a.md)\n- [B](b.md)\n';
    expect(raiseIndexLine(index, 'b.md')).toBe(
      '# Memory ([how](README.md))\n\n- [B](b.md)\n- [A](a.md)\n',
    );
  });

  it('removes only the lines that point at just that file', () => {
    const index = [
      '# Memory Index',
      '',
      '- [A](a.md) — one',
      '- [B](b.md) — two',
      '- see [A](./a.md) and [B](b.md)',
      '',
    ].join('\n');
    expect(removeIndexLines(index, 'a.md')).toBe(
      ['# Memory Index', '', '- [B](b.md) — two', '- see [A](./a.md) and [B](b.md)', ''].join('\n'),
    );
    expect(removeIndexLines(index, 'missing.md')).toBe(index);
  });
});
