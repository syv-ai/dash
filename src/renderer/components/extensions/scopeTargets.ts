import type {
  ExtensionScopeRef,
  PluginInstallTarget,
  SkillInstallTarget,
} from '../../../shared/types';

/** ExtensionScopeRef → the existing PluginInstallTarget used by plugins:* IPC. */
export function pluginTargetFor(scope: ExtensionScopeRef): PluginInstallTarget {
  if (scope.kind === 'global') return { scope: 'user' };
  if (scope.kind === 'project') return { scope: 'project', cwd: scope.path };
  return { scope: 'local', cwd: scope.path };
}

/** ExtensionScopeRef → the existing SkillInstallTarget used by skills:* IPC. */
export function skillTargetFor(scope: ExtensionScopeRef): SkillInstallTarget {
  if (scope.kind === 'global') return { kind: 'global' };
  if (scope.kind === 'project') return { kind: 'project', projectPath: scope.path };
  return { kind: 'task', worktreePath: scope.path };
}

export interface ScopeTree {
  global: ExtensionScopeRef | null;
  projects: { project: ExtensionScopeRef; tasks: ExtensionScopeRef[] }[];
}

/** Group a flat scope list into Global + projects each with their nested tasks. */
export function buildScopeTree(scopes: ExtensionScopeRef[]): ScopeTree {
  const global = scopes.find((s) => s.kind === 'global') ?? null;
  const projects = scopes
    .filter((s) => s.kind === 'project')
    .map((project) => ({
      project,
      tasks: scopes.filter(
        (s) => s.kind === 'task' && s.projectId === project.id.replace(/^project:/, ''),
      ),
    }));
  return { global, projects };
}
