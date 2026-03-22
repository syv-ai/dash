import { ipcMain } from 'electron';
import { PixelAgentsService } from '../services/PixelAgentsService';
import type { PixelAgentsConfig } from '@shared/types';

export function registerPixelAgentsIpc(): void {
  ipcMain.handle('pixelAgents:getConfig', () => {
    try {
      return { success: true, data: PixelAgentsService.readConfig() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('pixelAgents:saveConfig', (_event, config: PixelAgentsConfig) => {
    try {
      const prev = PixelAgentsService.readConfig();
      PixelAgentsService.saveConfig(config);

      const hasEnabled = config.name && config.offices.some((o) => o.enabled);
      // Only restart when connection-relevant fields change (name, offices).
      // Phrases are picked up by the watcher's config hot-reload.
      const needsRestart =
        !prev ||
        prev.name !== config.name ||
        JSON.stringify(prev.offices) !== JSON.stringify(config.offices);

      if (!hasEnabled) {
        PixelAgentsService.stop();
      } else if (needsRestart) {
        PixelAgentsService.restart();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('pixelAgents:getStatus', () => {
    try {
      return { success: true, data: PixelAgentsService.getStatus() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('pixelAgents:start', () => {
    try {
      PixelAgentsService.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('pixelAgents:stop', () => {
    try {
      PixelAgentsService.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
