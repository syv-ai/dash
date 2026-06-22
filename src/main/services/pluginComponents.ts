import { readdirSync, readFileSync } from 'fs';
import type { Dirent } from 'fs';
import path from 'path';
import type { PluginComponentSummary, PluginComponents } from '@shared/types';
import { parseSkillFrontmatter } from './skillFrontmatter';

const byName = (a: PluginComponentSummary, b: PluginComponentSummary) =>
  a.name.localeCompare(b.name);

/** Read a component's `.md`, returning its frontmatter description (undefined if
 *  unreadable). Name is supplied by the caller (folder/file basename). */
function readDescription(file: string): string | undefined {
  try {
    return parseSkillFrontmatter(readFileSync(file, 'utf-8')).description;
  } catch {
    return undefined;
  }
}

/** Pick a plugin's on-disk directory from a parsed installed_plugins.json. Any
 *  install record's installPath works (records for one id/version share content);
 *  returns the first non-empty one, else null. */
export function resolvePluginInstallPath(
  installedPlugins: unknown,
  pluginId: string,
): string | null {
  if (!installedPlugins || typeof installedPlugins !== 'object') return null;
  const plugins = (installedPlugins as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== 'object') return null;
  const records = (plugins as Record<string, unknown>)[pluginId];
  if (!Array.isArray(records)) return null;
  for (const r of records) {
    if (r && typeof r === 'object') {
      const p = (r as { installPath?: unknown }).installPath;
      if (typeof p === 'string' && p.length > 0) return p;
    }
  }
  return null;
}

/** Enumerate each `<installPath>/skills/<name>/SKILL.md`, reading its description.
 *  Folders without a readable SKILL.md are skipped. Missing skills dir -> []. */
export function listPluginSkills(installPath: string): PluginComponentSummary[] {
  const skillsDir = path.join(installPath, 'skills');
  let entries: Dirent[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true }) as Dirent[];
  } catch {
    return [];
  }
  const out: PluginComponentSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    let content: string;
    try {
      content = readFileSync(path.join(skillsDir, e.name, 'SKILL.md'), 'utf-8');
    } catch {
      continue; // not a skill folder
    }
    out.push({ name: e.name, description: parseSkillFrontmatter(content).description });
  }
  return out.sort(byName);
}

/** Enumerate `<installPath>/agents/*.md` by file basename. Missing dir -> []. */
export function listPluginAgents(installPath: string): PluginComponentSummary[] {
  const dir = path.join(installPath, 'agents');
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
  } catch {
    return [];
  }
  const out: PluginComponentSummary[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    out.push({
      name: e.name.replace(/\.md$/, ''),
      description: readDescription(path.join(dir, e.name)),
    });
  }
  return out.sort(byName);
}

/** Enumerate `<installPath>/commands/**` recursively; name is the path under
 *  `commands/` without the `.md` extension (namespaced commands keep their folder).
 *  Missing dir -> []. */
export function listPluginCommands(installPath: string): PluginComponentSummary[] {
  const root = path.join(installPath, 'commands');
  const out: PluginComponentSummary[] = [];
  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.md')) {
        const rel = path.relative(root, full).replace(/\.md$/, '');
        out.push({ name: rel, description: readDescription(full) });
      }
    }
  };
  walk(root);
  return out.sort(byName);
}

/** List hook event names from `<installPath>/hooks/hooks.json` (the keys of its
 *  top-level `hooks` map). Missing/malformed -> []. */
export function listPluginHooks(installPath: string): PluginComponentSummary[] {
  const file = path.join(installPath, 'hooks', 'hooks.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (!hooks || typeof hooks !== 'object') return [];
  return Object.keys(hooks as Record<string, unknown>)
    .map((name) => ({ name }))
    .sort(byName);
}

/** All of a plugin's bundled components, grouped by type. */
export function listPluginComponents(installPath: string): PluginComponents {
  return {
    skills: listPluginSkills(installPath),
    agents: listPluginAgents(installPath),
    commands: listPluginCommands(installPath),
    hooks: listPluginHooks(installPath),
  };
}
