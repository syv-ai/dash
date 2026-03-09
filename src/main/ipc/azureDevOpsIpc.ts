import { ipcMain } from 'electron';
import { AzureDevOpsService } from '../services/AzureDevOpsService';
import { ConfigService } from '../services/ConfigService';
import type { AzureDevOpsConfig } from '@shared/types';

export function registerAzureDevOpsIpc(): void {
  ipcMain.handle('ado:check-configured', async () => {
    try {
      return { success: true, data: ConfigService.isAdoConfigured() };
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

  ipcMain.handle('ado:save-config', async (_event, args: AzureDevOpsConfig) => {
    try {
      ConfigService.saveAdoConfig(args);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ado:get-config', async () => {
    try {
      const config = ConfigService.getAdoConfig();
      return { success: true, data: config };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ado:remove-config', async () => {
    try {
      ConfigService.removeAdoConfig();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ado:search-work-items', async (_event, args: { query: string }) => {
    try {
      const config = ConfigService.getAdoConfig();
      console.log(
        '[ADO search] config:',
        config
          ? `${config.organizationUrl} / ${config.project} (PAT length: ${config.pat.length})`
          : 'null',
      );
      if (!config) return { success: false, error: 'Azure DevOps not configured' };
      const items = await AzureDevOpsService.searchWorkItems(config, args.query);
      console.log('[ADO search] query:', JSON.stringify(args.query), '→ results:', items.length);
      return { success: true, data: items };
    } catch (err) {
      console.error('[ADO search] error:', err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('ado:get-work-item', async (_event, args: { id: number }) => {
    try {
      const config = ConfigService.getAdoConfig();
      if (!config) return { success: false, error: 'Azure DevOps not configured' };
      const item = await AzureDevOpsService.getWorkItem(config, args.id);
      return { success: true, data: item };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(
    'ado:post-branch-comment',
    async (_event, args: { workItemId: number; branch: string }) => {
      try {
        const config = ConfigService.getAdoConfig();
        if (!config) return { success: false, error: 'Azure DevOps not configured' };
        await AzureDevOpsService.postBranchComment(config, args.workItemId, args.branch);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );
}
