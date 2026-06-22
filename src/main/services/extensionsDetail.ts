import { readFileSync, readdirSync, statSync } from 'fs';
import type { Dirent } from 'fs';
import os from 'os';
import path from 'path';
import type {
  ComponentDetail,
  GetPluginComponentDetailArgs,
  PluginComponents,
  SkillDetail,
  SkillRef,
} from '@shared/types';
import { parseSkillFrontmatter } from './skillFrontmatter';
import { resolvePluginInstallPath, listPluginComponents } from './pluginComponents';
import { SkillsService } from './SkillsService';

/** Resolve `child` under `base`, returning null if it escapes the base (path
 *  traversal via `..`, an absolute segment, or an empty result). The renderer
 *  supplies skill/component names; this is the boundary guard so a crafted name
 *  can't read files outside the intended skills/components tree. */
function resolveWithin(base: string, child: string): string | null {
  const resolved = path.resolve(base, child);
  const rel = path.relative(base, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

/** Recursively list files under a skill folder (POSIX-relative), excluding SKILL.md
 *  and dotfiles. Sorted; empty on any read error. */
function listSkillFiles(skillDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel);
      else if (e.isFile() && rel !== 'SKILL.md') out.push(rel);
    }
  };
  walk(skillDir, '');
  return out.sort();
}

const EMPTY_COMPONENTS: PluginComponents = { skills: [], agents: [], commands: [], hooks: [] };

// installed_plugins.json is read once per plugin to resolve its install dir; rendering
// a scope fetches components for every visible plugin, so without caching we re-parse
// the same (potentially large) file N times per overview. Cache the parse keyed by the
// file's mtime so an external install/uninstall still invalidates it.
let installedPluginsCache: { mtimeMs: number; parsed: unknown } | null = null;

function readInstalledPlugins(): unknown {
  const file = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    installedPluginsCache = null;
    return null;
  }
  if (installedPluginsCache && installedPluginsCache.mtimeMs === mtimeMs) {
    return installedPluginsCache.parsed;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    installedPluginsCache = { mtimeMs, parsed };
    return parsed;
  } catch {
    installedPluginsCache = null;
    return null;
  }
}

/** Resolve an installed plugin's on-disk directory from installed_plugins.json. */
function pluginInstallPath(pluginId: string): string | null {
  return resolvePluginInstallPath(readInstalledPlugins(), pluginId);
}

/** Bundled components for an installed plugin, resolved via installed_plugins.json. */
export async function getPluginComponents(pluginId: string): Promise<PluginComponents> {
  const installPath = pluginInstallPath(pluginId);
  if (!installPath) return EMPTY_COMPONENTS;
  return listPluginComponents(installPath);
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

/** Full detail for one bundled plugin component, read from the plugin's install dir.
 *  Skills → SKILL.md + frontmatter + files; agents/commands → their `.md`; hooks →
 *  the event's config JSON from hooks/hooks.json. */
export async function getPluginComponentDetail(
  args: GetPluginComponentDetailArgs,
): Promise<ComponentDetail> {
  const { pluginId, kind, name } = args;
  const base: ComponentDetail = { kind, name };
  const installPath = pluginInstallPath(pluginId);
  if (!installPath) return base;

  if (kind === 'skill') {
    const dir = resolveWithin(path.join(installPath, 'skills'), name);
    if (dir === null) return base;
    const raw = readText(path.join(dir, 'SKILL.md'));
    if (raw === null) return base;
    return { ...base, ...parseSkillFrontmatter(raw), kind, name, raw, files: listSkillFiles(dir) };
  }
  if (kind === 'agent' || kind === 'command') {
    const sub = kind === 'agent' ? 'agents' : 'commands';
    // Command names may be namespaced (`foo/bar`) → they resolve into subdirs; the
    // containment check still rejects anything escaping the agents/commands tree.
    const file = resolveWithin(path.join(installPath, sub), `${name}.md`);
    if (file === null) return base;
    const raw = readText(file);
    if (raw === null) return base;
    return { ...base, ...parseSkillFrontmatter(raw), kind, name, raw };
  }
  // hook: surface the event's configuration from hooks.json
  const hooksRaw = readText(path.join(installPath, 'hooks', 'hooks.json'));
  if (hooksRaw === null) return base;
  try {
    const parsed = JSON.parse(hooksRaw) as { hooks?: Record<string, unknown> };
    const config = parsed.hooks?.[name];
    if (config === undefined) return base;
    return { ...base, raw: JSON.stringify(config, null, 2) };
  } catch {
    return base;
  }
}

/** Frontmatter + raw contents + bundled files for a standalone skill under a
 *  scope's .claude/skills. */
export function getSkillDetail(scopePath: string, skillName: string): SkillDetail {
  const skillDir = resolveWithin(path.join(scopePath, '.claude', 'skills'), skillName);
  if (skillDir === null) return {};
  let content: string;
  try {
    content = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
  } catch {
    return {};
  }
  return { ...parseSkillFrontmatter(content), raw: content, files: listSkillFiles(skillDir) };
}

/** Detail for a not-yet-installed registry skill: fetches its SKILL.md from the
 *  pinned GitHub registry (reusing SkillsService's validated fetch) and parses the
 *  frontmatter. No `files` list — that would need a remote directory listing the
 *  detail drawer doesn't show. `assertRef` (inside getSkillContent) rejects a
 *  crafted repo/path/branch. */
export async function getRegistrySkillDetail(ref: SkillRef): Promise<SkillDetail> {
  const raw = await SkillsService.getSkillContent(ref);
  return { ...parseSkillFrontmatter(raw), raw };
}
