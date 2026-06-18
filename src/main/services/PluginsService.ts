import { readFileSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type {
  PluginsOverview,
  PluginMarketplace,
  CatalogPlugin,
  InstalledPlugin,
  PluginInstallTarget,
  PluginScope,
} from '@shared/types';
import { findClaudePath } from './claudeCli';

const execFileAsync = promisify(execFile);

// Dash drives Claude Code's native plugin system (`claude plugin …`) rather than
// re-implementing install/copy the way SkillsService does for individual registry
// skills. The CLI owns marketplaces (clone + catalog), the cache, and the
// enabledPlugins/known_marketplaces bookkeeping — so the whole plugin (skills,
// commands, agents, hooks, MCP/LSP) comes along and `marketplace update` keeps it fresh.

// `marketplace add`/`update` clone or pull a git repo; allow headroom on slow links.
const CLI_TIMEOUT_MS = 120_000;

// Syv.ai's agentic-coding-playbook, surfaced as a recommended one-click in the UI.
export const SYV_MARKETPLACE_REPO = 'syv-ai/agentic-coding-playbook';
export const SYV_MARKETPLACE_NAME = 'syv-skills';
export const SYV_PLUGIN_ID = 'syv-skills@syv-skills';

// Plugin/marketplace identifiers flow into `claude` argv (execFile, so no shell), but
// we still validate to reject obviously bogus input and keep error messages sane.
const PLUGIN_ID_RE = /^[\w.-]+@[\w.-]+$/;
const MARKETPLACE_NAME_RE = /^[\w.-]+$/;
// A source is a GitHub owner/repo, a git/https URL (optionally #ref), or a filesystem
// path. We disallow only whitespace and shell-control characters as a sanity guard.
const SOURCE_RE = /^[^\s;&|`$<>]+$/;
const VALID_SCOPES: ReadonlySet<string> = new Set(['user', 'project', 'local']);

function assertPluginId(id: string): void {
  if (!PLUGIN_ID_RE.test(id)) throw new Error(`Invalid plugin id: ${JSON.stringify(id)}`);
}
function assertMarketplaceName(name: string): void {
  if (!MARKETPLACE_NAME_RE.test(name)) {
    throw new Error(`Invalid marketplace name: ${JSON.stringify(name)}`);
  }
}
function assertSource(source: string): void {
  if (!source || !SOURCE_RE.test(source)) {
    throw new Error(`Invalid marketplace source: ${JSON.stringify(source)}`);
  }
}
function assertScope(scope: string): asserts scope is PluginScope {
  if (!VALID_SCOPES.has(scope)) throw new Error(`Invalid scope: ${JSON.stringify(scope)}`);
}

function describe(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
    if (stderr) return stderr;
    const stdout = typeof e.stdout === 'string' ? e.stdout.trim() : '';
    if (stdout) return stdout;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

async function resolveClaude(): Promise<string> {
  const claudePath = await findClaudePath();
  if (!claudePath) {
    throw new Error(
      'Claude Code CLI not found. Install Claude Code and ensure `claude` is on your PATH, then try again.',
    );
  }
  return claudePath;
}

async function runClaude(args: string[], cwd?: string): Promise<{ stdout: string }> {
  const claudePath = await resolveClaude();
  try {
    const { stdout } = await execFileAsync(claudePath, args, {
      timeout: CLI_TIMEOUT_MS,
      cwd: cwd || undefined,
      // Inherit the boot-time PATH fix so `git` (used by marketplace clone/pull) resolves.
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: stdout ?? '' };
  } catch (err) {
    throw new Error(describe(err));
  }
}

async function runClaudeJson(args: string[]): Promise<unknown> {
  const { stdout } = await runClaude(args);
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `Could not parse \`claude ${args.join(' ')}\` output as JSON: ${describe(err)}`,
    );
  }
}

function scopeArgs(target: PluginInstallTarget): { args: string[]; cwd?: string } {
  assertScope(target.scope);
  const args = ['--scope', target.scope];
  const cwd = target.scope === 'user' ? undefined : target.cwd;
  if (target.scope !== 'user' && !cwd) {
    throw new Error(`A working directory is required for ${target.scope}-scope plugin operations.`);
  }
  return { args, cwd };
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// marketplace.json `plugins[]` entries carry author as a string or { name } object.
function authorName(v: unknown): string | undefined {
  if (typeof v === 'string') return v || undefined;
  if (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string') {
    return (v as { name: string }).name || undefined;
  }
  return undefined;
}

function parseMarketplaces(raw: unknown): PluginMarketplace[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginMarketplace[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const name = asString(r.name);
    if (!name) continue;
    out.push({
      name,
      source: asString(r.source) || 'unknown',
      repo: asString(r.repo),
      url: asString(r.url),
      path: asString(r.path),
      installLocation: asString(r.installLocation),
    });
  }
  return out;
}

function parseInstalled(raw: unknown): InstalledPlugin[] {
  if (!Array.isArray(raw)) return [];
  const out: InstalledPlugin[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const id = asString(r.id);
    if (!id) continue;
    const [name, marketplace] = id.includes('@') ? id.split('@') : [id, ''];
    out.push({
      id,
      name: name || id,
      marketplace: marketplace || '',
      version: asString(r.version),
      scope: asString(r.scope) || 'user',
      enabled: r.enabled === true,
      projectPath: asString(r.projectPath),
    });
  }
  return out;
}

// Each registered marketplace ships its catalog in
// <installLocation>/.claude-plugin/marketplace.json under a `plugins[]` array.
function readCatalogForMarketplace(m: PluginMarketplace): CatalogPlugin[] {
  if (!m.installLocation) return [];
  const file = path.join(m.installLocation, '.claude-plugin', 'marketplace.json');
  const parsed = readJson(file);
  if (!parsed || typeof parsed !== 'object') return [];
  const plugins = (parsed as { plugins?: unknown }).plugins;
  if (!Array.isArray(plugins)) return [];
  const out: CatalogPlugin[] = [];
  for (const p of plugins) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const name = asString(r.name);
    if (!name) continue;
    out.push({
      id: `${name}@${m.name}`,
      name,
      marketplace: m.name,
      description: asString(r.description),
      author: authorName(r.author),
      category: asString(r.category),
      homepage: asString(r.homepage),
      version: asString(r.version),
    });
  }
  return out;
}

export class PluginsService {
  static async getOverview(): Promise<PluginsOverview> {
    const claudePath = await findClaudePath();
    if (!claudePath) {
      return { claudeAvailable: false, marketplaces: [], catalog: [], installed: [] };
    }

    const [marketplacesRaw, installedRaw] = await Promise.all([
      runClaudeJson(['plugin', 'marketplace', 'list', '--json']).catch(() => []),
      runClaudeJson(['plugin', 'list', '--json']).catch(() => []),
    ]);

    const marketplaces = parseMarketplaces(marketplacesRaw);
    const installed = parseInstalled(installedRaw);
    const catalog = marketplaces.flatMap(readCatalogForMarketplace);

    return { claudeAvailable: true, marketplaces, catalog, installed };
  }

  static async addMarketplace(
    source: string,
    scope: PluginScope = 'user',
    cwd?: string,
    sparse?: string[],
  ) {
    assertSource(source);
    assertScope(scope);
    const args = ['plugin', 'marketplace', 'add', source, '--scope', scope];
    const paths = (sparse ?? []).map((p) => p.trim()).filter((p) => p.length > 0);
    for (const p of paths) {
      // Guard against argv injection — a sparse path must not look like a flag.
      if (p.startsWith('-')) throw new Error(`Invalid sparse path: ${JSON.stringify(p)}`);
    }
    if (paths.length > 0) args.push('--sparse', ...paths);
    await runClaude(args, scope === 'user' ? undefined : cwd);
    return this.getOverview();
  }

  static async removeMarketplace(name: string, scope: PluginScope = 'user', cwd?: string) {
    assertMarketplaceName(name);
    assertScope(scope);
    const args = ['plugin', 'marketplace', 'remove', name, '--scope', scope];
    await runClaude(args, scope === 'user' ? undefined : cwd);
    return this.getOverview();
  }

  static async updateMarketplace(name?: string) {
    if (name) assertMarketplaceName(name);
    const args = ['plugin', 'marketplace', 'update', ...(name ? [name] : [])];
    await runClaude(args);
    return this.getOverview();
  }

  static async installPlugin(id: string, target: PluginInstallTarget) {
    assertPluginId(id);
    const { args, cwd } = scopeArgs(target);
    await runClaude(['plugin', 'install', id, ...args], cwd);
    return this.getOverview();
  }

  static async uninstallPlugin(id: string, target: PluginInstallTarget) {
    assertPluginId(id);
    const { args, cwd } = scopeArgs(target);
    // -y skips the prune confirmation that would otherwise hang in our non-TTY exec.
    await runClaude(['plugin', 'uninstall', id, ...args, '-y'], cwd);
    return this.getOverview();
  }

  static async setEnabled(id: string, enabled: boolean, target: PluginInstallTarget) {
    assertPluginId(id);
    const { args, cwd } = scopeArgs(target);
    await runClaude(['plugin', enabled ? 'enable' : 'disable', id, ...args], cwd);
    return this.getOverview();
  }
}
