import { z } from 'zod';
import type { Project } from '../../../shared/types';
import type { WorkspaceTaskDefaults } from '../../services/WorkspaceConfigService';
import { defineCapability, type Registry } from '../registry';

export interface ProjectCapabilityDeps {
  getProjects(): Project[];
  /** The project's `.dash` task defaults (shared + local overlay), if any. */
  taskDefaults(projectPath: string): WorkspaceTaskDefaults | undefined;
}

/**
 * The base ref a new-branch task starts from when the caller names none: the
 * project's `taskDefaults.baseRef` (what the task dialog preselects), then the
 * project's base ref. Null leaves it to git (the remote's HEAD branch).
 */
export function defaultBaseRef(
  project: Project,
  defaults: WorkspaceTaskDefaults | undefined,
): string | null {
  return defaults?.baseRef || project.baseRef || null;
}

export function registerProjectCapabilities(registry: Registry, deps: ProjectCapabilityDeps): void {
  registry.register(
    defineCapability({
      name: 'projects.list',
      summary:
        'List the projects open in Dash. Returns each project id, name, path, the base ref new tasks branch from by default, and whether new tasks get Dash access by default.',
      input: z.object({}),
      callers: ['orchestrator'],
      readOnly: true,
      handler: async (ctx) =>
        deps
          .getProjects()
          .filter((p) => ctx.scope.visibleProjectIds.has(p.id))
          .map((p) => {
            const defaults = deps.taskDefaults(p.path);
            return {
              id: p.id,
              name: p.name,
              path: p.path,
              defaultBaseRef: defaultBaseRef(p, defaults),
              dashAccessDefault: defaults?.dashAccess ?? false,
            };
          }),
    }),
  );
}
