import { ipcMain } from 'electron';
import { AzureDevOpsService } from '../services/AzureDevOpsService';
import { ConnectionConfigService } from '../services/ConnectionConfigService';
import type { AzureDevOpsConfig } from '@shared/types';

export function registerAzureDevOpsIpc(): void {
  ipcMain.handle('ado:check-configured', async (_event, args?: { projectId?: string }) => {
    try {
      return { success: true, data: ConnectionConfigService.isAdoConfigured(args?.projectId) };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ado:test-connection', async (_event, args: AzureDevOpsConfig) => {
    try {
      const ok = await AzureDevOpsService.testConnection(args);
      return { success: true, data: ok };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(
    'ado:save-config',
    async (_event, args: { config: AzureDevOpsConfig; projectId?: string }) => {
      try {
        ConnectionConfigService.saveAdoConfig(args.config, args.projectId);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  ipcMain.handle('ado:get-config', async (_event, args?: { projectId?: string }) => {
    try {
      const config = ConnectionConfigService.getAdoConfig(args?.projectId);
      return { success: true, data: config };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ado:remove-config', async (_event, args?: { projectId?: string }) => {
    try {
      ConnectionConfigService.removeAdoConfig(args?.projectId);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(
    'ado:search-work-items',
    async (_event, args: { query: string; projectId?: string }) => {
      try {
        const config = ConnectionConfigService.getAdoConfig(args.projectId);
        if (!config) return { success: false, error: 'Azure DevOps not configured' };
        const items = await AzureDevOpsService.searchWorkItems(config, args.query);
        return { success: true, data: items };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  ipcMain.handle('ado:get-work-item', async (_event, args: { id: number; projectId?: string }) => {
    try {
      const config = ConnectionConfigService.getAdoConfig(args.projectId);
      if (!config) return { success: false, error: 'Azure DevOps not configured' };
      const item = await AzureDevOpsService.getWorkItem(config, args.id);
      return { success: true, data: item };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(
    'ado:post-branch-comment',
    async (_event, args: { workItemId: number; branch: string; projectId?: string }) => {
      try {
        const config = ConnectionConfigService.getAdoConfig(args.projectId);
        if (!config) return { success: false, error: 'Azure DevOps not configured' };
        await AzureDevOpsService.postBranchComment(config, args.workItemId, args.branch);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );
}
