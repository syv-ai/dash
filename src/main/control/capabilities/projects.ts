import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { Project } from '../../../shared/types';
import type { WorkspaceTaskDefaults } from '../../services/WorkspaceConfigService';
import type { GitDetection } from '../../services/GitService';
import { ControlError, defineCapability, type Registry } from '../registry';
import { projectAtPath, realPath } from '../projectPaths';

export interface ProjectCapabilityDeps {
  getProjects(): Project[];
  /** The project's `.dash` task defaults (shared + local overlay), if any. */
  taskDefaults(projectPath: string): WorkspaceTaskDefaults | undefined;
  /** A folder's git, as the New Project wizard detects it. */
  detectGit(folderPath: string): Promise<GitDetection>;
  /** The main checkout of the repository `dir` is in, or null (projectPaths.ts). */
  mainCheckout(dir: string): string | null;
  /** Save a new project row and tell Dash's windows. */
  addProject(
    input: Omit<Project, 'id' | 'baseRef' | 'archivedAt' | 'createdAt' | 'updatedAt'>,
  ): Project;
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

/** A project as `projects list` and `projects add` give it. */
function projectEntry(p: Project, deps: ProjectCapabilityDeps) {
  const defaults = deps.taskDefaults(p.path);
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    defaultBaseRef: defaultBaseRef(p, defaults),
    dashAccessDefault: defaults?.dashAccess ?? false,
  };
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
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
          .map((p) => projectEntry(p, deps)),
    }),
  );

  registry.register(
    defineCapability({
      name: 'projects.add',
      summary:
        'Open a folder on this machine as a Dash project, named after the folder, with no .dash config written. Returns the project as projects list gives it, and added: false when the folder already was one. Refuses a folder inside a project or a worktree of one.',
      input: z.object({
        path: z
          .string()
          .min(1)
          .describe("The folder; a relative path is from dashctl's working directory"),
      }),
      callers: ['orchestrator'],
      readOnly: false,
      cli: { args: ['path'], paths: ['path'] },
      handler: async (_ctx, input) => {
        if (!path.isAbsolute(input.path)) {
          throw new ControlError(400, `path must be absolute: ${input.path}`);
        }
        if (!isDirectory(input.path)) throw new ControlError(400, `no folder at ${input.path}`);
        const folder = realPath(input.path);
        const projects = deps.getProjects();
        const owner = projectAtPath(projects, folder, deps.mainCheckout);
        if (owner) {
          const root = realPath(owner.path);
          const name = JSON.stringify(owner.name);
          const archived = owner.archivedAt != null;
          if (root === folder) {
            if (!archived) return { project: projectEntry(owner, deps), added: false };
            throw new ControlError(
              409,
              `${folder} is the archived project ${name}; restore it in Dash`,
            );
          }
          const how = folder.startsWith(root + path.sep) ? 'inside' : 'a worktree of';
          throw new ControlError(
            409,
            `${folder} is ${how} the ${archived ? 'archived ' : ''}project ${name} (${owner.id})`,
          );
        }
        const git = await deps.detectGit(folder);
        const project = deps.addProject({
          name: path.basename(folder),
          path: folder,
          isGitRepo: git.isGitRepo,
          gitRemote: git.remote,
          gitBranch: git.branch,
        });
        return { project: projectEntry(project, deps), added: true };
      },
    }),
  );
}
