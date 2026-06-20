import type { IpcResponse } from '../../shared/types';
import type {
  ParsedSessionMessage,
  SessionMetrics,
  SessionUpdate,
} from '../../shared/sessionTypes';

/** Structured session view — watch a task's transcript and stream parsed messages. */
export interface SessionApi {
  sessionWatch: (args: { taskId: string; taskPath: string }) => Promise<IpcResponse<void>>;
  sessionUnwatch: (taskId: string) => Promise<IpcResponse<void>>;
  sessionGetMessages: (
    taskId: string,
  ) => Promise<IpcResponse<{ messages: ParsedSessionMessage[]; metrics: SessionMetrics } | null>>;
  onSessionUpdate: (callback: (data: SessionUpdate) => void) => () => void;
}
