import {
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_TYPES,
} from '@shared/types';
import type { MemoryEntry, MemoryFields, MemoryType } from '@shared/types';
import { stripQuotes } from './skillFrontmatter';

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const KEY_RE = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/;
// A block scalar's header: the value is the deeper-indented lines below it.
const BLOCK_RE = /^[>|][+-]?\d*$/;

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
 * Read a memory file's frontmatter. Two shapes exist on disk: older files put
 * `type:` at the top level; newer ones nest it under `metadata:`. `name` and
 * `description` are only taken at the top level so a nested key can't shadow
 * them. Not a YAML parser — the repo has none, and these files are flat.
 */
export function parseMemoryFile(content: string): MemoryFields {
  const m = FRONTMATTER_RE.exec(content);
  const out: MemoryFields = {
    name: '',
    description: '',
    type: 'other',
    body: m ? content.slice(m[0].length) : content,
  };
  if (!m?.[1]) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = KEY_RE.exec(lines[i] ?? '');
    if (!kv) continue;
    const [, indent = '', key, raw = ''] = kv;
    const { value, span } = scalarAt(lines, i, indent, raw);
    if (!indent && key === 'name') out.name = value;
    else if (!indent && key === 'description') out.description = value;
    else if (key === 'type') out.type = toMemoryType(value);
    // A block's own lines are text, not keys.
    i += span - 1;
  }
  return out;
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
