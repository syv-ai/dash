import type { IpcResponse, ProjectMemory } from '../../shared/types';

/** Claude Code auto-memory for a project: read-only; edits go through the editor. */
export interface MemoryApi {
  memoryGet: (args: { projectPath: string }) => Promise<IpcResponse<ProjectMemory>>;
  memoryOpenDir: (args: { projectPath: string }) => Promise<IpcResponse<null>>;
}
