import { marked } from 'marked';
import { imageSources, inlineImages, type ImageShown } from './previewImages';

/*
 * The documents the editor's rendered preview shows (`PreviewFrame`): a
 * Markdown file converted and themed with Dash's tokens, an HTML file as
 * authored. Both are untrusted file content, so every document carries the
 * same head: a CSP that allows no network, no scripts and no form posts, and
 * a default link target that turns a link's click into a window-open request,
 * which main hands to the browser (http(s) only, `window.ts`). The iframe's
 * sandbox and main's navigation guard are the other two layers.
 *
 * Pure, so the documents are tested without a DOM.
 */

// GitHub-flavored markdown, rendered to a string synchronously (no async
// extensions registered): tables, fenced code and task lists.
marked.setOptions({ gfm: true });

/** How a file previews: HTML as authored, Markdown converted; others don't. */
export type PreviewKind = 'html' | 'markdown';

export function previewKind(filePath: string): PreviewKind | null {
  if (/\.html?$/i.test(filePath)) return 'html';
  if (/\.(md|markdown)$/i.test(filePath)) return 'markdown';
  return null;
}

/**
 * No network at all (remote images would be tracking pixels; relative assets
 * have no origin to resolve against in a sandboxed srcdoc, so main reads
 * them and they come inlined, `previewImages`), no scripts (the
 * sandbox drops them too), inline styles only, and no `<base href>` or form
 * target to redirect what the head sets.
 */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  'media-src data:',
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** The head every preview document starts with. A `<base>` with only a
 *  target passes `base-uri 'none'`, which checks an href. */
const SAFE_HEAD = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><base target="_blank">`;

/** Put the safe head first in `html`, after its doctype and any comments ahead of
 *  that (an element before the doctype puts the page in quirks mode). The
 *  parser lifts it into the document's head, ahead of what the author wrote. */
export function withSafeHead(html: string): string {
  const doctype = /^\uFEFF?(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i.exec(html);
  if (!doctype) return SAFE_HEAD + html;
  return doctype[0] + SAFE_HEAD + html.slice(doctype[0].length);
}

/** The Markdown preview's colours: Dash's role tokens, resolved (`PreviewFrame`). */
export interface PreviewPalette {
  dark: boolean;
  /** The editor's background, so toggling to the preview doesn't flash. */
  ground: string;
  ink: string;
  /** Quoted text (`ink-2`). */
  muted: string;
  /** Hairlines: heading rules, table cells, quotes (`line`). */
  line: string;
  /** Inline code's tint and code blocks' sheet (`select`, as `ui/Code`). */
  codeBg: string;
  link: string;
  codeInk: string;
}

/** A GitHub-ish stylesheet in Dash's tokens: links as `TextLink`, inline
 *  code as `ui/Code`. */
function markdownStyles(c: PreviewPalette): string {
  return `
    :root { color-scheme: ${c.dark ? 'dark' : 'light'}; }
    body {
      margin: 0;
      padding: 28px 36px 64px;
      background: ${c.ground};
      color: ${c.ink};
      font: 14px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      overflow-wrap: break-word;
    }
    a { color: ${c.link}; text-decoration: none; text-underline-offset: 2px; }
    a:hover { text-decoration: underline; }
    h1, h2, h3, h4, h5, h6 { margin: 1.4em 0 0.6em; font-weight: 600; line-height: 1.25; }
    h1 { font-size: 1.8em; border-bottom: 1px solid ${c.line}; padding-bottom: 0.3em; }
    h2 { font-size: 1.4em; border-bottom: 1px solid ${c.line}; padding-bottom: 0.3em; }
    h3 { font-size: 1.2em; }
    p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
    ul, ol { padding-left: 1.6em; }
    li + li { margin-top: 0.25em; }
    code {
      font: 0.88em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: ${c.codeInk};
      background: ${c.codeBg};
      padding: 0.1em 0.3em;
      border-radius: 4px;
    }
    pre {
      background: ${c.codeBg};
      padding: 14px 16px;
      border-radius: 8px;
      overflow: auto;
    }
    pre code { color: inherit; background: none; padding: 0; }
    blockquote {
      margin-left: 0;
      padding: 0 1em;
      color: ${c.muted};
      border-left: 3px solid ${c.line};
    }
    table { border-collapse: collapse; display: block; overflow: auto; }
    th, td { border: 1px solid ${c.line}; padding: 6px 13px; }
    th { font-weight: 600; }
    img { max-width: 100%; }
    span.dash-image-alt { color: ${c.muted}; }
    hr { border: 0; border-top: 1px solid ${c.line}; margin: 1.6em 0; }
  `;
}

/** The HTML a file's text previews as, before its head and images. */
function previewBody(kind: PreviewKind, text: string): string {
  return kind === 'html' ? text : (marked.parse(text) as string);
}

/** Every `<img src>` the preview of `text` names: what it may want read. */
export function previewImageSources(kind: PreviewKind, text: string): string[] {
  return imageSources(previewBody(kind, text));
}

/**
 * The document the preview iframe shows for a file's text, each `<img>` as
 * `images` says (inlined, or its alt text; as written when it says nothing).
 * Markdown's raw HTML passes through `marked` unsanitized: the head's CSP
 * and the iframe's sandbox contain it, as they do an HTML file.
 */
export function previewDocument(
  kind: PreviewKind,
  text: string,
  palette: PreviewPalette,
  images: (src: string) => ImageShown | null = () => null,
): string {
  const body = inlineImages(previewBody(kind, text), images);
  if (kind === 'html') return withSafeHead(body);
  return withSafeHead(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${markdownStyles(palette)}</style></head><body>${body}</body></html>`);
}
