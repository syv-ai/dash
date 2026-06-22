import { ipcMain, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { getTuiHost } from '../tui/hostInstance';
import { getWizard, type RequestStartPayload } from '../wizard/wizardRegistry';
import { decideWizardStart } from '../wizard/decideWizardStart';
import { DatabaseService } from '../services/DatabaseService';
import { initDrawerTabsService } from './drawerTabsIpc';

export function registerWizardIpc(opts: { getMainWindow: () => BrowserWindow | null }): void {
  ipcMain.handle(
    'wizard:requestStart',
    async (_e, payload: RequestStartPayload & { featureId: string; force?: boolean }) => {
      parseArgs(
        'wizard:requestStart',
        z.looseObject({
          featureId: z.string(),
          taskId: z.string(),
          projectId: z.string(),
          taskName: z.string(),
          projectName: z.string(),
          cwd: z.string(),
          force: z.boolean().optional(),
        }),
        payload,
      );
      const { featureId, taskId, projectId, force } = payload;
      const wizard = getWizard(featureId);
      if (!wizard) {
        return { success: false as const, error: `unknown wizard feature: ${featureId}` };
      }
      // A freshly reloaded renderer can request before the reload teardown
      // finishes — wait so isActive doesn't report a wizard that's mid-death.
      await getTuiHost().reloadSettled();
      const host = getTuiHost();
      const engagement = host.isLive(featureId, taskId)
        ? 'live'
        : host.isActive(featureId, taskId)
          ? 'suppressed'
          : 'none';
      const decision = decideWizardStart({
        dismissed: DatabaseService.isFeatureDismissed(projectId, featureId),
        relevant: !wizard.isRelevant || wizard.isRelevant(payload),
        engagement,
        force,
      });
      if (!decision.start) {
        return {
          success: true as const,
          data: { started: false as const, reason: decision.reason },
        };
      }
      try {
        await host.spawn(wizard.buildSpawn(payload, opts.getMainWindow));
        return { success: true as const, data: { started: true as const } };
      } catch (err) {
        console.error('[wizardIpc] requestStart failed for', featureId, taskId, err);
        return errorResponse(err);
      }
    },
  );

  // The renderer's toast controller sends user choices (and exit/close) back
  // here; route them into the matching wizard's channel.
  ipcMain.on('wizard:message', (_e, p: { featureId: string; taskId: string; msg: unknown }) => {
    getTuiHost().routeMessage(p.featureId, p.taskId, p.msg);
  });

  ipcMain.handle('wizard:active', async (_e, q: { featureId: string; taskId: string }) => {
    parseArgs('wizard:active', z.looseObject({ featureId: z.string(), taskId: z.string() }), q);
    await getTuiHost().reloadSettled();
    return {
      success: true as const,
      data: getTuiHost().isActive(q.featureId, q.taskId),
    };
  });

  ipcMain.handle('wizard:completed', async (_e, q: { featureId: string; cwd: string }) => {
    parseArgs('wizard:completed', z.looseObject({ featureId: z.string(), cwd: z.string() }), q);
    const wizard = getWizard(q.featureId);
    return {
      success: true as const,
      data: wizard?.isComplete?.(q.cwd) ?? false,
    };
  });
}

/**
 * Clean up wizard state left behind by the previous run: drawer_tabs rows with
 * kind='service' whose owning runner is gone (the row would otherwise collide
 * with the next add INSERT).
 */
export function cleanupWizardsAtBoot(): void {
  try {
    initDrawerTabsService().sweepEphemeralTabs();
  } catch (err) {
    console.warn('[wizardIpc] sweepEphemeralTabs failed:', err);
  }
}
