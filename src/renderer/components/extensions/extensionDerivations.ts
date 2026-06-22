import type {
  ExtensionsOverview,
  CatalogPlugin,
  ScopeExtensions,
  ExtensionScopeRef,
  OverviewPlugin,
  SkillVisibility,
} from '../../../shared/types';

/** Scope display-names where a plugin id is present (for "Installed in" + badges). */
export function pluginInstallScopes(overview: ExtensionsOverview, pluginId: string): string[] {
  return overview.scopes
    .filter((s) => s.plugins.some((p) => p.id === pluginId))
    .map((s) => s.scope.name);
}

/** Scope display-names where a standalone skill folder is present. */
export function skillInstallScopes(overview: ExtensionsOverview, skillName: string): string[] {
  return overview.scopes
    .filter((s) => s.skills.some((sk) => sk.name === skillName))
    .map((s) => s.scope.name);
}

/** Filter a plugin catalog to one marketplace; null = all sources. */
export function filterCatalogByMarketplace(
  catalog: CatalogPlugin[],
  marketplace: string | null,
): CatalogPlugin[] {
  if (!marketplace) return catalog;
  return catalog.filter((p) => p.marketplace === marketplace);
}

// ── Inheritance (Global → Project → Task) ────────────────────────────────────

/** Where an effective item comes from, relative to the scope being viewed. */
export type Provenance =
  | { kind: 'local' }
  | { kind: 'inherited'; from: string }
  | { kind: 'overridden'; from: string };

export interface EffectivePlugin {
  plugin: OverviewPlugin;
  provenance: Provenance;
}

export interface EffectiveSkill {
  name: string;
  visibility: SkillVisibility;
  fromRegistry: boolean;
  provenance: Provenance;
  /** True when this scope physically holds the skill folder (vs. only inheriting it).
   *  For a task this is true even for inherited skills, because the worktree shares
   *  the project's committed `.claude/skills` tree — so it does NOT imply an override. */
  hasLocalFolder: boolean;
  /** Scope whose `.claude/skills/<name>/` to read for detail (nearest scope that
   *  physically has the folder). */
  ownerScope: ExtensionScopeRef;
}

/** Ancestor scopes a scope inherits from, ordered far→near: Global, then the
 *  owning project (task scopes only). */
function ancestorsOf(overview: ExtensionsOverview, scope: ScopeExtensions): ScopeExtensions[] {
  if (scope.scope.kind === 'global') return [];
  const out: ScopeExtensions[] = [];
  const global = projectAncestorOf(overview, 'global');
  if (global) out.push(global);
  if (scope.scope.kind === 'task' && scope.scope.projectId) {
    const project = projectAncestorOf(overview, `project:${scope.scope.projectId}`);
    if (project) out.push(project);
  }
  return out;
}

function projectAncestorOf(
  overview: ExtensionsOverview,
  scopeId: string,
): ScopeExtensions | undefined {
  return overview.scopes.find((s) => s.scope.id === scopeId);
}

/** Effective plugins for a scope: ancestors' plugins (inherited) merged with the
 *  scope's own (local, or overridden when it shares an inherited id). */
export function effectivePlugins(
  overview: ExtensionsOverview,
  scope: ScopeExtensions,
): EffectivePlugin[] {
  const map = new Map<string, EffectivePlugin>();
  for (const anc of ancestorsOf(overview, scope)) {
    for (const p of anc.plugins) {
      map.set(p.id, { plugin: p, provenance: { kind: 'inherited', from: anc.scope.name } });
    }
  }
  for (const p of scope.plugins) {
    const existing = map.get(p.id);
    const from = existing && existing.provenance.kind !== 'local' ? existing.provenance.from : null;
    map.set(p.id, {
      plugin: p,
      provenance: from ? { kind: 'overridden', from } : { kind: 'local' },
    });
  }
  return [...map.values()];
}

/** Effective standalone skills for a scope, with provenance.
 *
 *  Override is decided by an explicit `skillOverrides` entry in THIS scope — never
 *  by folder presence. A task worktree physically contains the project's committed
 *  skill folders (shared git tree), so a folder being present locally is treated as
 *  inheritance, not a local addition, when the project also has it. Only a folder
 *  absent upstream (genuinely added in the worktree) counts as local. */
export function effectiveSkills(
  overview: ExtensionsOverview,
  scope: ScopeExtensions,
): EffectiveSkill[] {
  const ancestors = ancestorsOf(overview, scope);
  const projectAncestor =
    scope.scope.kind === 'task' && scope.scope.projectId
      ? projectAncestorOf(overview, `project:${scope.scope.projectId}`)
      : undefined;
  const inProjectAncestor = new Set(projectAncestor?.skills.map((sk) => sk.name) ?? []);

  const map = new Map<string, EffectiveSkill>();
  // 1. Inherited from ancestors (nearer ancestor wins the provenance label).
  for (const anc of ancestors) {
    for (const sk of anc.skills) {
      map.set(sk.name, {
        name: sk.name,
        visibility: sk.visibility,
        fromRegistry: sk.fromRegistry,
        provenance: { kind: 'inherited', from: anc.scope.name },
        hasLocalFolder: false,
        ownerScope: anc.scope,
      });
    }
  }
  // 2. Folders physically in this scope.
  for (const sk of scope.skills) {
    const inherited = map.get(sk.name);
    const sharedWithProject = scope.scope.kind === 'task' && inProjectAncestor.has(sk.name);
    if (inherited && sharedWithProject) {
      // Same committed file the worktree shares — still inherited, just present here.
      map.set(sk.name, { ...inherited, hasLocalFolder: true, ownerScope: scope.scope });
    } else {
      // The scope's own folder (a project's own skill, or one added in this worktree).
      map.set(sk.name, {
        name: sk.name,
        visibility: sk.visibility,
        fromRegistry: sk.fromRegistry,
        provenance: { kind: 'local' },
        hasLocalFolder: true,
        ownerScope: scope.scope,
      });
    }
  }
  // 3. Explicit overrides set in THIS scope flip an inherited skill to "overridden".
  for (const [name, visibility] of Object.entries(scope.skillOverrides)) {
    const existing = map.get(name);
    if (!existing) continue;
    if (existing.provenance.kind === 'local') {
      map.set(name, { ...existing, visibility });
    } else {
      // In this branch provenance is 'inherited' or 'overridden' — both carry `from`.
      map.set(name, {
        ...existing,
        visibility,
        provenance: { kind: 'overridden', from: existing.provenance.from },
      });
    }
  }
  return [...map.values()];
}

/** How many task scopes inherit from the given (project) scope id — for the
 *  cascade-confirm when disabling a project default. */
export function inheritingTaskCount(overview: ExtensionsOverview, scopeId: string): number {
  return overview.scopes.filter(
    (s) => s.scope.kind === 'task' && `project:${s.scope.projectId}` === scopeId,
  ).length;
}
