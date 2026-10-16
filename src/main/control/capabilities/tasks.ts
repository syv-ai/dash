import { z } from 'zod';
import type {
  ActivityInfo,
  CreateTaskInput,
  CreateTaskResult,
  CreateTaskRunOptions,
  DeleteTaskOptions,
  Project,
  Task,
} from '../../../shared/types';
import type { WorkspaceTaskDefaults } from '../../services/WorkspaceConfigService';
import { TerminalMirror } from '../../services/TerminalMirror';
import { taskModelSchema } from '../../ipc/schemas';
import { ControlError, defineCapability, type Registry } from '../registry';
import { defaultBaseRef } from './projects';

/**
 * Appended to a message sent to a task with Dash access. A send resumes the
 * session, and Claude Code starts that turn before MCP servers reconnect,
 * telling the model the dash tools are gone; they are back seconds later.
 */
export const RESUME_TOOLS_HINT =
  '(Dash restarted this session to deliver this message, so its dash tools may briefly show as disconnected. They reconnect within seconds: if one is missing, find it with ToolSearch and retry.)';

/** The task state the API reports. */
export type TaskApiState = 'idle' | 'working' | 'waiting' | 'error' | 'stopped' | 'needs-trust';

export interface TaskView {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  path: string;
  state: TaskApiState;
  detail?: string;
  parentTaskId: string | null;
  dashAccess: boolean;
  archived: boolean;
  createdAt: string;
}

/** Everything the task capabilities touch outside `control/`; index.ts wires the real services. */
export interface TaskCapabilityDeps {
  getProjects(): Project[];
  getTask(id: string): Task | undefined;
  /** Every task of the project, archived ones included. */
  getTasks(projectId: string): Task[];
  getActivity(): Record<string, ActivityInfo>;
  getUntrustedRoot(taskId: string): string | undefined;
  /** Subscribe to activity changes; returns the unsubscribe. */
  onActivityChange(listener: () => void): () => void;
  taskDefaults(projectPath: string): WorkspaceTaskDefaults | undefined;
  /** Git's default base when nothing names one (the remote's HEAD branch). */
  resolveBaseRef(projectPath: string): Promise<string>;
  /** The branch checked out in the folder now; null on a detached HEAD. */
  currentBranch(projectPath: string): Promise<string | null>;
  /** A valid branch name that exists locally or on origin (GitService.branchExists). */
  branchExists(projectPath: string, branch: string): Promise<boolean>;
  /** Re-read Claude Code's trust for the task's folder, clearing a stale
   *  needs-trust mark; true when the task is not (or no longer) untrusted. */
  recheckTrust(taskId: string): Promise<boolean>;
  createTask(input: CreateTaskInput, opts: CreateTaskRunOptions): Promise<CreateTaskResult>;
  archiveTask(id: string): Promise<void>;
  restoreTask(id: string): Promise<void>;
  deleteTask(id: string, opts: DeleteTaskOptions): Promise<void>;
  /** Re-dispatch the session and start it again, as one session start
   *  (ptyManager.restartAndStartTaskSession), so an open pane re-attaches. */
  restartSession(id: string): Promise<{ jobId: string } | { needsTrust: string }>;
  startSession(id: string): Promise<{ jobId: string } | { needsTrust: string }>;
  /** `claude logs <jobId>`: the raw repaint stream. */
  readLogs(jobId: string): Promise<string>;
  /** Show and focus Dash's window on the task. */
  openTask(task: Task): void;
  /** Give the task's session `text` as its next user turn through the CLI
   *  (ptyManager.sendToTaskSession), starting a stopped session with it.
   *  `notIdle` when the session turned out to be working or waiting. */
  sendToSession(
    taskId: string,
    text: string,
  ): Promise<{ sent: true } | { needsTrust: string } | { notIdle: 'working' | 'waiting' }>;
}

const STATE_FROM_ACTIVITY: Record<ActivityInfo['state'], TaskApiState> = {
  busy: 'working',
  idle: 'idle',
  waiting: 'waiting',
  error: 'error',
  stopped: 'stopped',
};

/** The one place the API's task state comes from (tasks.get/list/wait). */
export function toTaskView(
  task: Task,
  activity: Record<string, ActivityInfo>,
  getUntrustedRoot: (taskId: string) => string | undefined,
): TaskView {
  const info = activity[task.id];
  const trustRoot = getUntrustedRoot(task.id);
  let state: TaskApiState = info ? STATE_FROM_ACTIVITY[info.state] : 'stopped';
  let detail = info?.detail ?? (info?.state === 'error' ? info.error?.message : undefined);
  if (trustRoot) {
    state = 'needs-trust';
    detail = `Claude Code's workspace trust prompt for ${trustRoot} needs a person: open the task in Dash`;
  }
  const view: TaskView = {
    id: task.id,
    projectId: task.projectId,
    name: task.name,
    branch: task.branch,
    path: task.path,
    state,
    parentTaskId: task.parentTaskId,
    dashAccess: task.dashAccess,
    archived: task.archivedAt != null,
    createdAt: task.createdAt,
  };
  if (detail) view.detail = detail;
  return view;
}

const taskIdInput = z.object({ taskId: z.string().describe('The task id') });

/** The one refusal for acting on an archived task (send, open, restart, services). */
export function assertNotArchived(task: Task): void {
  if (task.archivedAt) throw new ControlError(409, `${task.name} is archived; restore it first`);
}

/**
 * A branch name, never an option, path or revision expression: it reaches
 * `git checkout` / `git worktree add` in the project folder. Git's own check
 * (deps.branchExists) runs after; this keeps the obvious cases out of git.
 */
const branchName = z
  .string()
  .trim()
  .min(1)
  .refine(
    (b) =>
      !/^[-./]/.test(b) &&
      !b.endsWith('/') &&
      !b.endsWith('.') &&
      !b.endsWith('.lock') &&
      !b.includes('..') &&
      !b.includes('@{') &&
      // eslint-disable-next-line no-control-regex
      !/[\s~^:?*\\[\]\x00-\x1f\x7f]/.test(b),
    'not a branch name',
  );

/** Output is replayed into a terminal this size (`claude logs` repaints a full screen). */
const OUTPUT_COLS = 200;
const OUTPUT_ROWS = 50;
const MAX_SEND_BYTES = 32 * 1024;

type WaitUntil = 'idle' | 'waiting' | 'not-working' | 'change';

function matchesUntil(until: WaitUntil, view: TaskView, initial: TaskView): boolean {
  switch (until) {
    case 'idle':
      return view.state === 'idle';
    case 'waiting':
      return view.state === 'waiting';
    case 'not-working':
      return view.state !== 'working';
    case 'change':
      return view.state !== initial.state;
  }
}

export function registerTaskCapabilities(registry: Registry, deps: TaskCapabilityDeps): void {
  const view = (task: Task): TaskView =>
    toTaskView(task, deps.getActivity(), deps.getUntrustedRoot);
  /** view, after re-reading trust for a task marked untrusted (it may have
   *  been accepted outside Dash since). */
  const freshView = async (task: Task): Promise<TaskView> => {
    if (deps.getUntrustedRoot(task.id)) await deps.recheckTrust(task.id);
    return view(task);
  };
  /** The registry already checked the target exists and is in scope. */
  const taskOrThrow = (id: string): Task => {
    const task = deps.getTask(id);
    if (!task) throw new ControlError(404, 'task not found');
    return task;
  };

  registry.register(
    defineCapability({
      name: 'tasks.list',
      summary:
        'List Dash tasks with their state (idle, working, waiting, error, stopped or needs-trust). An agent inside a task sees itself and the tasks it created. Archived tasks are left out unless includeArchived is set.',
      input: z.object({
        projectId: z.string().optional().describe('Only tasks of this project'),
        includeArchived: z.boolean().optional(),
      }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { projectId: 'projectId' },
      handler: async (ctx, input) => {
        const projectIds = input.projectId ? [input.projectId] : [...ctx.scope.visibleProjectIds];
        return projectIds
          .flatMap((id) => deps.getTasks(id))
          .filter((t) => ctx.scope.canSeeTask(t))
          .filter((t) => input.includeArchived || t.archivedAt == null)
          .map(view);
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.get',
      summary: 'Get one task: its name, branch, worktree path, state and what it waits for.',
      input: taskIdInput,
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      handler: async (_ctx, input) => freshView(taskOrThrow(input.taskId)),
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.create',
      summary:
        "Create a Dash task (by default a new git worktree on a new branch) and start its Claude Code session with the prompt. Returns the task and session: 'started', or 'needs-trust' when a person must accept Claude Code's trust prompt for the folder in Dash first. bypassPermissions is not allowed.",
      input: z.object({
        projectId: z
          .string()
          .describe('From projects_list; an agent in a task can only use its own project'),
        name: z.string().trim().min(1).max(200),
        prompt: z
          .string()
          .optional()
          .describe(
            "The task's first message: submitted once, not re-sent after /clear or /compact",
          ),
        kind: z
          .enum(['new-branch', 'existing-branch', 'in-place'])
          .optional()
          .describe(
            'new-branch (default): a worktree on a new branch. existing-branch: a worktree on `branch`. in-place: run in the project folder, checking out `branch` (default: the one checked out now).',
          ),
        baseRef: z
          .string()
          .optional()
          .describe("new-branch only: the ref to branch from (default: the project's base ref)"),
        branch: branchName
          .optional()
          .describe('existing-branch and in-place: the branch (local, or on origin)'),
        pushRemote: z
          .boolean()
          .optional()
          .describe('new-branch only: push the new branch to the remote (default false)'),
        model: taskModelSchema.optional(),
        permissionMode: z.enum(['default', 'acceptEdits']).optional(),
        dashAccess: z
          .boolean()
          .optional()
          .describe("Give the new task's agent these Dash tools (default: the project's setting)"),
      }),
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { projectId: 'projectId' },
      handler: async (ctx, input) => {
        const project = deps.getProjects().find((p) => p.id === input.projectId);
        if (!project) throw new ControlError(404, 'project not found');
        const defaults = deps.taskDefaults(project.path);
        const kind = input.kind ?? (project.isGitRepo ? 'new-branch' : 'in-place');

        const base = {
          projectId: project.id,
          name: input.name,
          // Never the project's bypassPermissions default (one agent must not
          // start another with every permission prompt off).
          permissionMode:
            input.permissionMode ??
            (defaults?.permissionMode === 'acceptEdits' ? 'acceptEdits' : 'default'),
          model: input.model ?? 'default',
          // The prompt is a one-shot instruction; the project's context prompt
          // (which the task dialog prefills) stays context, re-injected on
          // /clear and /compact.
          initialPrompt: input.prompt,
          contextPrompt: defaults?.contextPrompt,
          dashAccess: input.dashAccess,
          parentTaskId: ctx.caller.kind === 'task' ? ctx.caller.taskId : null,
        } as const;

        let createInput: CreateTaskInput;
        if (kind === 'in-place' && !project.isGitRepo) {
          createInput = { ...base, kind: 'in-place-no-git' };
        } else {
          if (!project.isGitRepo) {
            throw new ControlError(
              400,
              `${project.name} is not a git repository; use kind in-place`,
            );
          }
          if (kind === 'new-branch') {
            const baseRef =
              input.baseRef ??
              defaultBaseRef(project, defaults) ??
              (await deps.resolveBaseRef(project.path));
            createInput = {
              ...base,
              kind: 'worktree-new-branch',
              baseRef,
              pushRemote: input.pushRemote ?? false,
            };
          } else {
            let branch = input.branch;
            if (!branch && kind === 'in-place') {
              // The live HEAD: project.gitBranch is only what it was when the
              // project was added, and checking that out would move the folder.
              branch = (await deps.currentBranch(project.path)) ?? undefined;
              if (!branch) {
                throw new ControlError(
                  400,
                  `${project.name} is on a detached HEAD; pass the branch to check out`,
                );
              }
            } else if (!branch) {
              throw new ControlError(400, `${kind} needs a branch`);
            } else if (!(await deps.branchExists(project.path, branch))) {
              throw new ControlError(400, `${project.name} has no branch ${branch}`);
            }
            createInput = {
              ...base,
              kind: kind === 'existing-branch' ? 'worktree-existing' : 'in-place-checkout',
              branch,
            };
          }
        }

        const result = await deps.createTask(createInput, { startSession: true, source: 'api' });
        return { task: view(result.task), session: result.session };
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.wait',
      summary:
        'Wait until a task is idle, waiting for a person, not working, or changes state, for up to timeoutSec (max 110). Returns the task and timedOut: true when the time ran out; call again to keep waiting.',
      input: z.object({
        taskId: z.string(),
        until: z.enum(['idle', 'waiting', 'not-working', 'change']),
        timeoutSec: z.number().min(0).max(110).default(60),
      }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      handler: async (_ctx, input) => {
        const initial = await freshView(taskOrThrow(input.taskId));
        if (input.until !== 'change' && matchesUntil(input.until, initial, initial)) {
          return { task: initial, timedOut: false };
        }
        return new Promise<{ task: TaskView; timedOut: boolean }>((resolve, reject) => {
          let latest = initial;
          let settled = false;
          const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubscribe();
            fn();
          };
          const unsubscribe = deps.onActivityChange(() => {
            const task = deps.getTask(input.taskId);
            if (!task) {
              settle(() => reject(new ControlError(404, 'task not found')));
              return;
            }
            latest = view(task);
            if (matchesUntil(input.until, latest, initial)) {
              settle(() => resolve({ task: latest, timedOut: false }));
            }
          });
          const timer = setTimeout(
            () => settle(() => resolve({ task: latest, timedOut: true })),
            input.timeoutSec * 1000,
          );
        });
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.output',
      summary:
        "Read what a task's Claude Code session shows: the last `lines` lines of its terminal as plain text.",
      input: z.object({
        taskId: z.string(),
        lines: z.number().int().min(1).max(400).default(100),
      }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      handler: async (_ctx, input) => {
        const task = taskOrThrow(input.taskId);
        if (!task.jobId) throw new ControlError(409, `${task.name} has no session yet`);
        const bytes = await deps.readLogs(task.jobId);
        const mirror = new TerminalMirror(OUTPUT_COLS, OUTPUT_ROWS);
        try {
          mirror.write(bytes);
          return { text: await mirror.toPlainText(input.lines) };
        } finally {
          mirror.dispose();
        }
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.send',
      summary:
        "Send a message to a task's Claude Code session as its next user turn; a stopped session is started with it. Returns once it is delivered and waits for nothing (use tasks_wait). Refused while the task is working (wait until it is idle and send again), waits for a person (a permission prompt or question), needs the trust prompt, or is archived.",
      input: z.object({
        taskId: z.string(),
        text: z
          .string()
          .min(1)
          .refine((s) => Buffer.byteLength(s, 'utf8') <= MAX_SEND_BYTES, 'text is over 32 KB'),
      }),
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { taskId: 'taskId' },
      handler: async (_ctx, input) => {
        const task = taskOrThrow(input.taskId);
        assertNotArchived(task);
        const waiting = (detail?: string) =>
          new ControlError(
            409,
            `${task.name} is waiting for a person${detail ? `: ${detail}` : ''}`,
          );
        const working = () =>
          new ControlError(
            409,
            `${task.name} is working; wait until it is idle (tasks_wait) and send again`,
          );
        // A needs-trust mark clears here when the folder was trusted outside
        // Dash; the send then starts the session like any stopped one.
        const current = await freshView(task);
        if (current.state === 'waiting') throw waiting(current.detail);
        if (current.state === 'working') throw working();
        if (current.state === 'needs-trust') throw new ControlError(409, current.detail!);
        const text = task.dashAccess ? `${input.text}\n\n${RESUME_TOOLS_HINT}` : input.text;
        const result = await deps.sendToSession(task.id, text);
        if ('notIdle' in result) throw result.notIdle === 'working' ? working() : waiting();
        if ('needsTrust' in result) throw new ControlError(409, view(task).detail!);
        return {};
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.open',
      summary: "Bring Dash's window to the front with the task open, for a person to look at.",
      input: taskIdInput,
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { taskId: 'taskId' },
      handler: async (_ctx, input) => {
        const task = taskOrThrow(input.taskId);
        assertNotArchived(task);
        deps.openTask(task);
        return {};
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.archive',
      summary:
        'Archive a task: its session is put to sleep and it leaves the active list; the worktree stays. Returns the task. A task cannot archive itself.',
      input: taskIdInput,
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { taskId: 'taskId' },
      allowSelf: false,
      handler: async (_ctx, input) => {
        await deps.archiveTask(input.taskId);
        return view(taskOrThrow(input.taskId));
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.restore',
      summary: 'Restore an archived task to the active list. Returns the task.',
      input: taskIdInput,
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { taskId: 'taskId' },
      handler: async (_ctx, input) => {
        await deps.restoreTask(input.taskId);
        return view(taskOrThrow(input.taskId));
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.delete',
      summary:
        "Delete a task: its session, its worktree folder and, with deleteBranch, the branch Dash created for it (locally and on the remote). Branches Dash didn't create are kept. Cannot be undone.",
      input: z.object({ taskId: z.string(), deleteBranch: z.boolean().optional() }),
      callers: ['orchestrator'],
      readOnly: false,
      target: { taskId: 'taskId' },
      allowSelf: false,
      handler: async (_ctx, input) => {
        const deleteBranch = input.deleteBranch === true;
        await deps.deleteTask(input.taskId, {
          deleteWorktreeDir: true,
          deleteLocalBranch: deleteBranch,
          deleteRemoteBranch: deleteBranch,
        });
        return {};
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.restart',
      summary:
        "Restart a task's Claude Code session (same conversation, fresh process, so it picks up changed settings). Returns the task. A task cannot restart itself.",
      input: taskIdInput,
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { taskId: 'taskId' },
      allowSelf: false,
      handler: async (_ctx, input) => {
        assertNotArchived(taskOrThrow(input.taskId));
        await deps.restartSession(input.taskId);
        return view(taskOrThrow(input.taskId));
      },
    }),
  );
}
