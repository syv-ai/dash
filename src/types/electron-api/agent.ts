import type { IpcResponse } from '../../shared/types';
import type { TaskScratchpad } from '../../shared/agent';

/** The task sidebar's Agent tab: the task session's scratchpad. Each call names a task; main resolves its folder. */
export interface AgentApi {
  /** The task's scratchpad and its files; null when it has had no session. */
  agentScratchpad: (args: { taskId: string }) => Promise<IpcResponse<TaskScratchpad | null>>;
  /** Hear of changes to the task's scratchpad (its files, or a new session's folder) until unwatched. */
  agentWatchScratchpad: (args: { taskId: string }) => Promise<IpcResponse<null>>;
  agentUnwatchScratchpad: (args: { taskId: string }) => Promise<IpcResponse<null>>;
  onAgentScratchpadChanged: (callback: (data: { taskId: string }) => void) => () => void;
}
