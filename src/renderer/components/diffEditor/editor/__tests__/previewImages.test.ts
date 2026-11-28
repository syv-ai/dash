import { describe, expect, it } from 'vitest';
import { imageSources, inlineImages, resolveImageSrc } from '../previewImages';

const file = (path: string) => ({ kind: 'file', path });
const refused = { kind: 'refused' };

describe('resolveImageSrc', () => {
  it("resolves from the document's folder", () => {
    expect(resolveImageSrc('README.md', 'docs/screenshot.png')).toEqual(
      file('docs/screenshot.png'),
    );
    expect(resolveImageSrc('docs/guide/a.md', './img/x.png')).toEqual(file('docs/guide/img/x.png'));
    expect(resolveImageSrc('docs/guide/a.md', '../shot.png')).toEqual(file('docs/shot.png'));
    expect(resolveImageSrc('docs/a.md', '/assets/logo.svg')).toEqual(file('assets/logo.svg'));
  });

  it('decodes URL-encoded names and drops a query or fragment', () => {
    expect(resolveImageSrc('a.md', 'my%20pic.png')).toEqual(file('my pic.png'));
    expect(resolveImageSrc('a.md', 'x.png?raw=1#top')).toEqual(file('x.png'));
    expect(resolveImageSrc('a.md', '%E2%9C%93.png')).toEqual(file('✓.png'));
  });

  it('refuses a .. out of the root, however spelled', () => {
    expect(resolveImageSrc('README.md', '../secret.png')).toEqual(refused);
    expect(resolveImageSrc('docs/a.md', '../../x.png')).toEqual(refused);
    expect(resolveImageSrc('docs/a.md', '%2e%2e/%2e%2e/x.png')).toEqual(refused);
    expect(resolveImageSrc('docs/a.md', '..%5c..%5cx.png')).toEqual(refused);
    expect(resolveImageSrc('docs/a.md', 'img/../../../x.png')).toEqual(refused);
  });

  it('takes Windows separators and refuses drive letters', () => {
    expect(resolveImageSrc('docs\\a.md', 'img\\x.png')).toEqual(file('docs/img/x.png'));
    expect(resolveImageSrc('a.md', 'C:\\Users\\me\\x.png')).toEqual(refused);
    expect(resolveImageSrc('a.md', 'C%3A/x.png')).toEqual(refused);
    expect(resolveImageSrc('C:\\Users\\me\\scratch\\notes.md', 'img\\x.png')).toEqual(
      file('C:/Users/me/scratch/img/x.png'),
    );
  });

  it('keeps an outside document absolute, and refuses a root-relative src there', () => {
    expect(resolveImageSrc('/Users/me/.claude/memory/a.md', '../x.png')).toEqual(
      file('/Users/me/.claude/x.png'),
    );
    expect(resolveImageSrc('/Users/me/memory/a.md', '/etc/x.png')).toEqual(refused);
  });

  it('sorts out data, remote and other schemes', () => {
    expect(resolveImageSrc('a.md', 'data:image/png;base64,AA==')).toEqual({ kind: 'data' });
    expect(resolveImageSrc('a.md', 'https://x.dev/p.gif')).toEqual({
      kind: 'remote',
      url: 'https://x.dev/p.gif',
    });
    expect(resolveImageSrc('a.md', '//x.dev/p.gif')).toEqual({
      kind: 'remote',
      url: 'https://x.dev/p.gif',
    });
    for (const src of ['file:///etc/x.png', 'javascript:alert(1)', '', 'x%00.png', '%zz.png', '.'])
      expect(resolveImageSrc('a.md', src)).toEqual(refused);
  });
});

describe('imageSources', () => {
  it('reads each src, quoted or not, entities decoded', () => {
    const html = `<p><img alt="a" src="a.png"><IMG src='b&amp;c.png'/><img src=d.png alt=x><img alt="no src"></p>`;
    expect(imageSources(html)).toEqual(['a.png', 'b&c.png', 'd.png']);
  });

  it('is not fooled by a > inside an attribute', () => {
    expect(imageSources('<img title="a > b" src="x.png">')).toEqual(['x.png']);
  });
});

describe('inlineImages', () => {
  const html = '<p><img src="x.png" alt="Shot &amp; more"></p>';

  it('inlines a read image in place of its src', () => {
    const out = inlineImages(html, () => ({ kind: 'data', uri: 'data:image/png;base64,AA==' }));
    expect(out).toBe('<p><img src="data:image/png;base64,AA==" alt="Shot &amp; more"></p>');
  });

  it('shows a missing one as its alt text, escaped, with why', () => {
    const out = inlineImages(html, () => ({ kind: 'missing', reason: 'Not found' }));
    expect(out).toBe(
      '<p><span class="dash-image-alt" title="Not found">Shot &amp; more</span></p>',
    );
  });

  it('links a remote one by its alt text, and falls back to the file name', () => {
    const out = inlineImages('<img src="https://t.example/p.gif">', (src) => ({
      kind: 'remote',
      url: src,
    }));
    expect(out).toMatch(
      /^<a class="dash-image-alt" href="https:\/\/t.example\/p.gif"[^>]*>p.gif<\/a>$/,
    );
  });

  it('shows nothing while pending, and leaves what it is told nothing about', () => {
    expect(inlineImages(html, () => ({ kind: 'pending' }))).toBe('<p></p>');
    expect(inlineImages(html, () => null)).toBe(html);
  });

  it('escapes an alt text that would break out', () => {
    const out = inlineImages('<img src="x.png" alt="&lt;script&gt;">', () => ({
      kind: 'missing',
      reason: '"><b>',
    }));
    expect(out).not.toMatch(/<script|<b>/);
  });
});
