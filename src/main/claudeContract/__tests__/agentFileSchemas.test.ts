import { describe, expect, it } from 'vitest';
import { checkMemoryFrontmatter, checkScratchpadDir } from '../agentFileSchemas';
import { readFrontmatter } from '../../services/memoryFiles';

const fm = (lines: string[]) =>
  readFrontmatter(['---', ...lines, '---', 'body'].join('\n')).frontmatter;

describe('checkScratchpadDir', () => {
  it('accepts the documented shape, and a payload without one', () => {
    const dir = '/private/tmp/claude-501/-r/abc/scratchpad';
    expect(checkScratchpadDir({ scratchpad_dir: dir, session_id: 'abc' })).toEqual([]);
    expect(checkScratchpadDir({ session_id: 'abc' })).toEqual([]);
  });

  it('reports a dir not under its session, or not a path', () => {
    expect(
      checkScratchpadDir({
        scratchpad_dir: '/tmp/claude-501/-r/other/scratchpad',
        session_id: 'abc',
      }),
    ).toEqual([{ kind: 'unparseable-output', path: 'scratchpad_dir' }]);
    expect(checkScratchpadDir({ scratchpad_dir: '/tmp/x/abc/pad', session_id: 'abc' })).toEqual([
      { kind: 'unparseable-output', path: 'scratchpad_dir' },
    ]);
    expect(checkScratchpadDir({ scratchpad_dir: 'scratchpad' })).toEqual([
      { kind: 'wrong-type', path: 'scratchpad_dir' },
    ]);
  });
});

describe('checkMemoryFrontmatter', () => {
  it('accepts the documented shape, the nested type and extra keys', () => {
    const doc = ['name: a', 'description: b', 'type: feedback', 'modified: 2026-11-26T10:00:00Z'];
    expect(checkMemoryFrontmatter(fm(doc))).toEqual([]);
    expect(
      checkMemoryFrontmatter(fm(['name: a', 'description: b', 'metadata:', '  type: user'])),
    ).toEqual([]);
    expect(
      checkMemoryFrontmatter(
        fm(['name: a', 'description: b', 'type: project', 'originSessionId: x']),
      ),
    ).toEqual([]);
  });

  it('reports no frontmatter, a missing type, an unknown one and a missing name', () => {
    expect(checkMemoryFrontmatter(null)).toEqual([{ kind: 'missing-field', path: 'frontmatter' }]);
    expect(checkMemoryFrontmatter(fm(['name: a', 'description: b']))).toEqual([
      { kind: 'missing-field', path: 'type' },
    ]);
    expect(checkMemoryFrontmatter(fm(['name: a', 'description: b', 'type: lore']))).toEqual([
      { kind: 'unknown-enum-value', path: 'type', value: 'lore' },
    ]);
    expect(checkMemoryFrontmatter(fm(['description: b', 'type: user']))).toEqual([
      { kind: 'missing-field', path: 'name' },
    ]);
  });
});
