import { ipcMain } from 'electron';
import { z } from 'zod';
import { IpcError, errorResponse, parseArgs } from './validate';
import { DatabaseService } from '../services/DatabaseService';
import { listSlashCommands } from '../services/SlashCommandService';

const argsSchema = z.object({ projectPath: z.string().min(1) });

/** The New task dialog's `/` menu: the slash commands and skills of one of Dash's projects. */
export function registerSlashCommandIpc(): void {
  ipcMain.handle('slashCommands:list', async (_event, raw: unknown) => {
    try {
      const { projectPath } = parseArgs('slashCommands:list', argsSchema, raw);
      if (!DatabaseService.getProjects().some((p) => p.path === projectPath)) {
        throw new IpcError(
          'Invalid IPC arguments for slashCommands:list: projectPath is not a Dash project',
          'VALIDATION',
        );
      }
      return { success: true, data: await listSlashCommands(projectPath) };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
