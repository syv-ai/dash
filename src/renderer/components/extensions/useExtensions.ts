import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ExtensionsOverview,
  ExtensionScopeRef,
  SkillVisibility,
  SkillRef,
  PluginComponents,
  PluginComponentKind,
  ComponentDetail,
  SkillDetail,
  PluginScope,
  CatalogPlugin,
  PluginMarketplace,
} from '../../../shared/types';
import { pluginTargetFor, skillTargetFor } from './scopeTargets';

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
}
export interface TaskInfo {
  taskId: string;
  name: string;
  worktreePath: string;
  projectId: string;
}

/** Where a skill's SKILL.md is read from for the detail drawer: an installed copy
 *  under a scope's `.claude/skills`, or a not-yet-installed registry entry fetched
 *  remotely by repo/path/branch. */
export type SkillDetailSource =
  | { kind: 'scope'; scope: ExtensionScopeRef }
  | { kind: 'registry'; ref: SkillRef };

/** What the detail drawer is showing. */
export type DetailRef =
  | { kind: 'plugin'; pluginId: string; name: string; marketplace: string; version?: string }
  | { kind: 'skill'; skillName: string; fromRegistry: boolean; source: SkillDetailSource }
  /** A read-only component bundled in a plugin (skill/agent/command/hook). */
  | {
      kind: 'plugin-component';
      pluginId: string;
      pluginName: string;
      componentKind: PluginComponentKind;
      name: string;
      description?: string;
    };

export interface DetailData {
  pluginComponents?: PluginComponents;
  skill?: SkillDetail;
  component?: ComponentDetail;
}

export function useExtensions(projects: ProjectInfo[], tasks: TaskInfo[]) {
  const [overview, setOverview] = useState<ExtensionsOverview | null>(null);
  // Plugin catalog + marketplaces live here too so the single load() cycle refreshes
  // them alongside the installed overview — Browse and the detail drawer are pure
  // consumers, with no separate fetch to go stale after a mutation.
  const [catalog, setCatalog] = useState<CatalogPlugin[]>([]);
  const [marketplaces, setMarketplaces] = useState<PluginMarketplace[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<DetailRef | null>(null);
  const [detailData, setDetailData] = useState<DetailData>({});
  const [detailLoading, setDetailLoading] = useState(false);
  // Cache a plugin's bundled components by pluginId so the card and the drawer don't
  // refetch (the inline expander stays instant on re-open). Held in a ref, not state:
  // it's a pure memo store nothing renders off, and keeping it out of state gives
  // loadPluginComponents a stable identity — otherwise every cache write would recreate
  // openDetail and re-fire every PluginRow's load effect (O(N²) churn).
  const pluginComponentCache = useRef<Record<string, PluginComponents>>({});

  const loadPluginComponents = useCallback(async (pluginId: string): Promise<PluginComponents> => {
    const cached = pluginComponentCache.current[pluginId];
    if (cached) return cached;
    const res = await window.electronAPI.extensionsGetPluginComponents({ pluginId });
    const empty: PluginComponents = { skills: [], agents: [], commands: [], hooks: [] };
    const components = res.success && res.data ? res.data : empty;
    pluginComponentCache.current[pluginId] = components;
    return components;
  }, []);

  const closeDetail = useCallback(() => setDetail(null), []);

  const openDetail = useCallback(
    async (ref: DetailRef) => {
      setDetail(ref);
      // Seed a bundled component with what the expander already knows, then fetch full.
      setDetailData(
        ref.kind === 'plugin-component'
          ? { component: { kind: ref.componentKind, name: ref.name, description: ref.description } }
          : {},
      );
      setDetailLoading(true);
      try {
        if (ref.kind === 'plugin') {
          setDetailData({ pluginComponents: await loadPluginComponents(ref.pluginId) });
        } else if (ref.kind === 'plugin-component') {
          const res = await window.electronAPI.extensionsGetPluginComponentDetail({
            pluginId: ref.pluginId,
            kind: ref.componentKind,
            name: ref.name,
          });
          setDetailData({
            component:
              res.success && res.data
                ? res.data
                : { kind: ref.componentKind, name: ref.name, description: ref.description },
          });
        } else if (ref.source.kind === 'registry') {
          // Not-yet-installed registry skill: fetch its SKILL.md remotely instead of
          // reading a local folder that doesn't exist yet.
          const res = await window.electronAPI.extensionsGetRegistrySkillDetail(ref.source.ref);
          setDetailData({ skill: res.success && res.data ? res.data : {} });
        } else {
          const res = await window.electronAPI.extensionsGetSkillDetail({
            scope: ref.source.scope,
            skillName: ref.skillName,
          });
          setDetailData({ skill: res.success && res.data ? res.data : {} });
        }
      } finally {
        setDetailLoading(false);
      }
    },
    [loadPluginComponents],
  );

  const scopeInput = useMemo(
    () => ({
      projects: projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
      tasks: tasks.map((t) => ({
        taskId: t.taskId,
        name: t.name,
        worktreePath: t.worktreePath,
        projectId: t.projectId,
      })),
    }),
    [projects, tasks],
  );

  const load = useCallback(async () => {
    try {
      const [res, plugins] = await Promise.all([
        window.electronAPI.extensionsGetOverview(scopeInput),
        window.electronAPI.pluginsGetOverview(),
      ]);
      if (res.success && res.data) {
        setOverview(res.data);
        setError(null);
      } else {
        setError(res.error || 'Could not load extensions.');
      }
      if (plugins.success && plugins.data) {
        setCatalog(plugins.data.catalog);
        setMarketplaces(plugins.data.marketplaces);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [scopeInput]);

  useEffect(() => {
    void load();
  }, [load]);

  // Run a mutation, then re-fetch the unified overview (mutations return their own
  // shapes; we ignore those and reload the canonical model).
  const run = useCallback(
    async (key: string, op: () => Promise<{ success: boolean; error?: string }>) => {
      setBusy(key);
      setError(null);
      try {
        const res = await op();
        if (!res.success) {
          setError(res.error || 'Operation failed.');
          return;
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const api = useMemo(
    () => ({
      setPluginEnabled: (id: string, scope: ExtensionScopeRef, enabled: boolean) =>
        run(`${scope.id}:${id}`, () =>
          window.electronAPI.pluginsSetEnabled({ id, enabled, target: pluginTargetFor(scope) }),
        ),
      removePlugin: (id: string, scope: ExtensionScopeRef) =>
        run(`${scope.id}:${id}`, () =>
          window.electronAPI.pluginsUninstall({ id, target: pluginTargetFor(scope) }),
        ),
      installPlugin: (id: string, scope: ExtensionScopeRef) =>
        run(`${scope.id}:${id}`, () =>
          window.electronAPI.pluginsInstall({ id, target: pluginTargetFor(scope) }),
        ),
      // Fan-out installs: add one item to several scopes in one busy cycle (keyed
      // by `add:<id>`), reloading the overview once at the end.
      installPluginToScopes: (id: string, scopes: ExtensionScopeRef[]) =>
        run(`add:${id}`, async () => {
          for (const sc of scopes) {
            const r = await window.electronAPI.pluginsInstall({ id, target: pluginTargetFor(sc) });
            if (!r.success) return r;
          }
          return { success: true };
        }),
      installSkillToScopes: (ref: SkillRef, skillName: string, scopes: ExtensionScopeRef[]) =>
        run(`add:${skillName}`, async () => {
          for (const sc of scopes) {
            const r = await window.electronAPI.skillsInstall({
              ref,
              skillName,
              target: skillTargetFor(sc),
            });
            if (!r.success) return r;
          }
          return { success: true };
        }),
      addMarketplace: (
        source: string,
        opts?: { scope?: PluginScope; cwd?: string; sparse?: string[] },
      ) =>
        run(`mkt:${source}`, () =>
          window.electronAPI.pluginsAddMarketplace({
            source,
            scope: opts?.scope ?? 'user',
            cwd: opts?.cwd,
            sparse: opts?.sparse,
          }),
        ),
      removeMarketplace: (name: string) =>
        run(`mkt-rm:${name}`, () => window.electronAPI.pluginsRemoveMarketplace({ name })),
      setSkillVisibility: (
        skillName: string,
        scope: ExtensionScopeRef,
        visibility: SkillVisibility | null,
      ) =>
        run(`${scope.id}:${skillName}`, () =>
          window.electronAPI.extensionsSetSkillOverride({ scope, skillName, visibility }),
        ),
      removeSkill: (skillName: string, scope: ExtensionScopeRef) =>
        run(`${scope.id}:${skillName}`, () =>
          window.electronAPI.skillsUninstall({ skillName, target: skillTargetFor(scope) }),
        ),
      installSkill: (ref: SkillRef, skillName: string, scope: ExtensionScopeRef) =>
        run(`${scope.id}:${skillName}`, () =>
          window.electronAPI.skillsInstall({ ref, skillName, target: skillTargetFor(scope) }),
        ),
    }),
    [run],
  );

  return {
    overview,
    catalog,
    marketplaces,
    loading,
    busy,
    error,
    reload: load,
    detail,
    detailData,
    detailLoading,
    openDetail,
    closeDetail,
    loadPluginComponents,
    ...api,
  };
}
