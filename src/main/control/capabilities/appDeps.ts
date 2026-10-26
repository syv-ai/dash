import { DatabaseService } from '../../services/DatabaseService';
import { TaskService } from '../../services/TaskService';
import { activityMonitor, activityEvents } from '../../services/ActivityMonitor';
import { supervisorService } from '../../services/SupervisorService';
import { worktreeService } from '../../services/WorktreeService';
import { loadWorkspaceConfig } from '../../services/WorkspaceConfigService';
import { claudeDefaultPermissionMode } from '../../services/claudeSettings';
import { taskEvents } from '../../services/taskEvents';
import { focusTaskInWindow } from '../../services/focusTask';
import {
  getUntrustedRoot,
  recheckWorkspaceTrust,
  restartAndStartTaskSession,
  startTaskSession,
} from '../../services/ptyManager';
import { readLiveSessions } from '../../services/claudeSessionRegistry';
import { GitService } from '../../services/GitService';
import { WorkspacePortsRuntime } from '../../services/WorkspacePortsRuntime';
import { portLivenessService } from '../../services/PortLivenessService';
import { getServiceRunner } from '../../ipc/servicesIpc';
import { ControlError } from '../registry';
import type { ProjectCapabilityDeps } from './projects';
import type { ServiceCapabilityDeps } from './services';
import type { TaskCapabilityDeps } from './tasks';
import type { ReviewCapabilityDeps } from './review';
import { taskReviews } from '../../services/prReview/taskReview';
import { prProviderFor } from '../../services/prReview/resolve';

/**
 * The capabilities' real dependencies: the app's services. Kept apart from the
 * capability modules so their tests run on fakes without electron.
 */

function taskDefaults(projectPath: string) {
  try {
    return loadWorkspaceConfig(projectPath)?.taskDefaults;
  } catch (err) {
    console.warn('[control] could not read the project task defaults:', err);
    return undefined;
  }
}

export function projectDeps(): ProjectCapabilityDeps {
  return { getProjects: () => DatabaseService.getProjects(), taskDefaults };
}

export function taskDeps(): TaskCapabilityDeps {
  return {
    getProjects: () => DatabaseService.getProjects(),
    getTask: (id) => DatabaseService.getTask(id),
    getTasks: (projectId) => DatabaseService.getTasks(projectId),
    getActivity: () => activityMonitor.getAll(),
    getUntrustedRoot,
    getLiveSessions: () => readLiveSessions(),
    onActivityChange: (listener) => {
      activityEvents.on('change', listener);
      return () => activityEvents.off('change', listener);
    },
    taskDefaults,
    claudeDefaultPermissionMode,
    resolveBaseRef: (projectPath) => worktreeService.resolveBaseRef(projectPath),
    currentBranch: (projectPath) => GitService.getBranch(projectPath),
    branchExists: (projectPath, branch) => GitService.branchExists(projectPath, branch),
    recheckTrust: recheckWorkspaceTrust,
    createTask: (input, opts) => TaskService.create(input, opts),
    archiveTask: (id) => TaskService.archive(id),
    restoreTask: (id) => TaskService.restore(id),
    deleteTask: (id, opts) => TaskService.delete(id, opts),
    restartSession: restartAndStartTaskSession,
    startSession: (id) => startTaskSession(id),
    readLogs: (jobId) => supervisorService.logs(jobId),
    openTask: (task) => {
      // Reload the project's list first, so a task nobody opened yet is there.
      taskEvents.emitChanged(task.projectId);
      if (!focusTaskInWindow({ taskId: task.id, projectId: task.projectId })) {
        throw new ControlError(409, 'Dash has no window open');
      }
    },
  };
}

/** How long one `services list` keeps the task's ports probed (each call renews it). */
const LIVENESS_LEASE_MS = 60_000;

export function serviceDeps(): ServiceCapabilityDeps {
  return {
    getTask: (id) => DatabaseService.getTask(id),
    getPorts: (taskId) => WorkspacePortsRuntime.getPortsForTask(taskId),
    watchLiveness: (taskId, hostPorts) =>
      portLivenessService.leaseTask(taskId, hostPorts, LIVENESS_LEASE_MS),
    getLiveness: (taskId) => portLivenessService.getStates(taskId),
    // The same runner the drawer uses, so a service started here shows there.
    runner: getServiceRunner(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function reviewDeps(): ReviewCapabilityDeps {
  return {
    providerFor: (projectId) =>
      prProviderFor(
        DatabaseService.getProjects().find((p) => p.id === projectId) ?? { gitRemote: null },
      ),
    getTask: (id) => DatabaseService.getTask(id),
    // Read per call, so a database that failed to open fails the call, not the API's start.
    get reviews() {
      return taskReviews();
    },
  };
}
