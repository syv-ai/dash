/**
 * What counts as a markdown link to another memory: a target naming a `.md`
 * file in the memory folder itself (`x.md` or `./x.md`). The main process uses
 * it to flag memories MEMORY.md indexes; the preview uses it to make the same
 * links clickable, so "indexed" and "linked" can't disagree.
 *
 * Memories also point at each other by name, as `[[name]]`. The preview
 * resolves those, a rename moves them, and a delete warns about them, all
 * through `mapMemoryRefs`.
 *
 * Neither is looked for in code (a fenced block or an inline span): `[[` there
 * is a shell test or a TOML table, not a memory.
 */

// A target is bare, or in angle brackets when it has spaces or parentheses.
const LINK_RE = /\]\((?:<([^>\n]+)>|([^)\s]+))\)/g;
const REF_RE = /\[\[([^\]\n]+)\]\]/g;
const SAME_FOLDER_MD_RE = /^(?:\.\/)?([^/\\:]+\.md)$/;
const CODE_RE = /(^[ \t]*(?:```|~~~)[\s\S]*?^[ \t]*(?:```|~~~)|`[^`\n]+`)/m;

/** `markdown` with `edit` applied to everything but its code. */
function outsideCode(markdown: string, edit: (text: string) => string): string {
  // Split on a capturing pattern: the odd parts are the code.
  return markdown
    .split(CODE_RE)
    .map((part, i) => (i % 2 ? part : edit(part)))
    .join('');
}

/** Rewrite each memory link in `markdown`; `replace` gets the file and the `](target)` match. */
export function mapMemoryLinks(
  markdown: string,
  replace: (file: string, match: string) => string,
): string {
  return outsideCode(markdown, (text) =>
    text.replace(LINK_RE, (match: string, angled?: string, bare?: string) => {
      const file = SAME_FOLDER_MD_RE.exec(angled ?? bare ?? '')?.[1];
      return file ? replace(file, match) : match;
    }),
  );
}

/**
 * Rewrite each memory link in `markdown`, text and all: what unlinking one or
 * showing it as dead takes. `replace` gets the file, the link's text and the
 * whole `[text](target)` match.
 */
export function mapWholeMemoryLinks(
  markdown: string,
  replace: (file: string, text: string, match: string) => string,
): string {
  // The same targets mapMemoryLinks finds, each traced back to where its text
  // opens: that text may hold code or brackets of its own.
  const edits: { start: number; end: number; text: string }[] = [];
  let offset = 0;
  markdown.split(CODE_RE).forEach((part, i) => {
    if (i % 2 === 0) {
      for (const m of part.matchAll(LINK_RE)) {
        const file = SAME_FOLDER_MD_RE.exec(m[1] ?? m[2] ?? '')?.[1];
        const close = offset + m.index;
        const start = file ? linkTextStart(markdown, close) : -1;
        // A target with no text before it isn't a link, and neither is one inside the last.
        if (!file || start < (edits.at(-1)?.end ?? 0)) continue;
        const end = close + m[0].length;
        const text = replace(file, markdown.slice(start + 1, close), markdown.slice(start, end));
        edits.push({ start, end, text });
      }
    }
    offset += part.length;
  });
  return edits.reduceRight(
    (out, { start, end, text }) => out.slice(0, start) + text + out.slice(end),
    markdown,
  );
}

/** Where the `[` matching the `]` at `close` is, or -1: a link's text ends at a blank line. */
function linkTextStart(markdown: string, close: number): number {
  let depth = 0;
  for (let i = close - 1; i >= 0; i--) {
    const ch = markdown[i];
    if (ch === '\n' && markdown[i - 1] === '\n') return -1;
    if (ch === ']') depth++;
    else if (ch === '[' && depth-- === 0) return i;
  }
  return -1;
}

/** `file` as a link target: in angle brackets when a bare one would end early. */
export function memoryLinkTarget(file: string): string {
  return /[\s()]/.test(file) ? `<${file}>` : file;
}

/** The memory files `markdown` links to. */
export function memoryLinkFiles(markdown: string): Set<string> {
  const files = new Set<string>();
  mapMemoryLinks(markdown, (file, match) => {
    files.add(file);
    return match;
  });
  return files;
}

/** Rewrite each `[[name]]` reference in `markdown`; `replace` gets the name as written and the match. */
export function mapMemoryRefs(
  markdown: string,
  replace: (ref: string, match: string) => string,
): string {
  return outsideCode(markdown, (text) =>
    text.replace(REF_RE, (match, ref: string) => replace(ref, match)),
  );
}
