import { ipcMain, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { parseArgs } from './validate';
import { getTuiHost } from '../tui/hostInstance';
import { getWizard, type RequestStartPayload } from '../wizard/wizardRegistry';
import { DatabaseService } from '../services/DatabaseService';
import { initDrawerTabsService } from './drawerTabsIpc';

export function registerWizardIpc(opts: { getMainWindow: () => BrowserWindow | null }): void {
  ipcMain.handle(
    'wizard:requestStart',
    async (_e, payload: RequestStartPayload & { featureId: string }) => {
      parseArgs(
        'wizard:requestStart',
        z.looseObject({
          featureId: z.string(),
          taskId: z.string(),
          projectId: z.string(),
          taskName: z.string(),
          projectName: z.string(),
          cwd: z.string(),
          cols: z.number(),
          rows: z.number(),
        }),
        payload,
      );
      const { featureId, taskId, projectId } = payload;
      const wizard = getWizard(featureId);
      if (!wizard) {
        return { success: false as const, error: `unknown wizard feature: ${featureId}` };
      }
      // A freshly reloaded renderer can request before the reload teardown
      // finishes — wait so isActive doesn't report a wizard that's mid-death.
      await getTuiHost().reloadSettled();
      if (DatabaseService.isFeatureDismissed(projectId, featureId)) {
        return {
          success: true as const,
          data: { started: false as const, reason: 'dismissed' as const },
        };
      }
      if (wizard.isRelevant && !wizard.isRelevant(payload)) {
        return {
          success: true as const,
          data: { started: false as const, reason: 'not-relevant' as const },
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
        const { tabId } = await host.spawn(wizard.buildSpawn(payload, opts.getMainWindow));
        return { success: true as const, data: { started: true as const, tabId } };
      } catch (err) {
        console.error('[wizardIpc] requestStart failed for', featureId, taskId, err);
        return {
          success: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle('wizard:active', async (_e, q: { featureId: string; taskId: string }) => {
    parseArgs('wizard:active', z.looseObject({ featureId: z.string(), taskId: z.string() }), q);
    await getTuiHost().reloadSettled();
    return {
      success: true as const,
      data: getTuiHost().isActive(q.featureId, q.taskId),
    };
  });
}

/**
 * Clean up wizard state left behind by the previous run: orphaned socket files
 * and drawer_tabs rows with kind='tui'/'service' (their owning wizard + side-car
 * are gone; the row would otherwise collide with the next requestStart INSERT).
 */
export function cleanupWizardsAtBoot(): void {
  getTuiHost().sweepSockets();
  try {
    initDrawerTabsService().sweepEphemeralTabs();
  } catch (err) {
    console.warn('[wizardIpc] sweepEphemeralTabs failed:', err);
  }
}
