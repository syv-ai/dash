import type {
  IpcResponse,
  TaskPort,
  PortLiveness,
  PortLivenessUpdate,
  PortHeuristicResult,
} from '../../shared/types';
import type { PortsMainToTui, PortsTuiToMain } from '../../shared/portsTuiProtocol';

/** Workspace ports: the TUI wizard that records them, liveness polling, and the
 *  agent-recorded service run/stop/logs commands. */
export interface PortsApi {
  // Ports TUI lifecycle (wizard that authors .dash/ports.json)
  ptyStartCommand: (opts: {
    id: string;
    command: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env?: Record<string, string>;
    taskId: string;
    featureId: string;
  }) => Promise<IpcResponse<{ reattached: boolean }>>;
  requestWizard: (payload: {
    featureId: string;
    taskId: string;
    projectId: string;
    taskName: string;
    projectName: string;
    cwd: string;
    /** User explicitly picked the wizard — bypass the dismissed/relevance gates. */
    force?: boolean;
  }) => Promise<IpcResponse<{ started: boolean; reason?: string }>>;
  wizardActive: (q: { featureId: string; taskId: string }) => Promise<IpcResponse<boolean>>;
  wizardCompleted: (q: { featureId: string; cwd: string }) => Promise<IpcResponse<boolean>>;
  onPortsRestartTask: (cb: (taskId: string) => void) => () => void;
  onPortsTuiMigrated: (
    cb: (info: { fromTaskId: string; toTaskId: string; projectId: string }) => void,
  ) => () => void;
  /** Wizard toast channel: main pushes screen state, renderer sends choices back. */
  wizardMessage: (p: { featureId: string; taskId: string; msg: PortsTuiToMain }) => void;
  onWizardShow: (
    cb: (data: { featureId: string; taskId: string; msg: PortsMainToTui }) => void,
  ) => () => void;
  onWizardDismiss: (cb: (data: { featureId: string; taskId: string }) => void) => () => void;

  // Workspace ports + services
  portsList: (taskId: string) => Promise<IpcResponse<TaskPort[]>>;
  portsRefresh: (taskId: string) => Promise<IpcResponse<TaskPort[]>>;
  portsLivenessGet: (taskId: string) => Promise<IpcResponse<Record<number, PortLiveness>>>;
  portsUnwatch: (taskId: string) => Promise<IpcResponse<void>>;
  portsOpenUrl: (port: number) => Promise<IpcResponse<void>>;
  portsDetect: (taskId: string) => Promise<IpcResponse<PortHeuristicResult>>;
  portsWatchConfig: (taskId: string) => Promise<IpcResponse<void>>;
  portsServiceStart: (taskId: string, port: TaskPort) => Promise<IpcResponse<void>>;
  portsServiceStop: (taskId: string, port: TaskPort) => Promise<IpcResponse<void>>;
  portsServiceLogs: (taskId: string, port: TaskPort) => Promise<IpcResponse<void>>;
  portsServiceStartAll: (
    taskId: string,
  ) => Promise<IpcResponse<{ started: string[]; failed: string[] }>>;
  portsServiceStopAll: (
    taskId: string,
  ) => Promise<IpcResponse<{ stopped: string[]; failed: string[] }>>;
  portsServiceStatus: (
    taskId: string,
  ) => Promise<IpcResponse<Record<string, { ownedTabId: string | null }>>>;
  portsServiceReleaseTab: (taskId: string, tabId: string) => Promise<IpcResponse<void>>;
  onPortsServiceChanged: (cb: (data: { taskId: string }) => void) => () => void;
  onPortsServiceFocusTab: (
    cb: (data: { taskId: string; tabId: string; reset: boolean }) => void,
  ) => () => void;
  onPortsLiveness: (callback: (update: PortLivenessUpdate) => void) => () => void;
  onPortsConfigChanged: (callback: (data: { taskId: string }) => void) => () => void;
}
