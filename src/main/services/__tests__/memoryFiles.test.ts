import { describe, it, expect } from 'vitest';
import type { MemoryFields } from '@shared/types';
import {
  memoryFileName,
  parseMemoryFile,
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
    expect(serializeMemoryFile(fields)).toBe(
      [
        '---',
        'name: prefer-ci',
        'description: Run tests in CI, not locally',
        'metadata:',
        '  node_type: memory',
        '  type: feedback',
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
    expect(serializeMemoryFile({ ...fields, description: '', type: 'other' })).toBe(
      '---\nname: prefer-ci\nmetadata:\n  node_type: memory\n---\n\nUse CI.\n',
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
    expect(serializeMemoryFile({ ...fields, type: 'reference' }, legacy)).toBe(
      [
        '---',
        'name: prefer-ci',
        'description: Run tests in CI, not locally',
        'type: reference',
        'originSessionId: 6eabdf28',
        '---',
        '',
        'Use CI.',
        '',
      ].join('\n'),
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
        '',
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
    const once = serializeMemoryFile(fields);
    expect(serializeMemoryFile(readBack(once), once, now)).toBe(
      once.replace('  type: feedback', '  type: feedback\n  modified: 2026-10-01T12:00:00.000Z'),
    );
  });
});

describe('memoryFileName', () => {
  it('slugs the name', () => {
    expect(memoryFileName('Prefer CI over local!')).toBe('prefer-ci-over-local.md');
  });
  it('never yields the index or an empty name', () => {
    expect(memoryFileName('Memory')).toBe('memory-note.md');
    expect(memoryFileName('日本語')).toBe('memory-note.md');
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

  it('rewrites the pointer where it stands instead of adding a second one', () => {
    const index = '# Index\n\n- [Old name](ci.md) — old hook\n- [B](b.md) — two\n';
    expect(setIndexLine(index, 'ci.md', fields)).toBe(
      '# Index\n\n- [CI fast](ci.md) — hook\n- [B](b.md) — two\n',
    );
  });

  it('leaves a line shared with another memory alone', () => {
    const index = '- see [CI](ci.md) and [B](b.md)\n';
    expect(setIndexLine(index, 'ci.md', fields)).toBe(index);
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
