import { describe, expect, it } from 'vitest';
import {
  PREVIEW_CSP,
  previewDocument,
  previewImageSources,
  previewKind,
  withSafeHead,
  type PreviewPalette,
} from '../previewDocument';

const palette: PreviewPalette = {
  dark: true,
  ground: '#101112',
  ink: '#eeeeee',
  muted: '#cccccc',
  line: '#ffffff11',
  codeBg: '#ffffff17',
  link: '#87c0fa',
  codeInk: '#e5a3c0',
};

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;

describe('previewKind', () => {
  it('previews HTML and Markdown only', () => {
    expect(previewKind('docs/index.html')).toBe('html');
    expect(previewKind('page.HTM')).toBe('html');
    expect(previewKind('README.md')).toBe('markdown');
    expect(previewKind('notes.markdown')).toBe('markdown');
    expect(previewKind('src/app.ts')).toBeNull();
  });
});

describe('PREVIEW_CSP', () => {
  it('allows no network, no scripts and no form posts', () => {
    expect(PREVIEW_CSP).toContain("default-src 'none'");
    expect(PREVIEW_CSP).not.toMatch(/script-src|connect-src|https?:/);
    expect(PREVIEW_CSP).toContain("form-action 'none'");
    expect(PREVIEW_CSP).toContain("base-uri 'none'");
  });

  it('still lets images in only as data: URIs (local ones come inlined)', () => {
    expect(PREVIEW_CSP).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'; base-uri 'none'",
    );
  });
});

describe('withSafeHead', () => {
  it('puts the CSP and link target first in a fragment', () => {
    const doc = withSafeHead('<p>hi</p>');
    expect(doc.startsWith(CSP_META)).toBe(true);
    expect(doc).toContain('<base target="_blank">');
  });

  it('keeps a doctype (and comments before it) first, so the page stays in standards mode', () => {
    const doc = withSafeHead('<!-- generated -->\n<!DOCTYPE html><html><head><title>x</title>');
    expect(doc.startsWith('<!-- generated -->\n<!DOCTYPE html>' + CSP_META)).toBe(true);
  });

  it('comes ahead of a policy or base the author wrote', () => {
    const authored = '<!doctype html><head><base href="https://evil.example/" target="_self">';
    const doc = withSafeHead(authored);
    expect(doc.indexOf(CSP_META)).toBeLessThan(doc.indexOf('<base href'));
    expect(doc.indexOf('<base target="_blank">')).toBeLessThan(doc.indexOf('<base href'));
  });
});

describe('previewDocument', () => {
  it('shows HTML as authored, behind the safe head', () => {
    const html = '<!doctype html><body style="background:pink"><script>alert(1)</script>';
    expect(previewDocument('html', html, palette)).toBe(withSafeHead(html));
  });

  it("renders Markdown in Dash's tokens", () => {
    const doc = previewDocument(
      'markdown',
      '# Plan\n\nRun `pnpm test`, see [docs](https://x.dev).',
      palette,
    );
    expect(doc.startsWith('<!doctype html>' + CSP_META)).toBe(true);
    expect(doc).toContain('<h1>Plan</h1>');
    expect(doc).toContain('<code>pnpm test</code>');
    expect(doc).toMatch(/a \{ color: #87c0fa;/);
    expect(doc).toMatch(/code \{[^}]*color: #e5a3c0;/);
    expect(doc).toMatch(/body \{[^}]*background: #101112;/);
    expect(doc).toContain('color-scheme: dark');
  });

  it('inlines images behind the same head, and finds those the text names', () => {
    const md = '![Dash screenshot](docs/screenshot.png)\n\n<img src="logo.svg">';
    expect(previewImageSources('markdown', md)).toEqual(['docs/screenshot.png', 'logo.svg']);
    const uri = 'data:image/png;base64,AA==';
    const doc = previewDocument('markdown', md, palette, () => ({ kind: 'data', uri }));
    expect(doc.startsWith('<!doctype html>' + CSP_META)).toBe(true);
    expect(doc).toContain(`<img src="${uri}" alt="Dash screenshot">`);
    expect(
      previewDocument('html', '<img src="a.png">', palette, () => ({ kind: 'data', uri })),
    ).toBe(withSafeHead(`<img src="${uri}">`));
  });

  it("keeps Markdown's raw HTML inside the same head", () => {
    const doc = previewDocument('markdown', '<img src="https://track.example/p.gif">', palette);
    expect(doc.indexOf(CSP_META)).toBeLessThan(doc.indexOf('<img'));
  });
});
