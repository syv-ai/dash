import type { IpcResponse } from '../../shared/types';
import type { SlashCommand } from '../../shared/slashCommands';

/** The slash commands and skills a project's sessions can run (the New task dialog's `/` menu). */
export interface SlashCommandApi {
  slashCommandsList: (args: { projectPath: string }) => Promise<IpcResponse<SlashCommand[]>>;
}
