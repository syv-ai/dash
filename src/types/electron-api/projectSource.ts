import type { IpcResponse } from '../../shared/types';
import type { PathFacts } from '../../shared/pathFacts';
import type {
  LocalTaskDefaults,
  WorkspaceConfig,
} from '../../main/services/WorkspaceConfigService';

/** Creating a project's source tree (clone / empty / agent-scaffold) and reading
 *  or writing its `.dash/config.json` workspace config. */
export interface ProjectSourceApi {
  // Workspace config (.dash/config.json)
  /** Merged config (config.json + config.local.json); `shared` reads config.json alone. */
  readWorkspaceConfig: (
    projectPath: string,
    opts?: { shared?: boolean },
  ) => Promise<IpcResponse<WorkspaceConfig | null>>;
  writeWorkspaceConfig: (args: {
    projectPath: string;
    config: WorkspaceConfig;
  }) => Promise<IpcResponse<void>>;
  /** `.dash/config.local.json`'s local-only task defaults alone (extra arguments). */
  readLocalTaskDefaults: (projectPath: string) => Promise<IpcResponse<LocalTaskDefaults>>;
  /** Set them, keeping the file's other keys; Dash keeps the file out of git. */
  writeLocalTaskDefaults: (args: {
    projectPath: string;
    defaults: LocalTaskDefaults;
  }) => Promise<IpcResponse<void>>;

  // Project sources (clone / empty / scaffold)
  /** What a typed path is on disk (`~` expanded), and the project it belongs to, if any. */
  projectInspectPath: (input: string) => Promise<IpcResponse<PathFacts>>;
  /** `parentDir` may start with `~`. */
  projectClone: (args: {
    url: string;
    parentDir: string;
  }) => Promise<IpcResponse<{ path: string; name: string }>>;
  projectCreateEmpty: (args: {
    parentDir: string;
    name: string;
    initGit: boolean;
  }) => Promise<IpcResponse<{ path: string; name: string }>>;
  projectListDir: (dir: string) => Promise<IpcResponse<string[]>>;
  scaffoldStart: (args: {
    sessionId: string;
    methodId: string;
    url: string;
    parentDir: string;
    cols: number;
    rows: number;
  }) => void;
  scaffoldInput: (args: { sessionId: string; data: string }) => void;
  scaffoldResize: (args: { sessionId: string; cols: number; rows: number }) => void;
  scaffoldKill: (args: { sessionId: string }) => void;
  onScaffoldData: (callback: (p: { sessionId: string; data: string }) => void) => () => void;
  onScaffoldExit: (
    callback: (p: { sessionId: string; exitCode: number; resultPath: string | null }) => void,
  ) => () => void;
}
