import { ipcMain } from 'electron';
import { parseArgs, errorResponse } from './validate';
import { getAddonHost } from '../addonHost/registry';
import {
  actionSchema,
  setEnabledSchema,
  surfacesSchema,
  terminalClosedSchema,
} from './addonsSchemas';

export function registerAddonsIpc(): void {
  ipcMain.handle('addons:list', () => {
    try {
      return { success: true, data: getAddonHost().list() };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('addons:setEnabled', async (_event, args: unknown) => {
    try {
      const { id, enabled } = parseArgs('addons:setEnabled', setEnabledSchema, args);
      await getAddonHost().setEnabled(id, enabled);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('addons:surfaces', (_event, args: unknown) => {
    try {
      const { taskId } = parseArgs('addons:surfaces', surfacesSchema, args);
      return { success: true, data: getAddonHost().surfacesFor(taskId) };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('addons:action', async (_event, args: unknown) => {
    try {
      const { addonId, ref, actionId } = parseArgs('addons:action', actionSchema, args);
      await getAddonHost().action(addonId, ref, actionId);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('addons:terminalClosed', (_event, args: unknown) => {
    try {
      const { tabId } = parseArgs('addons:terminalClosed', terminalClosedSchema, args);
      getAddonHost().terminalClosed(tabId);
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
