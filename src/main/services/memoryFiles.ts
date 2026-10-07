import {
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_TYPES,
} from '@shared/types';
import type { MemoryEntry, MemoryFields, MemoryType } from '@shared/types';
import { memoryBaseName, memoryLinkFilesByLine, memoryLinkTarget } from '@shared/memoryLinks';
import { stripQuotes } from './skillFrontmatter';

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const KEY_RE = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/;
// A block scalar's header: the value is the deeper-indented lines below it.
const BLOCK_RE = /^[>|][+-]?\d*$/;

export function toMemoryType(raw: string): MemoryType {
  const t = raw.trim().toLowerCase();
  return (MEMORY_TYPES as readonly string[]).includes(t) ? (t as MemoryType) : 'other';
}

/** A frontmatter value as text. Double-quoted values are what `yamlScalar` writes. */
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

/** Bare when that is unambiguous YAML, otherwise double-quoted (JSON is valid YAML). */
function yamlScalar(value: string): string {
  const bare =
    /^[A-Za-z][\w .,/()+-]*$/.test(value) &&
    value === value.trim() &&
    !/^(true|false|null|yes|no|on|off)$/i.test(value);
  return bare ? value : JSON.stringify(value);
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
  return { ...parsed, name: parsed.name || memoryBaseName(file) };
}

/** Frontmatter for a memory Dash creates, in the shape Claude Code writes today. */
function newFrontmatter(fields: MemoryFields, now: Date): string[] {
  return [
    `name: ${yamlScalar(fields.name)}`,
    ...(fields.description ? [`description: ${yamlScalar(fields.description)}`] : []),
    'metadata:',
    '  node_type: memory',
    ...(fields.type === 'other' ? [] : [`  type: ${fields.type}`]),
    `  modified: ${now.toISOString()}`,
  ];
}

/**
 * `existing` frontmatter lines with `fields` applied; every other line is kept
 * as is, and so is a value that hasn't changed, however it was written (its
 * quoting is Claude's). The file also gets Claude's `modified` stamp, where
 * Claude Code puts it: in the `metadata:` block, or last at the top level of
 * a file without one.
 */
function editedFrontmatter(existing: string[], fields: MemoryFields, now: Date): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (let i = 0; i < existing.length; i++) {
    const line = existing[i] ?? '';
    const kv = KEY_RE.exec(line);
    const [, indent = '', key, raw = ''] = kv ?? [];
    if (!indent && (key === 'name' || key === 'description')) {
      seen.add(key);
      const { value, span } = scalarAt(existing, i, indent, raw);
      if (value === fields[key]) lines.push(...existing.slice(i, i + span));
      else lines.push(`${key}: ${yamlScalar(fields[key])}`);
      i += span - 1;
    } else if (key === 'modified') {
      seen.add(key);
      lines.push(`${indent}modified: ${now.toISOString()}`);
    } else if (key === 'type') {
      seen.add(key);
      // `other` is "no known type", not a type to write: leave what is there.
      const kept = fields.type === 'other' || toMemoryType(readScalar(raw)) === fields.type;
      lines.push(kept ? line : `${indent}type: ${fields.type}`);
    } else {
      lines.push(line);
    }
  }
  if (!seen.has('name')) lines.unshift(`name: ${yamlScalar(fields.name)}`);
  if (!seen.has('description') && fields.description) {
    const after = lines.findIndex((l) => l.startsWith('name:')) + 1;
    lines.splice(after, 0, `description: ${yamlScalar(fields.description)}`);
  }
  let metadata = lines.findIndex((l) => /^metadata:\s*$/.test(l));
  if (!seen.has('type') && fields.type !== 'other') {
    if (metadata < 0) metadata = lines.push('metadata:') - 1;
    lines.splice(metadata + 1, 0, `  type: ${fields.type}`);
  }
  if (!seen.has('modified') && metadata >= 0) {
    let end = metadata + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end] ?? '')) end++;
    lines.splice(end, 0, `  modified: ${now.toISOString()}`);
  } else if (!seen.has('modified')) {
    lines.push(`modified: ${now.toISOString()}`);
  }
  return lines;
}

/**
 * A memory file holding `fields`. Given the file's current content, its
 * frontmatter is edited in place: keys Dash doesn't know, and where `type:`
 * sits, survive a save. Without it the file gets the current shape.
 */
export function serializeMemoryFile(fields: MemoryFields, existing = '', now = new Date()): string {
  const m = FRONTMATTER_RE.exec(existing);
  const lines = m?.[1]
    ? editedFrontmatter(m[1].split(/\r?\n/), fields, now)
    : newFrontmatter(fields, now);
  const body = fields.body.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
  // A body that started right under the frontmatter stays there.
  const tight = m !== null && /^[ \t]*\S/.test(existing.slice(m[0].length));
  return `---\n${lines.join('\n')}\n---\n${tight ? '' : '\n'}${body}\n`;
}

/** The file a new memory called `name` is saved as. Never the index, in any casing. */
export function memoryFileName(name: string): string {
  // Not `slugify`: that keeps ASCII only, which leaves "Ærø" as `r.md` and
  // gives every name in another script the same file.
  const slug = [...name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')]
    .slice(0, 50)
    .join('')
    .replace(/^-+|-+$/g, '');
  const file = `${slug || 'memory-note'}.md`;
  return file.toLowerCase() === MEMORY_INDEX_FILE.toLowerCase() ? 'memory-note.md' : file;
}

// `- [Title](target) — hook`, the hook optional: the line Claude writes per memory.
const POINTER_RE = /^(\s*[-*+]\s+)\[([^\]]*)\](\((?:<[^>\n]+>|[^)\s]+)\))(?:(\s+[—–-]\s+)(.*))?$/;

/** A memory's name as link text: brackets would end it early. */
function indexTitle(name: string): string {
  return name.replace(/[[\]]/g, '');
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

/**
 * The part of `index` Claude Code loads into a session: whole lines, up to
 * its line and byte limits. A line the byte limit cuts through isn't counted:
 * its link may not have made it.
 */
export function loadedIndex(index: string): string {
  const lines = index.split('\n');
  return lines.slice(0, loadedLineCount(lines)).join('\n');
}

/**
 * MEMORY.md as its lines and the memories each one links: every question
 * about a memory's line is asked of this, so they are all answered by the
 * one link finder, read over the whole index (a line in a code block links
 * nothing).
 */
interface IndexLines {
  lines: string[];
  links: Set<string>[];
}

function indexLines(index: string): IndexLines {
  return { lines: index.split('\n'), links: memoryLinkFilesByLine(index) };
}

/** Where `file`'s own line is: the first that links it and no other memory. -1 without one. */
function ownLineAt({ links }: IndexLines, file: string): number {
  return links.findIndex((on) => on.size === 1 && on.has(file));
}

/** Where the list of memories starts: its first line linking one, headings aside. -1 without one. */
function listTop({ lines, links }: IndexLines): number {
  return links.findIndex((on, i) => on.size > 0 && !/^\s*#/.test(lines[i] ?? ''));
}

/** `file`'s own pointer: where it is and its parts, or null when it has none in that shape. */
function ownPointer(
  parsed: IndexLines,
  file: string,
): {
  at: number;
  bullet: string;
  title: string;
  target: string;
  dash: string;
  hook: string;
} | null {
  const at = ownLineAt(parsed, file);
  const m = POINTER_RE.exec(parsed.lines[at] ?? '');
  if (!m) return null;
  const [, bullet = '', title = '', target = '', dash = ' — ', hook = ''] = m;
  return { at, bullet, title, target, dash, hook };
}

/** What MEMORY.md says of one memory: the index half of a `MemoryEntry`. */
export type MemoryIndexLine = Pick<MemoryEntry, 'inIndex' | 'ownLine' | 'pastIndexLimit' | 'hook'>;

/** Read `index` once, to ask what it says of each memory. */
export function readIndex(index: string): (file: string) => MemoryIndexLine {
  const parsed = indexLines(index);
  const loaded = loadedLineCount(parsed.lines);
  return (file) => {
    const first = parsed.links.findIndex((on) => on.has(file));
    return {
      inIndex: first >= 0,
      ownLine: ownLineAt(parsed, file) >= 0,
      pastIndexLimit: first >= loaded,
      hook: ownPointer(parsed, file)?.hook.trim() ?? null,
    };
  };
}

/** The hook on `file`'s own line of `index`, or null when it has no such line in the pointer shape. */
export function indexHook(index: string, file: string): string | null {
  return readIndex(index)(file).hook;
}

const FULL_BEFORE_LIST = `the part of ${MEMORY_INDEX_FILE} Claude loads is full before its first memory line`;

/**
 * `index` with `file`'s pointer (the line that makes Claude recall it) in step
 * with a save. A memory the index doesn't link gets a line, with the
 * description for a hook unless one is given: at the end, or at the top of the
 * list once the end is past what Claude loads. Throws when that line would not
 * be read as its link, or can't be put where Claude loads it. An existing line
 * takes `hook` when one is given, and its title follows a rename only if it
 * was the old name (`wasName`): Claude titles and hooks the line in its own
 * words, apart from the frontmatter, and those stay as written. It is never
 * moved here (see raiseIndexLine). A line shared with another memory, or in
 * some other shape, is left alone: it isn't ours to reword.
 */
export function setIndexLine(
  index: string,
  file: string,
  fields: MemoryFields,
  { wasName = fields.name, hook }: { wasName?: string; hook?: string } = {},
): string {
  const parsed = indexLines(index);
  const { lines } = parsed;
  const own = ownPointer(parsed, file);
  if (own) {
    const title = own.title === indexTitle(wasName) ? indexTitle(fields.name) : own.title;
    const newHook = hook ?? own.hook;
    // Rejoined only when something changed, so an untouched line keeps its bytes.
    if (title === own.title && newHook === own.hook.trim()) return index;
    lines[own.at] = `${own.bullet}[${title}]${own.target}${newHook ? own.dash + newHook : ''}`;
    return lines.join('\n');
  }
  if (parsed.links.some((on) => on.has(file))) return index;

  const text = hook ?? fields.description;
  const line = `- [${indexTitle(fields.name)}](${memoryLinkTarget(file)})${text ? ` — ${text}` : ''}`;
  const gap = index && !index.endsWith('\n') ? '\n' : '';
  const atEnd = `${index}${gap}${line}\n`;
  const top = listTop(parsed);
  const added =
    top < 0 || !readIndex(atEnd)(file).pastIndexLimit
      ? atEnd
      : [...lines.slice(0, top), line, ...lines.slice(top)].join('\n');
  const result = readIndex(added)(file);
  if (!result.inIndex) {
    throw new Error(
      `its line would not read as a link to ${file}: a backtick or bracket in the name or hook breaks it`,
    );
  }
  if (result.pastIndexLimit) throw new Error(FULL_BEFORE_LIST);
  return added;
}

/**
 * `index` without the lines pointing at `file`. A line that also links another
 * memory is kept: dropping it would unindex that one too.
 */
export function removeIndexLines(index: string, file: string): string {
  const { lines, links } = indexLines(index);
  return lines.filter((_, i) => !(links[i]?.size === 1 && links[i]?.has(file))).join('\n');
}

/**
 * `index` with `file`'s own line moved to the top of the list: above the
 * first line that links a memory, inside the part Claude loads. Whatever heads
 * the index stays above it. Returned unchanged when the line is already there.
 * Throws when `file` has no line of its own (a line shared with another memory
 * stays put, like everywhere else), or when even the top of the list is past
 * what Claude loads.
 */
export function raiseIndexLine(index: string, file: string): string {
  const parsed = indexLines(index);
  const { lines } = parsed;
  const at = ownLineAt(parsed, file);
  if (at < 0) throw new Error(`${file} has no line of its own in ${MEMORY_INDEX_FILE} to move`);
  const top = listTop(parsed);
  const raised =
    at <= top
      ? index
      : [...lines.slice(0, top), lines[at], ...lines.slice(top, at), ...lines.slice(at + 1)].join(
          '\n',
        );
  if (readIndex(raised)(file).pastIndexLimit) throw new Error(FULL_BEFORE_LIST);
  return raised;
}
