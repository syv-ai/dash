import {
  MEMORY_INDEX_FILE,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_TYPES,
} from '@shared/types';
import type { MemoryFields, MemoryType } from '@shared/types';
import { memoryLinkFiles, memoryLinkTarget } from '@shared/memoryLinks';
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

/** Whether `line` is the index's pointer to `file`: a line linking that memory and no other. */
function pointsOnlyAt(line: string, file: string): boolean {
  const links = memoryLinkFiles(line);
  return links.size === 1 && links.has(file);
}

// `- [Title](target) — hook`, the hook optional: the line Claude writes per memory.
const POINTER_RE = /^(\s*[-*+]\s+)\[([^\]]*)\](\((?:<[^>\n]+>|[^)\s]+)\))(?:(\s+[—–-]\s+)(.*))?$/;

/** A memory's name as link text: brackets would end it early. */
function indexTitle(name: string): string {
  return name.replace(/[[\]]/g, '');
}

/**
 * The part of `index` Claude Code loads into a session: whole lines, up to
 * its line and byte limits. A line the byte limit cuts through isn't counted:
 * its link may not have made it.
 */
export function loadedIndex(index: string): string {
  const loaded: string[] = [];
  let bytes = 0;
  for (const line of index.split('\n').slice(0, MEMORY_INDEX_MAX_LINES)) {
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > MEMORY_INDEX_MAX_BYTES + 1) break;
    loaded.push(line);
  }
  return loaded.join('\n');
}

/** `file`'s own pointer in `lines`: where it is and its parts, or null when it has none in that shape. */
function ownPointer(
  lines: string[],
  file: string,
): {
  at: number;
  bullet: string;
  title: string;
  target: string;
  dash: string;
  hook: string;
} | null {
  const at = lines.findIndex((line) => pointsOnlyAt(line, file));
  const m = POINTER_RE.exec(lines[at] ?? '');
  if (!m) return null;
  const [, bullet = '', title = '', target = '', dash = ' — ', hook = ''] = m;
  return { at, bullet, title, target, dash, hook };
}

/** The hook on `file`'s own line of `index`, or null when it has no such line. */
export function indexHook(index: string, file: string): string | null {
  return ownPointer(index.split('\n'), file)?.hook.trim() ?? null;
}

/**
 * `index` with `file`'s pointer (the line that makes Claude recall it) in step
 * with a save: appended when the index doesn't link the memory at all, with
 * the description for a hook unless one is given. An existing line takes
 * `hook` when one is given, and its title follows a rename only if it was the
 * old name (`wasName`): Claude titles and hooks the line in its own words,
 * apart from the frontmatter, and those stay as written. A line shared with
 * another memory, or in some other shape, is left alone: it isn't ours to reword.
 */
export function setIndexLine(
  index: string,
  file: string,
  fields: MemoryFields,
  { wasName = fields.name, hook }: { wasName?: string; hook?: string } = {},
): string {
  const lines = index.split('\n');
  const own = ownPointer(lines, file);
  if (own) {
    const title = own.title === indexTitle(wasName) ? indexTitle(fields.name) : own.title;
    const newHook = hook ?? own.hook;
    // Rejoined only when something moved, so an untouched line keeps its bytes.
    if (title === own.title && newHook === own.hook.trim()) return index;
    lines[own.at] = `${own.bullet}[${title}]${own.target}${newHook ? own.dash + newHook : ''}`;
    return lines.join('\n');
  }
  if (memoryLinkFiles(index).has(file)) return index;
  const text = hook ?? fields.description;
  const target = memoryLinkTarget(file);
  const gap = index && !index.endsWith('\n') ? '\n' : '';
  return `${index}${gap}- [${indexTitle(fields.name)}](${target})${text ? ` — ${text}` : ''}\n`;
}

/**
 * `index` without the lines pointing at `file`. A line that also links another
 * memory is kept: dropping it would unindex that one too.
 */
export function removeIndexLines(index: string, file: string): string {
  return index
    .split('\n')
    .filter((line) => !pointsOnlyAt(line, file))
    .join('\n');
}

/**
 * `index` with `file`'s own line moved above every other memory's, where the
 * part Claude loads starts: whatever heads the index stays on top. A line
 * shared with another memory stays put, like everywhere else.
 */
export function raiseIndexLine(index: string, file: string): string {
  const lines = index.split('\n');
  const at = lines.findIndex((line) => pointsOnlyAt(line, file));
  const top = lines.findIndex((line) => memoryLinkFiles(line).size > 0);
  if (at <= top) return index;
  lines.splice(top, 0, ...lines.splice(at, 1));
  return lines.join('\n');
}
