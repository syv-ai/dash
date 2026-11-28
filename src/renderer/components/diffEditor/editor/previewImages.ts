/*
 * A preview's `<img>`s (Markdown's images and raw HTML's, an HTML file's):
 * where each `src` points, and the tag the preview shows for it. A relative
 * file is read through main (`editor:readImages`) and inlined as a `data:`
 * URI, since the preview's CSP allows only `img-src data:`; a remote image
 * stays blocked and shows as its alt text, linked; one that can't be shown
 * shows as its alt text. Pure, so it's tested without a DOM.
 *
 * Security doesn't rest on these regexes: a tag they miss keeps its `src`,
 * which the CSP blocks. They only decide what gets inlined.
 */

/** Where an `<img src>` points, from the document's own path. */
export type ImageSrc =
  | { kind: 'data' }
  | { kind: 'remote'; url: string }
  /** A file: repo-relative for a worktree document, absolute (`/`-separated)
   *  for one named absolutely. Main confines it again. */
  | { kind: 'file'; path: string }
  /** Another scheme, a drive letter, a `..` out of the root, a null byte. */
  | { kind: 'refused' };

/** What the preview shows for one `src`. */
export type ImageShown =
  | { kind: 'data'; uri: string }
  | { kind: 'remote'; url: string }
  /** Not read yet: nothing, rather than a flash of alt text. */
  | { kind: 'pending' }
  | { kind: 'missing'; reason: string };

// An absolute path's root: a drive (`C:/`), a UNC share's `//`, or `/`.
const ROOT = /^(?:[A-Za-z]:\/|\/\/|\/)/;

/** `src` resolved against the folder of `docPath` (a worktree file's
 *  repo-relative path, or an outside file's absolute one). */
export function resolveImageSrc(docPath: string, src: string): ImageSrc {
  const raw = src.trim();
  if (/^data:/i.test(raw)) return { kind: 'data' };
  if (/^https?:\/\//i.test(raw)) return { kind: 'remote', url: raw };
  if (raw.startsWith('//')) return { kind: 'remote', url: `https:${raw}` };
  // Any other scheme (`file:`, `javascript:`), a drive letter (`C:\`) among them.
  if (raw === '' || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) return { kind: 'refused' };
  let name: string;
  try {
    name = decodeURIComponent(raw.replace(/[?#].*$/, ''));
  } catch {
    return { kind: 'refused' };
  }
  // Decoded, so `%2e%2e`, `%5c` and `C%3A` are checked as what they name.
  name = name.replace(/\\/g, '/');
  if (name === '' || name.includes('\0') || /^[A-Za-z]:/.test(name)) return { kind: 'refused' };

  const doc = docPath.replace(/\\/g, '/');
  const docRoot = ROOT.exec(doc)?.[0] ?? '';
  // [provisional] A leading `/` is the repo's root, as on GitHub; an outside
  // document (named absolutely) has no repo, so it refuses one.
  if (name.startsWith('/') && docRoot) return { kind: 'refused' };
  const base = name.startsWith('/') ? [] : doc.slice(docRoot.length).split('/').slice(0, -1);
  const parts = base.filter((s) => s !== '' && s !== '.');
  for (const seg of name.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg !== '..') parts.push(seg);
    else if (parts.length > 0) parts.pop();
    else return { kind: 'refused' };
  }
  if (parts.length === 0) return { kind: 'refused' };
  return { kind: 'file', path: docRoot + parts.join('/') };
}

const IMG_TAG = /<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
const attrPattern = (name: string) =>
  new RegExp(`(\\s${name}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s"'>]+)`, 'i');
const SRC = attrPattern('src');
const ALT = attrPattern('alt');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1));
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function attrValue(tag: string, pattern: RegExp): string | null {
  const m = pattern.exec(tag);
  if (!m) return null;
  const v = m[2]!;
  return decodeEntities(/^["']/.test(v) ? v.slice(1, -1) : v);
}

/** Every `<img src>` in `html`, decoded, in order (duplicates kept). */
export function imageSources(html: string): string[] {
  const out: string[] = [];
  for (const [tag] of html.matchAll(IMG_TAG)) {
    const src = attrValue(tag, SRC);
    if (src !== null) out.push(src);
  }
  return out;
}

/** `html` with each `<img src>` as `shown` says: inlined, or as its alt text
 *  (linked for a remote one), or gone while pending. A `data:` src stays. */
export function inlineImages(html: string, shown: (src: string) => ImageShown | null): string {
  return html.replace(IMG_TAG, (tag) => {
    const src = attrValue(tag, SRC);
    if (src === null) return tag;
    const image = shown(src);
    if (!image) return tag;
    const alt = attrValue(tag, ALT)?.trim() || src.split(/[\\/]/).pop() || src;
    switch (image.kind) {
      case 'data':
        return tag.replace(SRC, (_m, lead: string) => `${lead}"${image.uri}"`);
      case 'pending':
        return '';
      case 'remote':
        return `<a class="dash-image-alt" href="${escapeHtml(image.url)}" title="Remote images aren't loaded">${escapeHtml(alt)}</a>`;
      case 'missing':
        return `<span class="dash-image-alt" title="${escapeHtml(image.reason)}">${escapeHtml(alt)}</span>`;
    }
  });
}
