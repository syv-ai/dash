import { describe, it, expect } from 'vitest';
import {
  mapMemoryLinks,
  mapMemoryRefs,
  mapWholeMemoryLinks,
  memoryLinkFiles,
  memoryLinkTarget,
} from '../memoryLinks';

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

  it('reads an angle-bracketed target, which is how a name with spaces is linked', () => {
    expect(memoryLinkFiles('- [A](<my note.md>) [B](<notes (old).md>)')).toEqual(
      new Set(['my note.md', 'notes (old).md']),
    );
  });
});

describe('code', () => {
  it('is not searched for links or refs: `[[` there is shell or TOML, not a memory', () => {
    const md = [
      'See [[one]] and `[[ -f x ]]`.',
      '```toml',
      '[[servers]]',
      '[a](a.md)',
      '```',
      '[b](b.md)',
    ].join('\n');
    const refs: string[] = [];
    expect(mapMemoryRefs(md, (ref, match) => (refs.push(ref), match))).toBe(md);
    expect(refs).toEqual(['one']);
    expect(memoryLinkFiles(md)).toEqual(new Set(['b.md']));
  });
});

describe('mapMemoryLinks', () => {
  it('rewrites only memory links and keeps everything else verbatim', () => {
    const md = 'a [x](x.md) b [y](sub/y.md) c [z](https://z.md)';
    expect(mapMemoryLinks(md, (file) => `](#${file})`)).toBe(
      'a [x](#x.md) b [y](sub/y.md) c [z](https://z.md)',
    );
  });
});

describe('mapWholeMemoryLinks', () => {
  it('hands over each memory link with its text, and keeps everything else verbatim', () => {
    const md = 'a [x y](x.md) b [z](<with space.md>) c [w](https://w.md) `[c](c.md)` [[r]]';
    expect(mapWholeMemoryLinks(md, (file, text) => `{${text}|${file}}`)).toBe(
      'a {x y|x.md} b {z|with space.md} c [w](https://w.md) `[c](c.md)` [[r]]',
    );
  });

  it('finds the text of each link, code and brackets in it or not', () => {
    const md =
      'a [`cfg` file](x.md) b [see [1]](y.md) c [two\nlines](z.md) d ](loose.md)\n\ne](far.md)';
    const seen: string[] = [];
    const out = mapWholeMemoryLinks(md, (file, text) => {
      seen.push(file);
      return text;
    });
    expect(out).toBe('a `cfg` file b see [1] c two\nlines d ](loose.md)\n\ne](far.md)');
    expect(seen).toEqual(['x.md', 'y.md', 'z.md']);
  });

  it('is the one answer to what a memory link is: a target without its text is none', () => {
    for (const [md, files] of [
      ['a [x](x.md) b', ['x.md']],
      ['see ](x.md) here', []],
      ['[a]b](x.md)', []],
      ['[split\n\nby a blank line](x.md)', []],
      // Links don't nest: the inner one is the link.
      ['[outer [in](y.md) more](x.md)', ['y.md']],
      ['- **[T](x.md)** and ![img](<y z.md>)', ['x.md', 'y z.md']],
    ] as const) {
      const whole: string[] = [];
      mapWholeMemoryLinks(md, (file, _text, match) => (whole.push(file), match));
      const targets: string[] = [];
      mapMemoryLinks(md, (file, match) => (targets.push(file), match));
      expect([md, whole, targets]).toEqual([md, files, files]);
    }
    expect(memoryLinkFiles('see ](x.md) and [a]b](y.md)')).toEqual(new Set());
    expect(mapMemoryLinks('[outer [in](y.md) more](x.md)', (file) => `](#${file})`)).toBe(
      '[outer [in](#y.md) more](x.md)',
    );
  });
});

describe('memoryLinkTarget', () => {
  it('writes a target the link pattern reads back', () => {
    for (const file of ['a.md', 'with space.md', 'odd (1).md']) {
      expect([...memoryLinkFiles(`[x](${memoryLinkTarget(file)})`)]).toEqual([file]);
    }
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
