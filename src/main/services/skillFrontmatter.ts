import type { SkillDetail } from '@shared/types';

function stripQuotes(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseInlineList(v: string): string[] {
  let s = v.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  return s
    .split(',')
    .map((x) => stripQuotes(x).trim())
    .filter((x) => x.length > 0);
}

/** Minimal YAML-frontmatter reader for SKILL.md — supports the handful of keys we
 *  surface (name, description, model, allowed-tools) as scalars, inline comma/bracket
 *  lists, or block (`- item`) lists. Not a general YAML parser (the repo has none). */
export function parseSkillFrontmatter(content: string): SkillDetail {
  const m = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m || m[1] === undefined) return {};
  const lines = m[1].split(/\r?\n/);
  const out: SkillDetail = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv || kv[1] === undefined) {
      i++;
      continue;
    }
    const key = kv[1].toLowerCase();
    const rawValue = (kv[2] ?? '').trim();

    // Block list: "key:" followed by indented "- item" lines.
    if (rawValue === '' && /^\s*-\s+/.test(lines[i + 1] ?? '')) {
      const items: string[] = [];
      i++;
      while (i < lines.length && /^\s*-\s+/.test(lines[i] ?? '')) {
        items.push(stripQuotes((lines[i] as string).replace(/^\s*-\s+/, '')));
        i++;
      }
      if (key === 'allowed-tools') out.allowedTools = items;
      continue;
    }

    if (key === 'name') out.name = stripQuotes(rawValue);
    else if (key === 'description') out.description = stripQuotes(rawValue);
    else if (key === 'model') out.model = stripQuotes(rawValue);
    else if (key === 'allowed-tools') out.allowedTools = parseInlineList(rawValue);
    i++;
  }
  return out;
}
