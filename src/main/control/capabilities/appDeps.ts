import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../../services/DatabaseService';
import { TaskService } from '../../services/TaskService';
import { activityMonitor, activityEvents } from '../../services/ActivityMonitor';
import { supervisorService } from '../../services/SupervisorService';
import { worktreeService } from '../../services/WorktreeService';
import { loadWorkspaceConfig } from '../../services/WorkspaceConfigService';
import { taskEvents } from '../../services/taskEvents';
import { broadcastProjectsChanged } from '../../services/projectEvents';
import { syncProjectMemoryWatches } from '../../services/memoryBadge';
import { TelemetryService } from '../../services/TelemetryService';
import { focusTaskInWindow } from '../../services/focusTask';
import {
  getUntrustedRoot,
  recheckWorkspaceTrust,
  restartAndStartTaskSession,
  startTaskSession,
} from '../../services/ptyManager';
import { readLiveSessions } from '../../services/claudeSessionRegistry';
import { writeHookSettings } from '../../services/ptyHookSettings';
import { dropTaskInbox, getTaskInbox, postToInbox } from '../../services/taskInbox';
import { claudeProjectDir } from '../../utils/claudePaths';
import { GitService } from '../../services/GitService';
import { WorkspacePortsRuntime } from '../../services/WorkspacePortsRuntime';
import { portLivenessService } from '../../services/PortLivenessService';
import { getServiceRunner } from '../../ipc/servicesIpc';
import { ControlError } from '../registry';
import { mainCheckout } from '../projectPaths';
import type { ProjectCapabilityDeps } from './projects';
import type { ServiceCapabilityDeps } from './services';
import type { TaskCapabilityDeps } from './tasks';
import type { ReviewCapabilityDeps } from './review';
import { taskReviews } from '../../services/prReview/taskReview';
import { prProviderFor } from '../../services/prReview/resolve';
import { GithubService } from '../../services/GithubService';
import { AzureDevOpsService } from '../../services/AzureDevOpsService';
import { ConnectionConfigService } from '../../services/ConnectionConfigService';
import { linkedAdoWorkItem, linkedGithubIssue } from '../../../shared/taskContext';

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
  return {
    getProjects: () => DatabaseService.getProjects(),
    taskDefaults,
    detectGit: (folderPath) => GitService.detectRepo(folderPath),
    mainCheckout,
    addProject: (input) => {
      // As db:saveProject saves a new one; the renderer reloads on the broadcast.
      const project = DatabaseService.saveProject(input);
      TelemetryService.capture('project_added', { source: 'api' });
      broadcastProjectsChanged();
      void syncProjectMemoryWatches();
      return project;
    },
  };
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
    onTasksChange: (listener) => {
      taskEvents.on('tasks-changed', listener);
      return () => taskEvents.off('tasks-changed', listener);
    },
    taskDefaults,
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
    getGithubIssue: async (projectPath, issueNumber) => {
      try {
        return linkedGithubIssue(await GithubService.getIssue(projectPath, issueNumber));
      } catch (err) {
        // gh's own reason, not execFile's "Command failed: gh …".
        const stderr = (err as { stderr?: unknown }).stderr;
        throw new Error(typeof stderr === 'string' && stderr.trim() ? stderr.trim() : String(err));
      }
    },
    getAdoWorkItem: async (projectId, id) => {
      const config = ConnectionConfigService.getAdoConfig(projectId);
      if (!config) return null;
      return linkedAdoWorkItem(await AzureDevOpsService.getWorkItem(config, id));
    },
    linkItems: async (taskId, items) => {
      const task = TaskService.linkItems(taskId, items);
      // The context is baked into the SessionStart hooks of the settings file
      // a session start writes; rewrite it now, so the running session's next
      // /clear or /compact re-injects it (Claude Code's file watcher picks up
      // hook edits).
      writeHookSettings(task.path, task.id);
      return task;
    },
    getInbox: getTaskInbox,
    dropInbox: dropTaskInbox,
    postToInbox: (inbox, text) => postToInbox(inbox, text),
    transcriptPathFor: (task) => {
      const live = task.jobId ? readLiveSessions().get(task.jobId)?.sessionId : null;
      const sessionId = live ?? task.sessionId;
      if (!sessionId) return null;
      // A session resumed after a worktree move keeps writing under its old folder.
      const files = [task.path, task.previousPath]
        .filter((dir): dir is string => !!dir)
        .map((dir) => path.join(claudeProjectDir(dir), `${sessionId}.jsonl`));
      return files.find((f) => fs.existsSync(f)) ?? files[0]!;
    },
    readTranscript: (file) => fs.promises.readFile(file, 'utf8').catch(() => null),
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
