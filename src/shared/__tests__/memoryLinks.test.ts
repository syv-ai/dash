import { describe, it, expect } from 'vitest';
import { mapMemoryLinks, mapMemoryRefs, memoryLinkFiles } from '../memoryLinks';

describe('memoryLinkFiles', () => {
  it('collects same-folder .md links, with or without ./', () => {
    const index = [
      '- [Profile](user_profile.md) — who the user is',
      '- [CI](./feedback_ci.md) — see also [x](https://example.com/a.md)',
    ].join('\n');
    expect(memoryLinkFiles(index)).toEqual(new Set(['user_profile.md', 'feedback_ci.md']));
  });

  it.each(['sub/x.md', '../other/x.md', '/abs/x.md', 'C:\\x.md', 'x.txt', '#memory:x.md'])(
    'ignores %s: not a file in the memory folder',
    (target) => {
      expect(memoryLinkFiles(`[X](${target})`)).toEqual(new Set());
    },
  );
});

describe('mapMemoryLinks', () => {
  it('rewrites only memory links and keeps everything else verbatim', () => {
    const md = 'a [x](x.md) b [y](sub/y.md) c [z](https://z.md)';
    expect(mapMemoryLinks(md, (file) => `](#${file})`)).toBe(
      'a [x](#x.md) b [y](sub/y.md) c [z](https://z.md)',
    );
  });
});

describe('mapMemoryRefs', () => {
  it('hands over each [[name]] as written and keeps everything else verbatim', () => {
    const seen: string[] = [];
    const out = mapMemoryRefs('a [[one]] b [[ two ]] c [x](y.md) [[\nnot a ref]]', (ref) => {
      seen.push(ref);
      return `<${ref.trim()}>`;
    });
    expect(seen).toEqual(['one', ' two ']);
    expect(out).toBe('a <one> b <two> c [x](y.md) [[\nnot a ref]]');
  });
});
