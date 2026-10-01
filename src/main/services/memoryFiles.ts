import { MEMORY_INDEX_FILE, MEMORY_TYPES } from '@shared/types';
import type { MemoryFields, MemoryType } from '@shared/types';
import { memoryLinkFiles } from '@shared/memoryLinks';
import { slugify } from '@shared/slug';
import { stripQuotes } from './skillFrontmatter';

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const KEY_RE = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/;

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
  return stripQuotes(t);
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
  for (const line of m[1].split(/\r?\n/)) {
    const kv = KEY_RE.exec(line);
    if (!kv) continue;
    const [, indent, key, raw = ''] = kv;
    if (!indent && key === 'name') out.name = readScalar(raw);
    else if (!indent && key === 'description') out.description = readScalar(raw);
    else if (key === 'type') out.type = toMemoryType(readScalar(raw));
  }
  return out;
}

/** Frontmatter for a memory Dash creates, in the shape Claude Code writes today. */
function newFrontmatter(fields: MemoryFields): string[] {
  return [
    `name: ${yamlScalar(fields.name)}`,
    ...(fields.description ? [`description: ${yamlScalar(fields.description)}`] : []),
    'metadata:',
    '  node_type: memory',
    ...(fields.type === 'other' ? [] : [`  type: ${fields.type}`]),
  ];
}

/**
 * `existing` frontmatter lines with `fields` applied; every other line is kept
 * as is. A file with a `metadata:` block also gets Claude's `modified` stamp.
 */
function editedFrontmatter(existing: string[], fields: MemoryFields, now: Date): string[] {
  const seen = new Set<string>();
  const lines = existing.map((line) => {
    const kv = KEY_RE.exec(line);
    if (!kv) return line;
    const [, indent = '', key] = kv;
    if (!indent && (key === 'name' || key === 'description')) {
      seen.add(key);
      return `${key}: ${yamlScalar(fields[key])}`;
    }
    if (indent && key === 'modified') {
      seen.add(key);
      return `${indent}modified: ${now.toISOString()}`;
    }
    if (key !== 'type') return line;
    seen.add(key);
    // `other` is "no known type", not a type to write: leave what is there.
    return fields.type === 'other' ? line : `${indent}type: ${fields.type}`;
  });
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
    : newFrontmatter(fields);
  const body = fields.body.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
}

/** The file a new memory called `name` is saved as. Never the index, in any casing. */
export function memoryFileName(name: string): string {
  const slug = slugify(name);
  const file = `${slug || 'memory-note'}.md`;
  return file.toLowerCase() === MEMORY_INDEX_FILE.toLowerCase() ? 'memory-note.md' : file;
}

/** Whether `line` is the index's pointer to `file`: a line linking that memory and no other. */
function pointsOnlyAt(line: string, file: string): boolean {
  const links = memoryLinkFiles(line);
  return links.size === 1 && links.has(file);
}

/**
 * `index` with `file`'s pointer (the line that makes Claude recall it) saying
 * what `fields` say: rewritten where it stands, or appended when the index
 * doesn't link the memory at all. A line shared with another memory is left
 * alone: it isn't ours to reword.
 */
export function setIndexLine(index: string, file: string, fields: MemoryFields): string {
  // Brackets would end the link text early.
  const title = fields.name.replace(/[[\]]/g, '');
  const hook = fields.description ? ` — ${fields.description}` : '';
  const pointer = `- [${title}](${file})${hook}`;

  const lines = index.split('\n');
  const at = lines.findIndex((line) => pointsOnlyAt(line, file));
  if (at >= 0) {
    lines[at] = pointer;
    return lines.join('\n');
  }
  if (memoryLinkFiles(index).has(file)) return index;
  const gap = index && !index.endsWith('\n') ? '\n' : '';
  return `${index}${gap}${pointer}\n`;
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
