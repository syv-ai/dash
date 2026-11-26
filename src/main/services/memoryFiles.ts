import {
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_TYPES,
} from '@shared/types';
import type { MemoryEntry, MemoryFields, MemoryType } from '@shared/types';

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const KEY_RE = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/;
// A block scalar's header: the value is the deeper-indented lines below it.
const BLOCK_RE = /^[>|][+-]?\d*$/;

function stripQuotes(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

export function toMemoryType(raw: string): MemoryType {
  const t = raw.trim().toLowerCase();
  return (MEMORY_TYPES as readonly string[]).includes(t) ? (t as MemoryType) : 'other';
}

/** A frontmatter value as text. */
function readScalar(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(t);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // A YAML-only escape: fall through to the plain unquote.
    }
  }
  // YAML's single quotes escape only themselves, by doubling.
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return stripQuotes(t);
}

/**
 * The value of the key on line `at` and how many lines it takes. A block
 * scalar (`>` or `|`) is read as one line, which is all a name or description
 * is here.
 */
function scalarAt(
  lines: string[],
  at: number,
  indent: string,
  raw: string,
): { value: string; span: number } {
  if (!BLOCK_RE.test(raw.trim())) return { value: readScalar(raw), span: 1 };
  let end = at + 1;
  for (; end < lines.length; end++) {
    const line = lines[end] ?? '';
    if (line.trim() && line.length - line.trimStart().length <= indent.length) break;
  }
  const value = lines
    .slice(at + 1, end)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
  return { value, span: end - at };
}

/**
 * A frontmatter block as Dash reads it: each top-level key's text, or for a
 * key with no value of its own (`metadata:`), its indented keys one level
 * down. Not a YAML parser — the repo has none, and these files are flat.
 */
export type Frontmatter = Record<string, string | Record<string, string>>;

/**
 * Split a memory file into its frontmatter (null when it has none) and its
 * body. The drift check (claudeContract `checkMemoryFrontmatter`) reads the
 * frontmatter whole; `parseMemoryFile` picks Dash's fields from it.
 */
export function readFrontmatter(content: string): {
  frontmatter: Frontmatter | null;
  body: string;
} {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { frontmatter: null, body: content };
  const body = content.slice(m[0].length);
  const frontmatter: Frontmatter = {};
  const lines = (m[1] ?? '').split(/\r?\n/);
  // The top-level key whose indented keys are being read, if any.
  let parent: Record<string, string> | null = null;
  for (let i = 0; i < lines.length; i++) {
    const kv = KEY_RE.exec(lines[i] ?? '');
    if (!kv) continue;
    const [, indent = '', key = '', raw = ''] = kv;
    const { value, span } = scalarAt(lines, i, indent, raw);
    // A block's own lines are text, not keys.
    i += span - 1;
    if (indent) {
      if (parent && !(key in parent)) parent[key] = value;
      continue;
    }
    if (raw.trim() === '') {
      parent = {};
      frontmatter[key] = parent;
    } else {
      parent = null;
      frontmatter[key] = value;
    }
  }
  return { frontmatter, body };
}

/** A top-level text value, or '' (absent, or a nested block). */
function text(fm: Frontmatter, key: string): string {
  const v = fm[key];
  return typeof v === 'string' ? v : '';
}

/**
 * Read a memory file's frontmatter. Two shapes exist on disk: the documented
 * one puts `type:` at the top level; others nest it under `metadata:`. `name`
 * and `description` are only taken at the top level so a nested key can't
 * shadow them.
 */
export function parseMemoryFile(content: string): MemoryFields {
  const { frontmatter: fm, body } = readFrontmatter(content);
  if (!fm) return { name: '', description: '', type: 'other', body };
  const nested = Object.values(fm).find(
    (v): v is Record<string, string> => typeof v === 'object' && typeof v.type === 'string',
  );
  return {
    name: text(fm, 'name'),
    description: text(fm, 'description'),
    type: toMemoryType(text(fm, 'type') || nested?.type || ''),
    body,
  };
}

/** A memory file's fields, named as it answers to: its frontmatter name, else its basename. */
export function readMemoryFields(content: string, file: string): MemoryFields {
  const parsed = parseMemoryFile(content);
  return { ...parsed, name: parsed.name || file.replace(/\.md$/, '') };
}

/** Whether `name` is a memory's file: a `.md` in the folder itself, and never the index. */
export function isMemoryFileName(name: string): boolean {
  return /^[^/\\:]+\.md$/.test(name) && name.toLowerCase() !== MEMORY_INDEX_FILE.toLowerCase();
}

// `[text](x.md)` or `[text](./x.md)`; a target with spaces sits in angle brackets.
const LINK_RE = /\[[^\]\n]*\]\((?:<(?:\.\/)?([^/\\:>\n]+\.md)>|(?:\.\/)?([^/\\:)\s]+\.md))\)/g;
const FENCE_RE = /^[ \t]*(?:```|~~~)/;
const INLINE_CODE_RE = /`[^`\n]+`/g;

/**
 * The memory files each line of `index` links to. A link in code (a fenced
 * block or an inline span) is a sample, not an index line.
 */
export function indexLinkFiles(index: string): string[][] {
  let fenced = false;
  return index.split('\n').map((line) => {
    if (FENCE_RE.test(line)) {
      fenced = !fenced;
      return [];
    }
    if (fenced) return [];
    return [...line.replace(INLINE_CODE_RE, '').matchAll(LINK_RE)].map((m) => m[1] ?? m[2] ?? '');
  });
}

/** How many of `lines` Claude Code loads: whole lines, up to its line and byte limits. */
function loadedLineCount(lines: string[]): number {
  let bytes = 0;
  let count = 0;
  for (const line of lines.slice(0, MEMORY_INDEX_MAX_LINES)) {
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > MEMORY_INDEX_MAX_BYTES + 1) break;
    count++;
  }
  return count;
}

/** What MEMORY.md says of one memory: the index half of a `MemoryEntry`. */
export type MemoryIndexLine = Pick<MemoryEntry, 'inIndex' | 'pastIndexLimit'>;

/**
 * Read `index` once, to ask what it says of each memory: whether a line links
 * it, and whether the first that does is past what Claude loads.
 */
export function readIndex(index: string): (file: string) => MemoryIndexLine {
  const links = indexLinkFiles(index);
  const loaded = loadedLineCount(index.split('\n'));
  return (file) => {
    const first = links.findIndex((on) => on.includes(file));
    return { inIndex: first >= 0, pastIndexLimit: first >= loaded };
  };
}

/**
 * How many memories were written or changed after `seenAt` (epoch ms), given
 * the memory folder's files: the count on the project row's badge. MEMORY.md
 * and other non-memory files don't count.
 */
export function countNewMemories(
  files: { name: string; mtimeMs: number }[],
  seenAt: number | null,
): number {
  if (seenAt === null) return 0;
  return files.filter((f) => isMemoryFileName(f.name) && f.mtimeMs > seenAt).length;
}

/** `index` without the lines that point at `file` alone (a line naming others too stays). */
export function withoutIndexLinks(index: string, file: string): string {
  const links = indexLinkFiles(index);
  return index
    .split('\n')
    .filter((_, i) => {
      const on = links[i] ?? [];
      return on.length === 0 || on.some((f) => f !== file);
    })
    .join('\n');
}
