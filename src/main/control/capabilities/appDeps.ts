import * as fs from 'fs';
import { DatabaseService } from '../../services/DatabaseService';
import { TaskService } from '../../services/TaskService';
import { activityMonitor, activityEvents } from '../../services/ActivityMonitor';
import { contextUsageService } from '../../services/ContextUsageService';
import { supervisorService } from '../../services/SupervisorService';
import { worktreeService } from '../../services/WorktreeService';
import {
  loadLocalTaskDefaults,
  loadSharedWorkspaceConfig,
  loadWorkspaceConfig,
  writeLocalTaskDefaults,
  writeWorkspaceConfig,
} from '../../services/WorkspaceConfigService';
import { LOCAL_CONFIG_EXCLUDE_ENTRY } from '../../services/gitExclude';
import { taskEvents } from '../../services/taskEvents';
import { broadcastProjectsChanged } from '../../services/projectEvents';
import { TelemetryService } from '../../services/TelemetryService';
import { focusTaskInWindow, openPrInWindow, showInWindow } from '../../services/focusTask';
import { outsideRoots } from '../../services/editorRoots';
import {
  getUntrustedRoot,
  recheckWorkspaceTrust,
  restartAndStartTaskSession,
  startTaskSession,
} from '../../services/ptyManager';
import { readLiveSessions, sessionTranscriptPath } from '../../services/claudeSessionRegistry';
import { listAgents } from '../../services/SlashCommandService';
import { writeHookSettings } from '../../services/ptyHookSettings';
import { dropTaskInbox, getTaskInbox, postToInbox } from '../../services/taskInbox';
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
import type { ShowCapabilityDeps } from './show';
import { taskReviews } from '../../services/prReview/taskReview';
import { prContextFor, prProviderFor } from '../../services/prReview/resolve';
import { appPrContextDeps, appDefaultReviewPr } from '../../services/prReview/appDeps';
import { loadPrReview } from '../../services/prReview/loadReview';
import { GithubService } from '../../services/GithubService';
import { AzureDevOpsService } from '../../services/AzureDevOpsService';
import { ConnectionConfigService } from '../../services/ConnectionConfigService';
import { linkedAdoWorkItem, linkedGithubIssue } from '../../../shared/taskContext';
import { broadcast } from '../../utils/broadcast';
import type { HeldTaskNotice } from '../../../shared/types';

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
    sessionConfig: (projectPath) => {
      try {
        return loadWorkspaceConfig(projectPath)?.session;
      } catch {
        return undefined;
      }
    },
    configure: async (projectPath, patch) => {
      if (patch.appendSystemPrompt !== undefined) {
        // As Project settings saves config.json: its own keys kept, session replaced.
        const shared = loadSharedWorkspaceConfig(projectPath) ?? {};
        const text = patch.appendSystemPrompt.trim();
        writeWorkspaceConfig(projectPath, {
          taskDefaults: shared.taskDefaults,
          session: text ? { ...shared.session, appendSystemPrompt: text } : undefined,
        });
      }
      if (patch.extraArgs !== undefined || patch.addDirs !== undefined) {
        const own = loadLocalTaskDefaults(projectPath);
        writeLocalTaskDefaults(projectPath, {
          extraArgs: patch.extraArgs ?? own.extraArgs,
          addDirs: patch.addDirs ?? own.addDirs,
        });
        await GitService.ensureExcluded(projectPath, LOCAL_CONFIG_EXCLUDE_ENTRY).catch(() => {});
      }
    },
    detectGit: (folderPath) => GitService.detectRepo(folderPath),
    mainCheckout,
    addProject: (input) => {
      // As db:saveProject saves a new one; the renderer reloads on the broadcast.
      const project = DatabaseService.saveProject(input);
      TelemetryService.capture('project_added', { source: 'api' });
      broadcastProjectsChanged();
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
    getActivityTiming: () => activityMonitor.getTiming(),
    getStatusLine: () => contextUsageService.getAllStatusLine(),
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
    setLaunchOptions: (id, patch) => {
      DatabaseService.setTaskLaunchOptions(id, patch);
      const task = DatabaseService.getTask(id)!;
      taskEvents.emitChanged(task.projectId);
      return task;
    },
    setProtected: (id, value) => {
      DatabaseService.setTaskProtected(id, value);
      const task = DatabaseService.getTask(id)!;
      taskEvents.emitChanged(task.projectId);
      return task;
    },
    listAgents,
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
    transcriptPathFor: sessionTranscriptPath,
    readTranscript: (file) => fs.promises.readFile(file, 'utf8').catch(() => null),
    showHeldNotice: (task, notice) =>
      broadcast('tasks:noticeHeld', {
        taskId: task.id,
        projectId: task.projectId,
        taskName: task.name,
        text: notice.text,
      } satisfies HeldTaskNotice),
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
      prProviderFor(appPrContextDeps.getProject(projectId) ?? { gitRemote: null }),
    getTask: (id) => DatabaseService.getTask(id),
    prHead: async (task, number) => {
      const { adapter, ctx } = prContextFor(task.projectId, task.path, appPrContextDeps);
      return adapter.head(ctx, number);
    },
    replyThread: async (task, number, ref) => {
      const { adapter, ctx } = prContextFor(task.projectId, task.path, appPrContextDeps);
      return adapter.replyThread(ctx, number, ref);
    },
    openPr: (task, pr) => {
      if (!openPrInWindow({ taskId: task.id, projectId: task.projectId, pr })) {
        throw new ControlError(409, 'Dash has no window open');
      }
    },
    // Read per call, so a database that failed to open fails the call, not the API's start.
    get reviews() {
      return taskReviews();
    },
    defaultPr: appDefaultReviewPr,
    async loadReview(task, pr) {
      const { provider, adapter, ctx } = prContextFor(task.projectId, task.path, appPrContextDeps);
      if (provider !== pr.provider) {
        throw new ControlError(400, `this project's PRs are on ${provider}`);
      }
      return loadPrReview(adapter, ctx, pr.number);
    },
  };
}

export function showDeps(): ShowCapabilityDeps {
  return {
    getTask: (id) => DatabaseService.getTask(id),
    outsideRoots,
    show: showInWindow,
  };
}
