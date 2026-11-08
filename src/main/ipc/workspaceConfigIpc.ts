import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { permissionModeSchema } from './schemas';
import {
  loadSharedWorkspaceConfig,
  loadWorkspaceConfig,
  writeWorkspaceConfig,
  type WorkspaceConfig,
} from '../services/WorkspaceConfigService';

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
  setup: z.array(z.string()).optional(),
  teardown: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  taskDefaults: taskDefaultsSchema,
});

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
}
