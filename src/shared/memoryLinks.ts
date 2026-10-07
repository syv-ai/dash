import { MEMORY_INDEX_FILE } from './types';

/**
 * What counts as a markdown link to another memory: `[text](target)` with a
 * target naming a `.md` file in the memory folder itself (`x.md` or `./x.md`).
 * The main process uses it to flag memories MEMORY.md indexes; the modal uses
 * it to make the same links clickable, to call one dead and to repoint or
 * unlink it, so "indexed", "linked" and "dead" can't disagree.
 *
 * Memories also point at each other by name, as `[[name]]`. The preview
 * resolves those, a rename moves them, a delete warns about them and a fix
 * repoints them, all through `mapMemoryRefs`.
 *
 * Neither is looked for in code (a fenced block or an inline span): `[[` there
 * is a shell test or a TOML table, not a memory.
 */

// A target is bare, or in angle brackets when it has spaces or parentheses.
const LINK_RE = /\]\((?:<([^>\n]+)>|([^)\s]+))\)/g;
const REF_RE = /\[\[([^\]\n]+)\]\]/g;
const INDEX_FILE_LOWER = MEMORY_INDEX_FILE.toLowerCase();
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

interface FoundLink {
  file: string;
  /** Where its `[` is, where its `](` starts, and where the link ends. */
  start: number;
  close: number;
  end: number;
}

/**
 * Every memory link in `markdown`, in order: the one place that decides what
 * is one. Each target is traced back to where its text opens, since that text
 * may hold code or brackets of its own.
 */
function findMemoryLinks(markdown: string): FoundLink[] {
  const links: FoundLink[] = [];
  let offset = 0;
  markdown.split(CODE_RE).forEach((part, i) => {
    if (i % 2 === 0) {
      for (const m of part.matchAll(LINK_RE)) {
        const file = SAME_FOLDER_MD_RE.exec(m[1] ?? m[2] ?? '')?.[1];
        const close = offset + m.index;
        const start = file ? linkTextStart(markdown, close) : -1;
        // A target with no text before it isn't a link, and neither is one whose
        // text holds the link before it: the inner link wins.
        if (!file || start < (links.at(-1)?.end ?? 0)) continue;
        links.push({ file, start, close, end: close + m[0].length });
      }
    }
    offset += part.length;
  });
  return links;
}

/** `markdown` with each found link's `from`…`end` replaced by what `text` returns for it. */
function replaceLinks(
  markdown: string,
  from: 'start' | 'close',
  text: (link: FoundLink) => string,
): string {
  // Asked in reading order, spliced in from the end so earlier offsets hold.
  const edits = findMemoryLinks(markdown).map((link) => ({ link, text: text(link) }));
  return edits.reduceRight(
    (out, { link, text }) => out.slice(0, link[from]) + text + out.slice(link.end),
    markdown,
  );
}

/** Rewrite each memory link's target in `markdown`; `replace` gets the file and the `](target)` match. */
export function mapMemoryLinks(
  markdown: string,
  replace: (file: string, match: string) => string,
): string {
  return replaceLinks(markdown, 'close', ({ file, close, end }) =>
    replace(file, markdown.slice(close, end)),
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
  return replaceLinks(markdown, 'start', ({ file, start, close, end }) =>
    replace(file, markdown.slice(start + 1, close), markdown.slice(start, end)),
  );
}

/** Where the `[` matching the `]` at `close` is, or -1 when there is none before an empty line (`\n\n`), which link text cannot span. */
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

/**
 * The memory files each line of `markdown` links to, a link counted on the
 * line its target is on. Read off the whole text, so a line inside a code
 * block links nothing: asked of one line alone, the fence around it is unseen.
 */
export function memoryLinkFilesByLine(markdown: string): Set<string>[] {
  const lines = markdown.split('\n').map(() => new Set<string>());
  let line = 0;
  let lineEnd = markdown.indexOf('\n');
  for (const link of findMemoryLinks(markdown)) {
    while (lineEnd !== -1 && lineEnd < link.close) {
      line++;
      lineEnd = markdown.indexOf('\n', lineEnd + 1);
    }
    lines[line]?.add(link.file);
  }
  return lines;
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

/** A memory file's basename without `.md`: what it answers to when it has no name. */
export function memoryBaseName(file: string): string {
  return file.replace(/\.md$/, '');
}

/**
 * Which file a `[[ref]]` means among `memories`: the memory with that name,
 * else the one with that basename. The preview follows it, and a rename moves
 * the refs it gives to the renamed memory.
 */
export function resolveMemoryRef(
  memories: { file: string; name: string }[],
): (ref: string) => string | undefined {
  const byName = new Map(memories.map((m) => [m.name, m.file]));
  const files = new Set(memories.map((m) => m.file));
  return (ref) => {
    const name = ref.trim();
    return byName.get(name) ?? (files.has(`${name}.md`) ? `${name}.md` : undefined);
  };
}

/**
 * Whether `name` is a memory's file: a `.md` in the memory folder itself that
 * a link can name, and never the index in any casing. The list shows exactly
 * the files the writes accept.
 */
export function isMemoryFileName(name: string): boolean {
  return SAME_FOLDER_MD_RE.exec(name)?.[1] === name && name.toLowerCase() !== INDEX_FILE_LOWER;
}
