import { ipcMain } from 'electron';
import { z } from 'zod';
import { IpcError, errorResponse, parseArgs } from './validate';
import { DatabaseService } from '../services/DatabaseService';
import { listAgents, listSlashCommands } from '../services/SlashCommandService';

const argsSchema = z.object({ projectPath: z.string().min(1) });

/** A Dash project's path from the args, or an IpcError. */
function projectPathArg(channel: string, raw: unknown): string {
  const { projectPath } = parseArgs(channel, argsSchema, raw);
  if (!DatabaseService.getProjects().some((p) => p.path === projectPath)) {
    throw new IpcError(
      `Invalid IPC arguments for ${channel}: projectPath is not a Dash project`,
      'VALIDATION',
    );
  }
  return projectPath;
}

/** The New task dialog's `/` menu and Agent picker: what one of Dash's projects' sessions can use. */
export function registerSlashCommandIpc(): void {
  ipcMain.handle('slashCommands:list', async (_event, raw: unknown) => {
    try {
      return {
        success: true,
        data: await listSlashCommands(projectPathArg('slashCommands:list', raw)),
      };
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('agents:list', async (_event, raw: unknown) => {
    try {
      return { success: true, data: await listAgents(projectPathArg('agents:list', raw)) };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
