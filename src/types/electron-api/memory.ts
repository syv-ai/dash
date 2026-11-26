import type { IpcResponse, ProjectMemory } from '../../shared/types';

/** Claude Code auto-memory for a project; a memory's text is edited in the editor. */
export interface MemoryApi {
  memoryGet: (args: { projectPath: string }) => Promise<IpcResponse<ProjectMemory>>;
  memoryOpenDir: (args: { projectPath: string }) => Promise<IpcResponse<null>>;
  /** Move a memory (a file name in the folder) to the trash and drop its index lines. */
  memoryDelete: (args: { projectPath: string; file: string }) => Promise<IpcResponse<null>>;
  /** Each project's count of memories written since its memory was last seen, by project id. */
  memoryNewCounts: () => Promise<IpcResponse<Record<string, number>>>;
  /** The project's memory was looked at: its memories stop counting as new. */
  memoryMarkSeen: (args: { projectId: string }) => Promise<IpcResponse<null>>;
  /** A project's new-memory count changed (main watches every project's memory folder). */
  onMemoryNewCount: (callback: (data: { projectId: string; count: number }) => void) => () => void;
  /** Something in a project's memory folder changed (main watches every project's). */
  onMemoryChanged: (callback: (data: { projectId: string; dir: string }) => void) => () => void;
}
