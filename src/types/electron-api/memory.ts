import type { IpcResponse, ProjectMemory } from '../../shared/types';

/** Claude Code auto-memory for a project (read-only). */
export interface MemoryApi {
  memoryGet: (args: { projectPath: string }) => Promise<IpcResponse<ProjectMemory>>;
  memoryWatch: (args: { projectPath: string }) => Promise<IpcResponse<null>>;
  memoryUnwatch: () => Promise<IpcResponse<null>>;
  memoryOpenDir: (args: { projectPath: string }) => Promise<IpcResponse<null>>;
  /** Fires with the watched project's path; returns an unsubscribe. */
  onMemoryChanged: (callback: (projectPath: string) => void) => () => void;
}
