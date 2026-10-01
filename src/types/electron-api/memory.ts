import type {
  IpcResponse,
  MemoryFields,
  MemoryUpdateResult,
  ProjectMemory,
} from '../../shared/types';

/** Claude Code auto-memory for a project. */
export interface MemoryApi {
  memoryGet: (args: { projectPath: string }) => Promise<IpcResponse<ProjectMemory>>;
  memoryWatch: (args: { projectPath: string }) => Promise<IpcResponse<null>>;
  memoryUnwatch: () => Promise<IpcResponse<null>>;
  memoryOpenDir: (args: { projectPath: string }) => Promise<IpcResponse<null>>;
  /** Writes and indexes a new memory; resolves with the file it was saved as. */
  memoryCreate: (
    args: { projectPath: string } & MemoryFields,
  ) => Promise<IpcResponse<{ file: string }>>;
  /** Saves only if the file still has the expected mtime and size; otherwise `ok: false`.
   *  A save also brings the memory's MEMORY.md line in step (or adds one), and a
   *  rename moves other memories' `[[name]]` links to the new name. */
  memoryUpdate: (
    args: {
      projectPath: string;
      file: string;
      expectedMtimeMs: number;
      expectedSizeBytes: number;
    } & MemoryFields,
  ) => Promise<IpcResponse<MemoryUpdateResult>>;
  /** Moves the memory to the OS trash and drops its MEMORY.md line. */
  memoryDelete: (args: { projectPath: string; file: string }) => Promise<IpcResponse<null>>;
  /** Fires with the watched project's path; returns an unsubscribe. */
  onMemoryChanged: (callback: (projectPath: string) => void) => () => void;
}
