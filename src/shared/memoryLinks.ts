/**
 * What counts as a markdown link to another memory: a target naming a `.md`
 * file in the memory folder itself (`x.md` or `./x.md`). The main process uses
 * it to flag memories MEMORY.md indexes; the preview uses it to make the same
 * links clickable, so "indexed" and "linked" can't disagree.
 */

const LINK_RE = /\]\(([^)\s]+)\)/g;
const SAME_FOLDER_MD_RE = /^(?:\.\/)?([^/\\:]+\.md)$/;

/** Rewrite each memory link in `markdown`; `replace` gets the file and the `](target)` match. */
export function mapMemoryLinks(
  markdown: string,
  replace: (file: string, match: string) => string,
): string {
  return markdown.replace(LINK_RE, (match, target: string) => {
    const file = SAME_FOLDER_MD_RE.exec(target)?.[1];
    return file ? replace(file, match) : match;
  });
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
