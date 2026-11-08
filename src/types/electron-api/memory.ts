import type { IpcResponse, ProjectMemory } from '../../shared/types';

/** Claude Code auto-memory for a project: read-only; edits go through the editor. */
export interface MemoryApi {
  memoryGet: (args: { projectPath: string }) => Promise<IpcResponse<ProjectMemory>>;
  memoryOpenDir: (args: { projectPath: string }) => Promise<IpcResponse<null>>;
  /** Each project's count of memories written since its memory was last seen, by project id. */
  memoryNewCounts: () => Promise<IpcResponse<Record<string, number>>>;
  /** The memory modal opened on the project: its memories stop counting as new. */
  memoryMarkSeen: (args: { projectPath: string }) => Promise<IpcResponse<null>>;
  /** A project's new-memory count changed (main watches every project's memory folder). */
  onMemoryNewCount: (callback: (data: { projectId: string; count: number }) => void) => () => void;
}
