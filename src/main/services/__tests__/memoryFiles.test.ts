import { describe, it, expect } from 'vitest';
import { parseMemoryFile, toMemoryType } from '../memoryFiles';

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
