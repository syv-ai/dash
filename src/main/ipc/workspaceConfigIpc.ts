import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { permissionModeSchema } from './schemas';
import {
  loadLocalTaskDefaults,
  loadSharedWorkspaceConfig,
  loadWorkspaceConfig,
  writeLocalTaskDefaults,
  writeWorkspaceConfig,
  type LocalTaskDefaults,
  type WorkspaceConfig,
} from '../services/WorkspaceConfigService';
import { GitService } from '../services/GitService';
import { LOCAL_CONFIG_EXCLUDE_ENTRY } from '../services/gitExclude';

const taskDefaultsSchema = z
  .object({
    baseRef: z.string().optional(),
    permissionMode: permissionModeSchema.optional(),
    useWorktree: z.boolean().optional(),
    contextPrompt: z.string().optional(),
    dashAccess: z.boolean().optional(),
  })
  .optional();

const configSchema = z.looseObject({
  taskDefaults: taskDefaultsSchema,
});

const localTaskDefaultsSchema = z.object({ extraArgs: z.string().optional() });

export function registerWorkspaceConfigIpc(): void {
  // `shared: true` reads config.json without the config.local.json overlay
  // (for editors that save back to config.json).
  ipcMain.handle(
    'workspaceConfig:read',
    (_event, projectPath: string, opts?: { shared?: boolean }) => {
      try {
        parseArgs('workspaceConfig:read', z.string(), projectPath);
        parseArgs(
          'workspaceConfig:read',
          z.object({ shared: z.boolean().optional() }).optional(),
          opts,
        );
        const load = opts?.shared ? loadSharedWorkspaceConfig : loadWorkspaceConfig;
        return { success: true, data: load(projectPath) };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  ipcMain.handle(
    'workspaceConfig:write',
    (_event, args: { projectPath: string; config: WorkspaceConfig }) => {
      try {
        parseArgs(
          'workspaceConfig:write',
          z.looseObject({ projectPath: z.string(), config: configSchema }),
          args,
        );
        writeWorkspaceConfig(args.projectPath, args.config);
        return { success: true };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  // The personal, local-only task defaults (`config.local.json`), alone.
  ipcMain.handle('workspaceConfig:readLocal', (_event, projectPath: string) => {
    try {
      parseArgs('workspaceConfig:readLocal', z.string(), projectPath);
      return { success: true, data: loadLocalTaskDefaults(projectPath) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle(
    'workspaceConfig:writeLocal',
    async (_event, args: { projectPath: string; defaults: LocalTaskDefaults }) => {
      try {
        parseArgs(
          'workspaceConfig:writeLocal',
          z.looseObject({ projectPath: z.string(), defaults: localTaskDefaultsSchema }),
          args,
        );
        writeLocalTaskDefaults(args.projectPath, args.defaults);
        // The file is the person's own: keep it out of git (best effort, a
        // folder that isn't a repository has nothing to commit it to).
        await GitService.ensureExcluded(args.projectPath, LOCAL_CONFIG_EXCLUDE_ENTRY).catch(
          () => {},
        );
        return { success: true };
      } catch (error) {
        return errorResponse(error);
      }
    },
  );
}
