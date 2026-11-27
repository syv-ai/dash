import type { IpcResponse } from '../../shared/types';
import type { AgentDefinition, SlashCommand } from '../../shared/slashCommands';

/** The slash commands and skills a project's sessions can run (the New task dialog's `/` menu). */
export interface SlashCommandApi {
  slashCommandsList: (args: { projectPath: string }) => Promise<IpcResponse<SlashCommand[]>>;
  /** The custom agents a session can run as (`--agent`): the New task dialog's Agent picker.
   *  `extraArgs`: the task's, whose `--plugin-dir` plugins are listed too. */
  agentsList: (args: {
    projectPath: string;
    extraArgs?: string;
  }) => Promise<IpcResponse<AgentDefinition[]>>;
}
