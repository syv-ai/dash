import type {
  CreateTaskInput,
  CreateTaskResult,
  CreateTaskRunOptions,
  DeleteTaskOptions,
  LinkedAdoWorkItem,
  LinkedGithubIssue,
  LinkedItem,
  Task,
} from '@shared/types';
import { buildTaskContext, relinkTaskContext } from '@shared/taskContext';
import { DatabaseService } from './DatabaseService';
import { worktreeService } from './WorktreeService';
import { GitService } from './GitService';
import { GithubService } from './GithubService';
import { AzureDevOpsService } from './AzureDevOpsService';
import { ConnectionConfigService } from './ConnectionConfigService';
import { TelemetryService } from './TelemetryService';
import { WorkspacePortsRuntime } from './WorkspacePortsRuntime';
import { loadWorkspaceConfig } from './WorkspaceConfigService';
import {
  ensureWatching as ensurePortsConfigWatch,
  stop as stopPortsConfigWatch,
} from './PortsConfigWatcher';
import {
  setInitialPrompt,
  discardInitialPrompt,
  startTaskSession,
  stopTaskSession,
  removeTaskSession,
  listForTask,
  killPtyAwait,
} from './ptyManager';
import { portLivenessService } from './PortLivenessService';
import { removeShellHistory } from './ptyShellConfig';
import { getTuiHost } from '../tui/hostInstance';
import { taskEvents } from './taskEvents';
import { forgetSetupRun } from './setupRuns';
import { FolderOccupiedError } from './FolderOccupiedError';
import { removeTaskSettings } from './taskSettings';
import { forgetTask as forgetTaskInbox } from './taskInbox';

/** The line an API-created task's first message starts with. */
export const UNATTENDED_INSTRUCTION =
  "You were started by an orchestrator and may be running unattended. Don't use AskUserQuestion; state your assumptions and continue. Messages may reach you from an orchestrator through Dash, headed [Message from … via Dash …]: your last message of the turn one starts is read as your reply, so answer there; no need to SendMessage.";

/** End a task's shell and service terminals and its setup run (not its agent pane). */
async function killTaskTerminals(taskId: string, why: string): Promise<void> {
  // A setup script still running in the worktree goes too (quietly: the
  // renderer drops its Setup tab).
  const task = DatabaseService.getTask(taskId);
  if (task?.useWorktree) forgetSetupRun(task.path);
  await Promise.all(
    listForTask(taskId, { kinds: ['shell', 'service'] }).map((ptyId) =>
      killPtyAwait(ptyId).catch((err) =>
        console.warn(`[TaskService] ${why}: could not kill ${ptyId}:`, err),
      ),
    ),
  );
}

/**
 * Task lifecycle: create, archive, restore, delete. The task dialog (through
 * `task:*` IPC) and the control API both come here, so the side effects
 * (worktree, ports, first prompt, branch comments, telemetry,
 * the `tasks-changed` event) happen the same way whoever asked.
 */
export class TaskService {
  static async create(
    input: CreateTaskInput,
    opts: CreateTaskRunOptions,
  ): Promise<CreateTaskResult> {
    const project = DatabaseService.getProjects().find((p) => p.id === input.projectId);
    if (!project) throw new Error(`Project not found: ${input.projectId}`);
    const { name, linkedItems, contextPrompt, setupScript, teardownScript } = input;

    // saveTask enforces one active in-place task per project folder; check it
    // before the checkout too, or a refused task would still switch the
    // occupant's branch.
    if (input.kind === 'in-place-checkout' || input.kind === 'in-place-no-git') {
      const occupant = DatabaseService.findActiveNonWorktreeTaskAt(project.id, project.path);
      if (occupant) {
        throw new FolderOccupiedError(
          `Cannot run "${name}" in ${project.path}: active task "${occupant.name}" already uses this folder. Archive it first.`,
        );
      }
    }

    const ghItems =
      linkedItems?.filter((i): i is LinkedGithubIssue => i.provider === 'github') ?? [];
    const adoItems = linkedItems?.filter((i): i is LinkedAdoWorkItem => i.provider === 'ado') ?? [];
    const ghIssueNumbers = ghItems.map((i) => i.id);
    const linkedIssueNumbers = ghIssueNumbers.length > 0 ? ghIssueNumbers : undefined;

    let worktreeInfo: { branch: string; path: string } | null = null;
    switch (input.kind) {
      case 'worktree-new-branch': {
        worktreeInfo = await worktreeService.createWorktree(project.path, name, {
          baseRef: input.baseRef,
          projectId: project.id,
          linkedIssueNumbers,
          pushRemote: input.pushRemote,
          setupScript,
        });
        TelemetryService.capture('worktree_created');
        break;
      }
      case 'worktree-existing': {
        // Fast-forward the local branch to remote first, when requested, so the
        // worktree is cut from the up-to-date tip. Done before creation so a
        // diverged branch aborts without leaving a half-built worktree.
        if (input.updateFromRemote) {
          await GitService.updateBranchToRemote(project.path, input.branch);
        }
        worktreeInfo = await worktreeService.createWorktreeFromExistingBranch(
          project.path,
          name,
          input.branch,
          { projectId: project.id, setupScript },
        );
        TelemetryService.capture('worktree_created_existing_branch');
        break;
      }
      case 'in-place-checkout': {
        // Fast-forward to remote before switching, when requested, so a diverged
        // branch aborts before we touch the working tree.
        if (input.updateFromRemote) {
          await GitService.updateBranchToRemote(project.path, input.branch);
        }
        await GitService.checkoutBranch(project.path, input.branch);
        break;
      }
      case 'in-place-no-git':
        break;
    }

    const useWorktree = input.kind === 'worktree-new-branch' || input.kind === 'worktree-existing';
    const fallbackBranch =
      input.kind === 'worktree-existing' || input.kind === 'in-place-checkout'
        ? input.branch
        : input.kind === 'worktree-new-branch'
          ? input.baseRef
          : 'main';
    const branch = worktreeInfo?.branch ?? fallbackBranch;

    const task = DatabaseService.saveTask({
      projectId: project.id,
      name,
      branch,
      path: worktreeInfo?.path ?? project.path,
      useWorktree,
      permissionMode: input.permissionMode,
      model: input.model,
      // Only Dash-created branches should be auto-deleted on task removal.
      branchCreatedByDash: input.kind === 'worktree-new-branch' && !!worktreeInfo,
      linkedItems: linkedItems ?? null,
      contextPrompt: contextPrompt ?? null,
      setupScript: setupScript ?? null,
      teardownScript: teardownScript ?? null,
      dashAccess: resolveDashAccess(input.dashAccess, project.path),
      parentTaskId: input.parentTaskId ?? null,
    });

    // Allocate per-task ports the first time the row is saved. setupTask
    // persists to SQLite (the only source of truth for what ports are taken);
    // the later agent spawn reads the env from there. Skipped for in-place
    // tasks: they share the project dir.
    if (task.useWorktree) {
      try {
        WorkspacePortsRuntime.setupTask({ taskId: task.id, worktreePath: task.path });
        // Arm the watcher even if .dash/ doesn't exist yet — ensureWatching
        // keeps the entry and retries the fs.watch on every subsequent call,
        // so it auto-attaches as soon as the agent creates .dash/. The watcher
        // lives until the task is deleted.
        ensurePortsConfigWatch(task.id, task.path);
      } catch (err) {
        console.error('[TaskService] setupTask ports allocation failed:', err);
      }
    }

    TelemetryService.capture('task_created', { kind: input.kind, source: opts.source });

    // Combine the context prompt (project default or per-task) with any
    // linked-issue context into one prompt.
    const context = buildTaskContext(contextPrompt, linkedItems);
    const prompt = [context, input.initialPrompt?.trim()].filter(Boolean).join('\n\n');
    // An API-created task may have no person watching it.
    const firstMessage =
      prompt && opts.source === 'api' ? `${UNATTENDED_INSTRUCTION}\n\n${prompt}` : prompt;
    if (firstMessage) {
      // Submitted as the first message of the first dispatch, so the agent acts
      // on it instead of only receiving silent SessionStart context.
      setInitialPrompt(task.id, firstMessage);
    }
    if (context) {
      // The context (not the one-shot instruction) is also persisted so the
      // SessionStart hook re-injects it on /clear and /compact (which drop it
      // from history).
      DatabaseService.setTaskContextPrompt(task.id, context);
    }

    DatabaseService.getOrCreateDefaultConversation(task.id);

    postBranchComments(project.id, project.path, task, ghIssueNumbers, adoItems);

    let session: CreateTaskResult['session'] = 'deferred';
    try {
      if (opts.startSession) {
        const started = await startTaskSession(task.id).catch((err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          throw new Error(`Task "${name}" was created, but its session did not start: ${reason}`);
        });
        session = 'needsTrust' in started ? 'needs-trust' : 'started';
      }
    } finally {
      taskEvents.emitChanged(project.id);
    }
    return { task: DatabaseService.getTask(task.id) ?? task, session };
  }

  /**
   * Link issues / work items to an existing task, as the task dialog does at
   * creation: stored (an item already linked is skipped), their content added
   * to the persisted context (re-injected on /clear and /compact, never sent
   * into the running session), and the task's branch commented on each new
   * item (commented, not linked: see below).
   */
  static linkItems(id: string, items: LinkedItem[]): Task {
    const task = DatabaseService.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    const before = task.linkedItems ?? [];
    const added = items.filter(
      (i) => !before.some((b) => b.provider === i.provider && b.id === i.id),
    );
    if (added.length === 0) return task;
    const after = [...before, ...added];
    DatabaseService.setTaskLinkedItems(id, after);
    DatabaseService.setTaskContextPrompt(id, relinkTaskContext(task.contextPrompt, before, after));

    const project = DatabaseService.getProjects().find((p) => p.id === task.projectId);
    if (project) {
      const ghIssueNumbers = added.filter((i) => i.provider === 'github').map((i) => i.id);
      const adoItems = added.filter((i): i is LinkedAdoWorkItem => i.provider === 'ado');
      // No GitHub branch link here: createLinkedBranch creates the branch on
      // the remote (a push behind the task's back), and fails for a branch
      // that is already there. The comment names the branch instead.
      postBranchComments(project.id, project.path, task, ghIssueNumbers, adoItems);
    }
    taskEvents.emitChanged(task.projectId);
    return DatabaseService.getTask(id) ?? task;
  }

  /** Put the task's session to sleep (`claude stop`) and archive the row. */
  static async archive(id: string): Promise<void> {
    // Shells and services would otherwise keep running (and holding ports)
    // for a task nobody sees; restoring starts fresh ones.
    await killTaskTerminals(id, 'archive');
    // Restoring and opening the task attaches, which wakes the session.
    await stopTaskSession(id).catch((err) =>
      console.warn('[TaskService] archive: session stop failed:', err),
    );
    const task = DatabaseService.getTask(id);
    DatabaseService.archiveTask(id);
    TelemetryService.capture('task_archived');
    if (task) taskEvents.emitChanged(task.projectId);
  }

  static async restore(id: string): Promise<void> {
    DatabaseService.restoreTask(id);
    TelemetryService.capture('task_restored');
    const task = DatabaseService.getTask(id);
    if (task) taskEvents.emitChanged(task.projectId);
  }

  /**
   * Delete the task: its worktree (as `options` asks), its supervisor session
   * and its row. Branches are only ever deleted when Dash created them, and a
   * missing flag means "keep".
   */
  static async delete(id: string, options: DeleteTaskOptions): Promise<void> {
    const task = DatabaseService.getTask(id);
    if (!task) return;
    const project = DatabaseService.getProjects().find((p) => p.id === task.projectId);
    // Shell and service terminals run in the worktree (and hold its ports);
    // end them before it goes. The agent PTY goes with the session below.
    await killTaskTerminals(id, 'delete');
    if (task.useWorktree && project) {
      try {
        await worktreeService.removeWorktree(project.path, task.path, task.branch, {
          deleteWorktreeDir: options.deleteWorktreeDir === true,
          deleteLocalBranch: options.deleteLocalBranch === true && task.branchCreatedByDash,
          deleteRemoteBranch: options.deleteRemoteBranch === true && task.branchCreatedByDash,
          teardownScript: task.teardownScript,
        });
        TelemetryService.capture('worktree_removed');
      } catch (err) {
        // The row still goes: a task whose worktree is half-gone is worse
        // than a leftover directory.
        console.error(`[TaskService] worktree removal failed for ${task.name}:`, err);
      }
    }

    // Forget the task's supervisor session (transcript kept) while the row
    // still carries the job id.
    await removeTaskSession(id).catch((err) =>
      console.warn('[TaskService] delete: session removal failed:', err),
    );
    DatabaseService.deleteTask(id);
    // Close the ports and liveness watchers, drop any never-consumed initial
    // prompt, and dismiss a lingering ports-setup toast for this task.
    stopPortsConfigWatch(id);
    portLivenessService.forgetTask(id);
    forgetTaskInbox(id);
    discardInitialPrompt(id);
    removeShellHistory(id);
    void getTuiHost().cancelForTask(id);
    TelemetryService.capture('task_deleted');
    try {
      removeTaskSettings(id);
    } catch (err) {
      console.warn('[TaskService] delete: settings file removal failed:', err);
    }
    taskEvents.emitChanged(task.projectId);
  }

  /**
   * Delete a project: each task (archived ones too) goes through `delete`,
   * so its session, terminals, worktree and files go as for a single task;
   * then the project row.
   */
  static async deleteProject(projectId: string, options: DeleteTaskOptions): Promise<void> {
    for (const task of DatabaseService.getTasks(projectId)) {
      await TaskService.delete(task.id, options);
    }
    DatabaseService.deleteProject(projectId);
    TelemetryService.capture('project_deleted');
  }
}

/** Explicit flag → the project's `taskDefaults.dashAccess` → off. */
function resolveDashAccess(explicit: boolean | undefined, projectPath: string): boolean {
  if (explicit !== undefined) return explicit;
  try {
    return loadWorkspaceConfig(projectPath)?.taskDefaults?.dashAccess ?? false;
  } catch (err) {
    console.warn('[TaskService] could not read the project default for Dash access:', err);
    return false;
  }
}

/**
 * Fire-and-forget: comment the task's branch on each linked GitHub issue / ADO
 * item, worded by whether Dash created the branch or the task reuses one.
 */
function postBranchComments(
  projectId: string,
  projectPath: string,
  task: Pick<Task, 'branch' | 'branchCreatedByDash'>,
  ghIssueNumbers: number[],
  adoItems: LinkedAdoWorkItem[],
): void {
  const { branch, branchCreatedByDash: created } = task;
  for (const num of ghIssueNumbers) {
    GithubService.postBranchComment(projectPath, num, branch, created).catch((err) =>
      console.warn(`[TaskService] failed to link branch to issue #${num}:`, err),
    );
  }
  if (adoItems.length === 0) return;
  const config = ConnectionConfigService.getAdoConfig(projectId);
  if (!config) return;
  for (const wi of adoItems) {
    AzureDevOpsService.postBranchComment(config, wi.id, branch, created).catch((err) =>
      console.warn(`[TaskService] failed to link branch to work item #${wi.id}:`, err),
    );
  }
}
