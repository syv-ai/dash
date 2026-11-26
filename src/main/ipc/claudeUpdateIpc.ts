import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { claudeUpdateService } from '../services/ClaudeUpdateService';

/** A newer Claude Code than live task sessions run: read it, restart onto it. */
export function registerClaudeUpdateIpc(): void {
  ipcMain.handle('claudeUpdate:getState', () => ({
    success: true,
    data: claudeUpdateService.getState(),
  }));

  ipcMain.handle('claudeUpdate:restart', (_event, mode: unknown) => {
    try {
      claudeUpdateService.restart(
        parseArgs('claudeUpdate:restart', z.enum(['now', 'whenDone']), mode),
      );
      return { success: true };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('claudeUpdate:cancel', () => {
    claudeUpdateService.cancel();
    return { success: true };
  });
}
