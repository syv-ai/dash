import { marked } from 'marked';

// GitHub-flavored markdown, rendered to a string synchronously (no async
// extensions registered). gfm/breaks defaults give tables, fenced code, and
// task lists without extra config.
marked.setOptions({ gfm: true });

/** A minimal GitHub-ish stylesheet, themed to roughly match the editor's
 *  light/dark background so the preview doesn't flash a jarring white page. */
function previewStyles(isDark: boolean): string {
  const c = isDark
    ? {
        bg: '#0d0d11',
        fg: '#d6d7de',
        muted: '#9aa0aa',
        border: '#2a2c34',
        codeBg: 'rgba(255,255,255,0.06)',
        link: '#6cb6ff',
      }
    : {
        bg: '#ffffff',
        fg: '#1f2328',
        muted: '#636c76',
        border: '#d0d7de',
        codeBg: 'rgba(0,0,0,0.05)',
        link: '#0969da',
      };
  return `
    :root { color-scheme: ${isDark ? 'dark' : 'light'}; }
    body {
      margin: 0;
      padding: 28px 36px 64px;
      background: ${c.bg};
      color: ${c.fg};
      font: 14px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      word-wrap: break-word;
    }
    a { color: ${c.link}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    h1, h2, h3, h4, h5, h6 { margin: 1.4em 0 0.6em; font-weight: 600; line-height: 1.25; }
    h1 { font-size: 1.8em; border-bottom: 1px solid ${c.border}; padding-bottom: 0.3em; }
    h2 { font-size: 1.4em; border-bottom: 1px solid ${c.border}; padding-bottom: 0.3em; }
    h3 { font-size: 1.2em; }
    p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
    ul, ol { padding-left: 1.6em; }
    li + li { margin-top: 0.25em; }
    code {
      font: 0.88em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: ${c.codeBg};
      padding: 0.2em 0.4em;
      border-radius: 4px;
    }
    pre {
      background: ${c.codeBg};
      padding: 14px 16px;
      border-radius: 8px;
      overflow: auto;
    }
    pre code { background: none; padding: 0; }
    blockquote {
      margin-left: 0;
      padding: 0 1em;
      color: ${c.muted};
      border-left: 3px solid ${c.border};
    }
    table { border-collapse: collapse; display: block; overflow: auto; }
    th, td { border: 1px solid ${c.border}; padding: 6px 13px; }
    th { font-weight: 600; }
    img { max-width: 100%; }
    hr { border: 0; border-top: 1px solid ${c.border}; margin: 1.6em 0; }
  `;
}

/**
 * Render markdown into a complete, self-contained HTML document for the
 * sandboxed preview iframe. The document carries its own stylesheet so it
 * looks right in isolation; any raw HTML in the markdown is contained by the
 * iframe sandbox (no same-origin), so no sanitizer is needed here.
 */
export function markdownToDocument(markdown: string, isDark: boolean): string {
  const body = marked.parse(markdown) as string;
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${previewStyles(isDark)}</style></head><body>${body}</body></html>`;
}
