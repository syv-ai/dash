import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { AzureDevOpsService } from '../services/AzureDevOpsService';
import { ConnectionConfigService } from '../services/ConnectionConfigService';
import type { AzureDevOpsConfig } from '@shared/types';

const adoConfigSchema = z.looseObject({
  organizationUrl: z.string(),
  project: z.string(),
  pat: z.string(),
});

export function registerAzureDevOpsIpc(): void {
  ipcMain.handle('ado:check-configured', async (_event, args?: { projectId?: string }) => {
    try {
      parseArgs(
        'ado:check-configured',
        z.looseObject({ projectId: z.string().optional() }).optional(),
        args,
      );
      return { success: true, data: ConnectionConfigService.isAdoConfigured(args?.projectId) };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle('ado:test-connection', async (_event, args: AzureDevOpsConfig) => {
    try {
      parseArgs('ado:test-connection', adoConfigSchema, args);
      // A failure rejects with a message naming what to fix (PAT, project, network).
      await AzureDevOpsService.testConnection(args);
      return { success: true, data: true };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle(
    'ado:save-config',
    async (_event, args: { config: AzureDevOpsConfig; projectId?: string }) => {
      try {
        parseArgs(
          'ado:save-config',
          z.looseObject({ config: adoConfigSchema, projectId: z.string().optional() }),
          args,
        );
        ConnectionConfigService.saveAdoConfig(args.config, args.projectId);
        return { success: true };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  ipcMain.handle('ado:get-config', async (_event, args?: { projectId?: string }) => {
    try {
      parseArgs(
        'ado:get-config',
        z.looseObject({ projectId: z.string().optional() }).optional(),
        args,
      );
      const config = ConnectionConfigService.getAdoConfig(args?.projectId);
      return { success: true, data: config };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle('ado:remove-config', async (_event, args?: { projectId?: string }) => {
    try {
      parseArgs(
        'ado:remove-config',
        z.looseObject({ projectId: z.string().optional() }).optional(),
        args,
      );
      ConnectionConfigService.removeAdoConfig(args?.projectId);
      return { success: true };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle(
    'ado:search-work-items',
    async (_event, args: { query: string; projectId?: string }) => {
      try {
        parseArgs(
          'ado:search-work-items',
          z.looseObject({ query: z.string(), projectId: z.string().optional() }),
          args,
        );
        const config = ConnectionConfigService.getAdoConfig(args.projectId);
        if (!config) return { success: false, error: 'Azure DevOps not configured' };
        const items = await AzureDevOpsService.searchWorkItems(config, args.query);
        return { success: true, data: items };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );

  ipcMain.handle('ado:get-work-item', async (_event, args: { id: number; projectId?: string }) => {
    try {
      parseArgs(
        'ado:get-work-item',
        z.looseObject({ id: z.number(), projectId: z.string().optional() }),
        args,
      );
      const config = ConnectionConfigService.getAdoConfig(args.projectId);
      if (!config) return { success: false, error: 'Azure DevOps not configured' };
      const item = await AzureDevOpsService.getWorkItem(config, args.id);
      return { success: true, data: item };
    } catch (err) {
      return errorResponse(err);
    }
  });

  ipcMain.handle(
    'ado:post-branch-comment',
    async (_event, args: { workItemId: number; branch: string; projectId?: string }) => {
      try {
        parseArgs(
          'ado:post-branch-comment',
          z.looseObject({
            workItemId: z.number(),
            branch: z.string(),
            projectId: z.string().optional(),
          }),
          args,
        );
        const config = ConnectionConfigService.getAdoConfig(args.projectId);
        if (!config) return { success: false, error: 'Azure DevOps not configured' };
        await AzureDevOpsService.postBranchComment(config, args.workItemId, args.branch);
        return { success: true };
      } catch (err) {
        return errorResponse(err);
      }
    },
  );
}
