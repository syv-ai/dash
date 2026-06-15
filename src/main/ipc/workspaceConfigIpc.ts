import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import {
  loadWorkspaceConfig,
  writeWorkspaceConfig,
  type WorkspaceConfig,
} from '../services/WorkspaceConfigService';

const taskDefaultsSchema = z
  .object({
    baseRef: z.string().optional(),
    permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions']).optional(),
    useWorktree: z.boolean().optional(),
    contextPrompt: z.string().optional(),
  })
  .optional();

const configSchema = z.looseObject({
  setup: z.array(z.string()).optional(),
  teardown: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  taskDefaults: taskDefaultsSchema,
});

export function registerWorkspaceConfigIpc(): void {
  ipcMain.handle('workspaceConfig:read', (_event, projectPath: string) => {
    try {
      parseArgs('workspaceConfig:read', z.string(), projectPath);
      return { success: true, data: loadWorkspaceConfig(projectPath) };
    } catch (error) {
      return errorResponse(error);
    }
  });

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
