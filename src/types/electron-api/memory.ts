import type {
  IpcResponse,
  MemoryCreateResult,
  MemoryDeleteResult,
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
  /** Writes and indexes a new memory; resolves with the file it was saved as.
   *  `hook` is its MEMORY.md line's text: the description when left out. */
  memoryCreate: (
    args: { projectPath: string; hook?: string } & MemoryFields,
  ) => Promise<IpcResponse<MemoryCreateResult>>;
  /** Saves only if the file still has the expected mtime and size; otherwise `ok: false`.
   *  A save also brings the memory's MEMORY.md line in step (or adds one), and a
   *  rename moves other memories' `[[name]]` links to the new name. `hook`
   *  rewords the MEMORY.md line; left out, the line keeps the hook it has. */
  memoryUpdate: (
    args: {
      projectPath: string;
      file: string;
      expectedMtimeMs: number;
      expectedSizeBytes: number;
      hook?: string;
    } & MemoryFields,
  ) => Promise<IpcResponse<MemoryUpdateResult>>;
  /** Moves the memory to the OS trash and drops its MEMORY.md line. */
  memoryDelete: (args: {
    projectPath: string;
    file: string;
  }) => Promise<IpcResponse<MemoryDeleteResult>>;
  /** Drops MEMORY.md's lines for memories that no longer exist; resolves with their files. */
  memoryPrune: (args: { projectPath: string }) => Promise<IpcResponse<{ removed: string[] }>>;
  /** Fires with the watched project's path; returns an unsubscribe. */
  onMemoryChanged: (callback: (projectPath: string) => void) => () => void;
}
