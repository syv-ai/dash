import { ipcMain, type BrowserWindow } from 'electron';
import { getTuiHost } from '../tui/hostInstance';
import { getFeature, type RequestStartPayload } from '../tui/featureRegistry';
import { DatabaseService } from '../services/DatabaseService';
import { initDrawerTabsService } from './drawerTabsIpc';

export function registerTuiIpc(opts: { getMainWindow: () => BrowserWindow | null }): void {
  ipcMain.handle(
    'tui:requestStart',
    async (_e, payload: RequestStartPayload & { featureId: string }) => {
      const { featureId, taskId, projectId } = payload;
      const feature = getFeature(featureId);
      if (!feature) {
        return { success: false as const, error: `unknown TUI feature: ${featureId}` };
      }
      if (DatabaseService.isFeatureDismissed(projectId, featureId)) {
        return {
          success: true as const,
          data: { started: false as const, reason: 'dismissed' as const },
        };
      }
      const host = getTuiHost();
      if (host.isActive(featureId, taskId)) {
        return {
          success: true as const,
          data: { started: false as const, reason: 'already-active' as const },
        };
      }
      try {
        const { tabId } = await host.spawn(feature.buildSpawn(payload, opts.getMainWindow));
        return { success: true as const, data: { started: true as const, tabId } };
      } catch (err) {
        console.error('[tuiIpc] requestStart failed for', featureId, taskId, err);
        return {
          success: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle('tui:isActive', (_e, q: { featureId: string; taskId: string }) => ({
    success: true as const,
    data: getTuiHost().isActive(q.featureId, q.taskId),
  }));
}

/**
 * Clean up TUI state left behind by the previous run: orphaned socket files
 * and drawer_tabs rows with kind='tui' (their owning flow + side-car are
 * gone; the row would otherwise collide with the next requestStart INSERT).
 */
export function cleanupTuiAtBoot(): void {
  getTuiHost().sweepSockets();
  try {
    initDrawerTabsService().sweepTuiTabs();
  } catch (err) {
    console.warn('[tuiIpc] sweepTuiTabs failed:', err);
  }
}
