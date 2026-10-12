import { describe, it, expect } from 'vitest';
import { parseMemoryFile, readIndex, toMemoryType } from '../memoryFiles';

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

  it("reads YAML's doubled single quote", () => {
    expect(parseMemoryFile("---\nname: 'it''s fine'\n---\n").name).toBe("it's fine");
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

describe('readIndex', () => {
  it('says which memories the index links, on a line of their own or a shared one', () => {
    const of = readIndex(
      ['- [A](a.md) — one', '- see [C](c.md) and [A](./a.md)', 'Prose about [D](d.md).', ''].join(
        '\n',
      ),
    );
    for (const file of ['a.md', 'c.md', 'd.md']) {
      expect(of(file)).toEqual({ inIndex: true, pastIndexLimit: false });
    }
    expect(of('missing.md')).toEqual({ inIndex: false, pastIndexLimit: false });
    expect(readIndex('')('a.md')).toEqual({ inIndex: false, pastIndexLimit: false });
  });

  it('cuts the index where Claude stops loading it: 200 lines or 25KB of whole lines', () => {
    const lines = Array.from({ length: 250 }, (_, i) => `- [m${i}](m${i}.md)`);
    const long = readIndex(lines.join('\n'));
    expect(long('m199.md')).toEqual({ inIndex: true, pastIndexLimit: false });
    expect(long('m200.md')).toEqual({ inIndex: true, pastIndexLimit: true });

    // Twenty-six 1000-byte lines, 'é' being two bytes: the 25th is the last whole one in.
    const wide = Array.from({ length: 26 }, (_, i) => `- [w${i}](w${i}.md) ${'é'.repeat(490)}`);
    const fat = wide.map((l) => l.padEnd(999 - 490, ' '));
    expect(Buffer.byteLength(fat[0]!)).toBe(999);
    const heavy = readIndex(fat.join('\n'));
    expect(heavy('w24.md').pastIndexLimit).toBe(false);
    expect(heavy('w25.md').pastIndexLimit).toBe(true);
  });

  it('goes by the first line that links a memory: one in the loaded part is enough', () => {
    const filler = Array.from({ length: 200 }, (_, i) => `- note ${i}`);
    const of = readIndex(['- [A](a.md)', ...filler, '- [A](a.md) again', '- [B](b.md)'].join('\n'));
    expect(of('a.md').pastIndexLimit).toBe(false);
    expect(of('b.md').pastIndexLimit).toBe(true);
  });

  it('counts no link written in code: a fenced sample indexes nothing', () => {
    const fence = '```';
    const of = readIndex(
      ['# Memory', fence, '- [X](x.md) — sample', fence, '- [A](a.md)'].join('\n'),
    );
    expect(of('x.md').inIndex).toBe(false);
    expect(of('a.md').inIndex).toBe(true);
  });
});
