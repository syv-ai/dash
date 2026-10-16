import type {
  CreateTaskInput,
  CreateTaskResult,
  CreateTaskRunOptions,
  DeleteTaskOptions,
  LinkedAdoWorkItem,
  LinkedGithubIssue,
} from '@shared/types';
import { formatTaskContextPrompt } from '@shared/taskContext';
import { DatabaseService } from './DatabaseService';
import { worktreeService } from './WorktreeService';
import { worktreePoolService } from './WorktreePoolService';
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
import { removeTaskMcpConfig } from '../control/mcpConfig';

/** The line an API-created task's first message starts with. */
export const UNATTENDED_INSTRUCTION =
  "You were started by an orchestrator and may be running unattended. Don't use AskUserQuestion; state your assumptions and continue.";

/**
 * Task lifecycle: create, archive, restore, delete. The task dialog (through
 * `task:*` IPC) and the control API both come here, so the side effects
 * (worktree, ports, first prompt, reserve refill, branch comments, telemetry,
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
        throw new Error(
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
        // New branch: try the reserve pool, fall back to direct creation.
        worktreeInfo = await worktreePoolService
          .claimReserve(
            project.id,
            name,
            input.baseRef,
            linkedIssueNumbers,
            input.pushRemote,
            setupScript,
          )
          .catch((err) => {
            console.warn('[TaskService] reserve claim failed, creating a worktree:', err);
            return null;
          });
        if (!worktreeInfo) {
          worktreeInfo = await worktreeService.createWorktree(project.path, name, {
            baseRef: input.baseRef,
            projectId: project.id,
            linkedIssueNumbers,
            pushRemote: input.pushRemote,
            setupScript,
          });
          TelemetryService.capture('worktree_created');
        }
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
          { projectId: project.id, linkedIssueNumbers, setupScript },
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
    const context = [
      contextPrompt?.trim(),
      linkedItems && linkedItems.length > 0 ? formatTaskContextPrompt(linkedItems) : '',
    ]
      .filter((part): part is string => !!part)
      .join('\n\n');
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

    worktreePoolService
      .ensureReserve(project.id, project.path)
      .catch((err) => console.warn('[TaskService] reserve refill failed:', err));
    postBranchComments(project.id, project.path, branch, ghIssueNumbers, adoItems);

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

  /** Put the task's session to sleep (`claude stop`) and archive the row. */
  static async archive(id: string): Promise<void> {
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
    await Promise.all(
      listForTask(id, { kinds: ['shell', 'service'] }).map((ptyId) =>
        killPtyAwait(ptyId).catch((err) =>
          console.warn(`[TaskService] delete: could not kill ${ptyId}:`, err),
        ),
      ),
    );
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
    discardInitialPrompt(id);
    removeShellHistory(id);
    void getTuiHost().cancelForTask(id);
    TelemetryService.capture('task_deleted');
    try {
      removeTaskMcpConfig(id);
    } catch (err) {
      console.warn('[TaskService] delete: mcp-config removal failed:', err);
    }
    taskEvents.emitChanged(task.projectId);
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

/** Fire-and-forget: link the new branch on each linked GitHub issue / ADO item. */
function postBranchComments(
  projectId: string,
  projectPath: string,
  branch: string,
  ghIssueNumbers: number[],
  adoItems: LinkedAdoWorkItem[],
): void {
  for (const num of ghIssueNumbers) {
    GithubService.postBranchComment(projectPath, num, branch).catch((err) =>
      console.warn(`[TaskService] failed to link branch to issue #${num}:`, err),
    );
  }
  if (adoItems.length === 0) return;
  const config = ConnectionConfigService.getAdoConfig(projectId);
  if (!config) return;
  for (const wi of adoItems) {
    AzureDevOpsService.postBranchComment(config, wi.id, branch).catch((err) =>
      console.warn(`[TaskService] failed to link branch to work item #${wi.id}:`, err),
    );
  }
}
