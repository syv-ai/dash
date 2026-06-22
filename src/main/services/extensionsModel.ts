import type {
  InstalledPlugin,
  ExtensionScopeRef,
  ExtensionScopeInput,
  ExtensionsOverview,
  OverviewPlugin,
  OverviewSkill,
  ScopeExtensions,
  SkillVisibility,
} from '@shared/types';
import { enumerateScopes, settingsFilePath } from './extensionScopes';
import { readSkillOverrides } from './skillOverrides';
import { PluginsService } from './PluginsService';
import { listScopeSkillFolders } from './SkillsService';

function toOverviewPlugin(p: InstalledPlugin): OverviewPlugin {
  return {
    id: p.id,
    name: p.name,
    marketplace: p.marketplace,
    enabled: p.enabled,
    version: p.version,
  };
}

/** Route each installed plugin to a scope id: user→global; project/local→the scope
 *  whose path equals projectPath. Unmatched (e.g. a repo not open in Dash) is dropped. */
export function assignPluginsToScopes(
  installed: InstalledPlugin[],
  scopes: ExtensionScopeRef[],
): Record<string, OverviewPlugin[]> {
  const byScope: Record<string, OverviewPlugin[]> = {};
  for (const s of scopes) byScope[s.id] = [];
  const byPath = new Map<string, ExtensionScopeRef>();
  for (const s of scopes) if (s.kind !== 'global') byPath.set(s.path, s);
  const global = scopes.find((s) => s.kind === 'global');

  for (const p of installed) {
    if (p.scope === 'user') {
      if (global) byScope[global.id]?.push(toOverviewPlugin(p));
      continue;
    }
    const match = p.projectPath ? byPath.get(p.projectPath) : undefined;
    if (match) byScope[match.id]?.push(toOverviewPlugin(p));
  }
  return byScope;
}

/** Pure assembly — keeps the IPC handler thin and the logic unit-testable. */
export function assembleOverview(
  scopes: ExtensionScopeRef[],
  installed: InstalledPlugin[],
  skillsByScopeId: Record<string, OverviewSkill[]>,
  claudeAvailable: boolean,
  overridesByScopeId: Record<string, Record<string, SkillVisibility>> = {},
): ExtensionsOverview {
  const pluginsByScope = assignPluginsToScopes(installed, scopes);
  const out: ScopeExtensions[] = scopes.map((scope) => ({
    scope,
    plugins: pluginsByScope[scope.id] ?? [],
    skills: skillsByScopeId[scope.id] ?? [],
    skillOverrides: overridesByScopeId[scope.id] ?? {},
  }));
  return { claudeAvailable, scopes: out };
}

/** Wires the real services. Reads installed plugins once (CLI), then per-scope skills. */
export async function getExtensionsOverview(
  input: ExtensionScopeInput,
): Promise<ExtensionsOverview> {
  const scopes = enumerateScopes(input);
  const pluginOverview = await PluginsService.getOverview();
  const skillsByScopeId: Record<string, OverviewSkill[]> = {};
  const overridesByScopeId: Record<string, Record<string, SkillVisibility>> = {};
  for (const scope of scopes) {
    const folders = listScopeSkillFolders(scope.path);
    const overrides = readSkillOverrides(settingsFilePath(scope));
    overridesByScopeId[scope.id] = overrides;
    skillsByScopeId[scope.id] = folders.map((f) => ({
      name: f.name,
      visibility: overrides[f.name] ?? 'on',
      fromRegistry: f.fromRegistry,
    }));
  }
  return assembleOverview(
    scopes,
    pluginOverview.installed,
    skillsByScopeId,
    pluginOverview.claudeAvailable,
    overridesByScopeId,
  );
}
