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
