import { promises as fs } from 'fs';
import * as path from 'path';
import type { AgentDefinition, SlashCommand, SlashCommandSource } from '@shared/slashCommands';
import { claudeConfigDir, claudeUserSettingsFile } from '../utils/claudePaths';
import { checkInstalledPlugins } from '../claudeContract/internalSchemas';
import { reportFindings } from '../claudeContract/driftReporter';
import { claudeVersionFor } from '../claudeContract/claudeVersions';

/*
 * The slash commands, skills and custom agents a project's sessions can use,
 * read where Claude Code finds them (code.claude.com/docs/en/skills,
 * /plugins-reference, /sub-agents):
 * skills at `<root>/skills/<name>/SKILL.md`, commands at
 * `<root>/commands/**\/*.md` (a subfolder namespaces: `frontend/x.md` is
 * `/frontend:x`), for the user (`~/.claude`), the project (`<repo>/.claude`)
 * and each enabled plugin (`/<plugin>:<name>`). Built-in commands are not
 * listed. A skill with `user-invocable: false` isn't either: Claude Code hides
 * it from its own `/` menu.
 */

/** The frontmatter fields the list reads, and the body after it. */
export interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

/**
 * A markdown file's YAML frontmatter, read only as far as the list needs: top
 * level `key: value` scalars (quoted or not), plain scalars continued on
 * indented lines, and `|`/`>` block scalars. Lists and maps are skipped.
 * Frontmatter counts only when `---` is the file's first line.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { fields: {}, body: text };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return { fields: {}, body: text };

  const fields: Record<string, string> = {};
  let key: string | null = null;
  let block: '|' | '>' | null = null;
  let parts: string[] = [];
  const flush = () => {
    if (key !== null) fields[key] = parts.join(block === '|' ? '\n' : ' ').trim();
    key = null;
    block = null;
    parts = [];
  };
  for (const line of lines.slice(1, end)) {
    const top = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (top) {
      flush();
      key = top[1]!;
      const value = (top[2] ?? '').trim();
      if (/^[|>][+-]?$/.test(value)) block = value[0] as '|' | '>';
      else if (value) parts.push(unquote(value));
    } else if (key !== null && /^\s/.test(line)) {
      parts.push(line.trim());
    } else {
      flush();
    }
  }
  flush();
  return { fields, body: lines.slice(end + 1).join('\n') };
}

function unquote(value: string): string {
  const q = value[0];
  if ((q === '"' || q === "'") && value.endsWith(q) && value.length > 1) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * One file's command, or null when it shouldn't be listed. `fallbackName` is
 * the folder (a skill) or the path (a command); a skill's `name` wins over it.
 * The description falls back to the body's first non-empty line, as Claude
 * Code's does.
 */
export function commandFromFile(
  text: string,
  fallbackName: string,
  opts: { source: SlashCommandSource; kind: 'skill' | 'command'; prefix?: string },
): SlashCommand | null {
  const { fields, body } = parseFrontmatter(text);
  if (fields['user-invocable']?.toLowerCase() === 'false') return null;
  const own = opts.kind === 'skill' ? fields.name?.trim() : undefined;
  const name = `${opts.prefix ?? ''}${own || fallbackName}`;
  const firstLine = body
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0);
  const hint = fields['argument-hint']?.trim();
  return {
    name,
    description: fields.description?.trim() || firstLine || '',
    ...(hint ? { argumentHint: hint } : {}),
    source: opts.source,
  };
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function readJson(file: string): Promise<unknown> {
  const text = await readText(file);
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function dirEntries(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function skillsIn(
  dir: string,
  source: SlashCommandSource,
  prefix?: string,
): Promise<SlashCommand[]> {
  const out: SlashCommand[] = [];
  for (const entry of await dirEntries(dir)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const text = await readText(path.join(dir, entry.name, 'SKILL.md'));
    if (text === null) continue;
    const cmd = commandFromFile(text, entry.name, { source, kind: 'skill', prefix });
    if (cmd) out.push(cmd);
  }
  return out;
}

async function commandsIn(
  dir: string,
  source: SlashCommandSource,
  prefix?: string,
  namespace: string[] = [],
): Promise<SlashCommand[]> {
  const out: SlashCommand[] = [];
  for (const entry of await dirEntries(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await commandsIn(full, source, prefix, [...namespace, entry.name])));
    } else if (entry.name.endsWith('.md')) {
      const text = await readText(full);
      if (text === null) continue;
      const name = [...namespace, entry.name.slice(0, -'.md'.length)].join(':');
      const cmd = commandFromFile(text, name, { source, kind: 'command', prefix });
      if (cmd) out.push(cmd);
    }
  }
  return out;
}

function enabledPluginsOf(settings: unknown): Record<string, boolean> {
  const value = (settings as { enabledPlugins?: unknown } | undefined)?.enabledPlugins;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'),
  );
}

interface PluginInstall {
  scope: string;
  installPath: string;
  projectPath?: string;
}

/**
 * The plugins enabled for `projectPath` (user, project then local settings,
 * the later winning) with an install that applies to it: a user-scoped one,
 * or one installed for this project. Each as `[plugin name, install path]`.
 */
export function enabledPluginRoots(
  installed: Record<string, PluginInstall[]>,
  enabled: Record<string, boolean>,
  projectPath: string,
): [string, string][] {
  const roots: [string, string][] = [];
  for (const [key, on] of Object.entries(enabled)) {
    if (!on) continue;
    const installs = installed[key] ?? [];
    const install =
      installs.find((i) => i.projectPath === projectPath) ??
      installs.find((i) => i.scope === 'user');
    if (install) roots.push([key.split('@')[0]!, install.installPath]);
  }
  return roots;
}

function pluginsDir(): string {
  return process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(claudeConfigDir(), 'plugins');
}

/** The plugins enabled for `projectPath`, as `[plugin name, install path]` (see enabledPluginRoots). */
async function pluginRootsFor(projectPath: string): Promise<[string, string][]> {
  const raw = await readJson(path.join(pluginsDir(), 'installed_plugins.json'));
  if (raw === undefined) return [];
  reportFindings('installed-plugins', checkInstalledPlugins(raw), claudeVersionFor());
  const plugins = (raw as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== 'object') return [];
  const installed: Record<string, PluginInstall[]> = {};
  for (const [key, list] of Object.entries(plugins)) {
    if (!Array.isArray(list)) continue;
    installed[key] = list.filter(
      (i): i is PluginInstall =>
        !!i && typeof i.scope === 'string' && typeof i.installPath === 'string',
    );
  }
  const enabled = {
    ...enabledPluginsOf(await readJson(claudeUserSettingsFile())),
    ...enabledPluginsOf(await readJson(path.join(projectPath, '.claude', 'settings.json'))),
    ...enabledPluginsOf(await readJson(path.join(projectPath, '.claude', 'settings.local.json'))),
  };
  return enabledPluginRoots(installed, enabled, projectPath);
}

async function pluginCommands(projectPath: string): Promise<SlashCommand[]> {
  const lists = await Promise.all(
    (await pluginRootsFor(projectPath)).map(async ([name, root]) => [
      ...(await skillsIn(path.join(root, 'skills'), 'plugin', `${name}:`)),
      ...(await commandsIn(path.join(root, 'commands'), 'plugin', `${name}:`)),
    ]),
  );
  return lists.flat();
}

/**
 * Every slash command and skill a session in `projectPath` can run, by name.
 * On a name clash the user's wins over the project's, and a skill over a
 * command (the docs' precedence).
 */
export async function listSlashCommands(projectPath: string): Promise<SlashCommand[]> {
  const user = claudeConfigDir();
  const project = path.join(projectPath, '.claude');
  const lists = await Promise.all([
    skillsIn(path.join(user, 'skills'), 'user'),
    skillsIn(path.join(project, 'skills'), 'project'),
    commandsIn(path.join(user, 'commands'), 'user'),
    commandsIn(path.join(project, 'commands'), 'project'),
    pluginCommands(projectPath),
  ]);
  const byName = new Map<string, SlashCommand>();
  for (const cmd of lists.flat()) if (!byName.has(cmd.name)) byName.set(cmd.name, cmd);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Agents ──────────────────────────────────────────────────

/**
 * One agent file's definition, or null when Claude Code wouldn't load it. A
 * user or project file needs a frontmatter `name` (one without is
 * documentation kept beside the agents, and `:` is reserved for plugins); a
 * plugin's loads under its file name when it has none, and is scoped by the
 * plugin and its folders: `agents/review/security.md` in `my-plugin` is
 * `my-plugin:review:security` (sub-agents docs, fetched 2026-11-27).
 */
export function agentFromFile(
  text: string,
  fileName: string,
  opts: { source: SlashCommandSource; scope?: string[] },
): AgentDefinition | null {
  const { fields } = parseFrontmatter(text);
  const own = fields.name?.trim();
  if (opts.source === 'plugin') {
    const name = [...(opts.scope ?? []), own || fileName].join(':');
    return { name, description: fields.description?.trim() ?? '', source: 'plugin' };
  }
  if (!own || own.includes(':')) return null;
  return { name: own, description: fields.description?.trim() ?? '', source: opts.source };
}

/** Every agent file under `dir`, folders included (Claude Code scans them recursively). */
async function agentsIn(
  dir: string,
  source: SlashCommandSource,
  scope?: string[],
): Promise<AgentDefinition[]> {
  const out: AgentDefinition[] = [];
  for (const entry of await dirEntries(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // A plugin's folders are part of the name; a user's or project's aren't.
      out.push(...(await agentsIn(full, source, scope && [...scope, entry.name])));
    } else if (entry.name.endsWith('.md')) {
      const text = await readText(full);
      if (text === null) continue;
      const agent = agentFromFile(text, entry.name.slice(0, -'.md'.length), { source, scope });
      if (agent) out.push(agent);
    }
  }
  return out;
}

/**
 * One plugin's agents: its `agents/` folder, plus the files and folders its
 * manifest's `agents` names (`.claude-plugin/plugin.json`, a path or a list,
 * relative to the plugin root; plugins-reference: custom paths add to the
 * default folder). A manifest file is named `<plugin>:<name>`.
 */
async function pluginAgents(plugin: string, root: string): Promise<AgentDefinition[]> {
  const manifest = await readJson(path.join(root, '.claude-plugin', 'plugin.json'));
  const listed = (manifest as { agents?: unknown } | undefined)?.agents;
  const extra = (Array.isArray(listed) ? listed : [listed]).filter(
    (p): p is string => typeof p === 'string',
  );
  const lists = await Promise.all([
    agentsIn(path.join(root, 'agents'), 'plugin', [plugin]),
    ...extra.map(async (rel) => {
      const full = path.resolve(root, rel);
      // Only inside the plugin: a manifest can't point Dash elsewhere.
      if (full !== root && !full.startsWith(root + path.sep)) return [];
      if (full.endsWith('.md')) {
        const text = await readText(full);
        const agent =
          text === null
            ? null
            : agentFromFile(text, path.basename(full, '.md'), {
                source: 'plugin',
                scope: [plugin],
              });
        return agent ? [agent] : [];
      }
      return agentsIn(full, 'plugin', [plugin]);
    }),
  ]);
  return lists.flat();
}

/**
 * The custom agents a session in `projectPath` can run as (`--agent`), by
 * name. On a clash the project's wins over the user's, and both over a
 * plugin's (the docs' priority; managed and `--agents` ones aren't listed).
 * Built-in agents aren't listed either.
 */
export async function listAgents(projectPath: string): Promise<AgentDefinition[]> {
  const lists = await Promise.all([
    agentsIn(path.join(projectPath, '.claude', 'agents'), 'project'),
    agentsIn(path.join(claudeConfigDir(), 'agents'), 'user'),
    pluginRootsFor(projectPath).then(async (roots) =>
      (await Promise.all(roots.map(([name, root]) => pluginAgents(name, root)))).flat(),
    ),
  ]);
  const byName = new Map<string, AgentDefinition>();
  for (const agent of lists.flat()) if (!byName.has(agent.name)) byName.set(agent.name, agent);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
