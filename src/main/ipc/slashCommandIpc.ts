import { ipcMain } from 'electron';
import { z } from 'zod';
import { IpcError, errorResponse, parseArgs } from './validate';
import { DatabaseService } from '../services/DatabaseService';
import { listAgents, listSlashCommands } from '../services/SlashCommandService';
import { pluginDirsOf } from '@shared/pluginDirs';

const argsSchema = z.object({ projectPath: z.string().min(1) });
const agentsArgsSchema = argsSchema.extend({ extraArgs: z.string().optional() });

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

  // `extraArgs`: the new task's (the project's default), whose --plugin-dir
  // plugins it can run agents of too.
  ipcMain.handle('agents:list', async (_event, raw: unknown) => {
    try {
      const projectPath = projectPathArg('agents:list', raw);
      const { extraArgs } = parseArgs('agents:list', agentsArgsSchema, raw);
      return { success: true, data: await listAgents(projectPath, pluginDirsOf(extraArgs)) };
    } catch (error) {
      return errorResponse(error);
    }
  });
}
