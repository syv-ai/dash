import { randomBytes } from 'crypto';
import { z } from 'zod';
import type {
  ActivityInfo,
  CreateTaskInput,
  CreateTaskResult,
  CreateTaskRunOptions,
  DeleteTaskOptions,
  LinkedAdoWorkItem,
  LinkedGithubIssue,
  LinkedItem,
  PermissionMode,
  Project,
  Task,
} from '../../../shared/types';
import { githubSlug } from '../../../shared/urls';
import type { WorkspaceTaskDefaults } from '../../services/WorkspaceConfigService';
import { messageAddress, type LiveSession } from '../../services/claudeSessionRegistry';
import { TerminalMirror } from '../../services/TerminalMirror';
import { permissionModeSchema, taskModelSchema } from '../../ipc/schemas';
import { ControlError, defineCapability, type Registry } from '../registry';
import { defaultBaseRef } from './projects';
import {
  InboxWriteError,
  findTaskMessage,
  recordTaskMessage,
  taskMessages,
  type TaskInbox,
} from '../../services/taskInbox';
import { messageHeader, replyAfterMessage } from '../../services/transcriptReply';
import { watchTasks, type TaskWatchSource } from './taskWatch';

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
  /** Where SendMessage reaches the live session (`uds:<socket>`); null when it is not running. */
  messageAddress: string | null;
  /** `needs-approval`: the task runs in bypassPermissions, so a message from a
   *  session that prompts waits for a person to deliver it in Dash. */
  messaging: 'direct' | 'needs-approval';
}

/** Everything the task capabilities touch outside `control/`; index.ts wires the real services. */
export interface TaskCapabilityDeps {
  getProjects(): Project[];
  getTask(id: string): Task | undefined;
  /** Every task of the project, archived ones included. */
  getTasks(projectId: string): Task[];
  getActivity(): Record<string, ActivityInfo>;
  getUntrustedRoot(taskId: string): string | undefined;
  /** Claude Code's running sessions by job id (claudeSessionRegistry). */
  getLiveSessions(): ReadonlyMap<string, LiveSession>;
  /** Subscribe to activity changes; returns the unsubscribe. */
  onActivityChange(listener: () => void): () => void;
  /** Subscribe to task list changes (created, archived, restored, deleted); returns the unsubscribe. */
  onTasksChange(listener: () => void): () => void;
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
  /** `gh issue view` in the project folder; throws with gh's reason. */
  getGithubIssue(projectPath: string, issueNumber: number): Promise<LinkedGithubIssue>;
  /** Null when the project has no Azure DevOps connection. */
  getAdoWorkItem(projectId: string, id: number): Promise<LinkedAdoWorkItem | null>;
  /** TaskService.linkItems: store, add to the context, link the branch. */
  linkItems(taskId: string, items: LinkedItem[]): Promise<Task>;
  /** The inbox a session in the task's folder reported on that socket (taskInbox.ts); undefined when none did. */
  getInbox(taskId: string, socket: string): TaskInbox | undefined;
  /** Drop the inbox on that socket. */
  dropInbox(taskId: string, socket: string): void;
  /** Write one message into an inbox, once (taskInbox.postToInbox). */
  postToInbox(inbox: TaskInbox, text: string): Promise<void>;
  /** Where the task's current session writes its transcript, when no hook named it; null if unknown. */
  transcriptPathFor(task: Task): string | null;
  /** A transcript's text; null when it can't be read. */
  readTranscript(path: string): Promise<string | null>;
}

const STATE_FROM_ACTIVITY: Record<ActivityInfo['state'], TaskApiState> = {
  busy: 'working',
  idle: 'idle',
  waiting: 'waiting',
  error: 'error',
  stopped: 'stopped',
};

/** The one place the API's task view comes from (tasks.get/list/wait/wake). */
export function toTaskView(
  task: Task,
  activity: Record<string, ActivityInfo>,
  getUntrustedRoot: (taskId: string) => string | undefined,
  sessions: ReadonlyMap<string, LiveSession>,
): TaskView {
  const info = activity[task.id];
  const trustRoot = getUntrustedRoot(task.id);
  const address = messageAddress(task.jobId, sessions);
  let state: TaskApiState = info ? STATE_FROM_ACTIVITY[info.state] : 'stopped';
  // The registry sees a started session before the monitor's next poll does:
  // a reachable session is never reported stopped.
  if (state === 'stopped' && address) {
    state = sessions.get(task.jobId!)?.status === 'busy' ? 'working' : 'idle';
  }
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
    messageAddress: address,
    messaging: task.permissionMode === 'bypassPermissions' ? 'needs-approval' : 'direct',
  };
  if (detail) view.detail = detail;
  return view;
}

/** A task an agent starts: any mode but bypassPermissions, auto by default. */
function withoutBypass(
  mode: PermissionMode | undefined,
): Exclude<PermissionMode, 'bypassPermissions'> {
  return !mode || mode === 'bypassPermissions' ? 'auto' : mode;
}

const taskIdInput = z.object({ taskId: z.string().describe('The task id') });

/** The one refusal for acting on an archived task (wake, open, restart, services). */
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

/** `--issue` and `--work-item`, on tasks.create and tasks.link. */
const linkInputs = {
  issue: z
    .union([z.string(), z.number()])
    .optional()
    .describe("A GitHub issue of the project's repository to link: its number, #number or URL"),
  workItem: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'An Azure DevOps work item id to link (the project needs an Azure DevOps connection)',
    ),
};

/** `123`, `#123` or the issue's github.com URL, which must be the project's repository. */
export function issueNumber(ref: string | number, project: Project): number {
  const s = String(ref).trim();
  const plain = s.match(/^#?([1-9]\d*)$/);
  if (plain) return Number(plain[1]);
  const url = s.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+\/[^/\s]+)\/issues\/([1-9]\d*)\/?(?:[?#]\S*)?$/i,
  );
  if (!url) throw new ControlError(400, `${s} is not an issue number or GitHub issue URL`);
  const repo = githubSlug(project.gitRemote);
  if (!repo) throw new ControlError(400, `${project.name} has no GitHub remote`);
  if (repo.toLowerCase() !== url[1]!.toLowerCase()) {
    throw new ControlError(400, `${url[1]} is not ${project.name}'s repository (${repo})`);
  }
  return Number(url[2]);
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Output is replayed into a terminal this size (`claude logs` repaints a full screen). */
const OUTPUT_COLS = 200;
const OUTPUT_ROWS = 50;
/** How often tasks.wake re-reads the session registry while it waits. */
const WAKE_POLL_MS = 500;
/** tasks.message: how long a stopped session gets to start and report its inbox. */
const MESSAGE_START_MS = 30_000;
/** tasks.message: how long a running session with no inbox known gets to report one. */
const INBOX_GRACE_MS = 3_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** How often tasks.watch re-reads its views anyway (a session's message address fires no event). */
const WATCH_POLL_MS = 2_000;
/** tasks.wait and tasks.wake: under Claude Code's two-minute default Bash timeout. */
const timeoutSec = z.number().min(0).max(110).default(60);

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
    toTaskView(task, deps.getActivity(), deps.getUntrustedRoot, deps.getLiveSessions());
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
  /** Fetch what `--issue` / `--work-item` name, as the task dialog stores them. */
  const fetchLinkedItems = async (
    project: Project,
    input: { issue?: string | number; workItem?: number },
  ): Promise<LinkedItem[]> => {
    const items: LinkedItem[] = [];
    if (input.issue !== undefined) {
      const n = issueNumber(input.issue, project);
      try {
        items.push(await deps.getGithubIssue(project.path, n));
      } catch (err) {
        throw new ControlError(404, `issue #${n}: ${reasonOf(err)}`);
      }
    }
    if (input.workItem !== undefined) {
      let wi: LinkedAdoWorkItem | null;
      try {
        wi = await deps.getAdoWorkItem(project.id, input.workItem);
      } catch (err) {
        throw new ControlError(404, `work item ${input.workItem}: ${reasonOf(err)}`);
      }
      if (!wi) throw new ControlError(400, `${project.name} has no Azure DevOps connection`);
      items.push(wi);
    }
    return items;
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
      summary:
        'Get one task: its name, branch, worktree path, state, what it waits for, and its messageAddress (see `dashctl tasks wake`).',
      input: taskIdInput,
      callers: ['orchestrator', 'task'],
      cli: { args: ['taskId'] },
      readOnly: true,
      target: { taskId: 'taskId' },
      handler: async (_ctx, input) => freshView(taskOrThrow(input.taskId)),
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.create',
      summary:
        "Create a Dash task (by default a new git worktree on a new branch) and start its Claude Code session with the prompt. A linked issue or work item goes into the task's context, and its branch is linked on it, as in Dash's New Task dialog. Returns the task and session: 'started', or 'needs-trust' when a person must accept Claude Code's trust prompt for the folder in Dash first. bypassPermissions is not allowed.",
      input: z.object({
        projectId: z
          .string()
          .describe(
            'From `dashctl projects list`; an agent in a task can only use its own project',
          ),
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
            'new-branch (default): a worktree on a new branch. existing-branch: a worktree on `--branch`. in-place: run in the project folder, checking out `--branch` (default: the one checked out now).',
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
        permissionMode: permissionModeSchema.exclude(['bypassPermissions']).optional(),
        dashAccess: z
          .boolean()
          .optional()
          .describe("Let the new task's agent use Dash too (default: the project's setting)"),
        ...linkInputs,
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['name'], stdin: 'prompt' },
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
          // Else the project's default — but never bypassPermissions (one agent
          // must not start another with every permission prompt off).
          permissionMode: withoutBypass(input.permissionMode ?? defaults?.permissionMode),
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

        const linkedItems = await fetchLinkedItems(project, input);
        if (linkedItems.length > 0) createInput = { ...createInput, linkedItems };
        const result = await deps.createTask(createInput, { startSession: true, source: 'api' });
        return { task: view(result.task), session: result.session };
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.link',
      summary:
        "Link a GitHub issue or Azure DevOps work item to a task, as Dash's New Task dialog does: its content joins the task's context (re-injected on /clear and /compact, a running session's too: Dash rewrites its hook settings, which Claude Code picks up as they change; nothing is sent to the session now), and the item gets a comment naming the task's branch. Unlike the dialog, the branch isn't linked on GitHub, since that would push it. An item already linked is left as it is. Returns the task.",
      input: z.object({ taskId: z.string().describe('The task id'), ...linkInputs }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['taskId'] },
      readOnly: false,
      target: { taskId: 'taskId' },
      handler: async (_ctx, input) => {
        const task = taskOrThrow(input.taskId);
        assertNotArchived(task);
        if (input.issue === undefined && input.workItem === undefined) {
          throw new ControlError(400, 'pass --issue or --work-item');
        }
        const project = deps.getProjects().find((p) => p.id === task.projectId);
        if (!project) throw new ControlError(404, 'project not found');
        const items = await fetchLinkedItems(project, input);
        return view(await deps.linkItems(task.id, items));
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.wait',
      summary:
        'Wait until a task is idle, waiting for a person, not working, or changes state, for up to --timeout-sec seconds (max 110). Returns the task and timedOut: true when the time ran out; call again to keep waiting.',
      input: z.object({
        taskId: z.string(),
        until: z.enum(['idle', 'waiting', 'not-working', 'change']),
        timeoutSec,
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['taskId'] },
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
      name: 'tasks.watch',
      summary:
        'Watch tasks until stopped, printing a JSON line per change; meant to run in the background. Without a task id it watches every task you can see (or one project\'s with --project), and picks up new ones. First a {"event":"task","task":…} line per task with its current view (as tasks get gives it), then another whenever a task\'s view changes (state, detail, messageAddress, …), and {"event":"removed","taskId":…} when a task is archived or deleted. A task you messaged with `tasks message` since the watch started gives {"event":"reply","taskId":…,"messageId":…,"queued":…,"text":…} once it has answered (as `tasks reply` gives it). Watching one task, the stream ends after its removed line; otherwise it runs until killed or Dash quits. It ends with an {"error":…} line once your access to Dash is turned off.',
      input: z.object({
        taskId: z.string().optional().describe('Watch only this task'),
        projectId: z.string().optional().describe("Only this project's tasks"),
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['taskId'] },
      readOnly: true,
      stream: true,
      target: { taskId: 'taskId', projectId: 'projectId' },
      handler: async (ctx, input, stream) => {
        const { taskId, projectId } = input;
        if (taskId && projectId)
          throw new ControlError(400, 'give a task id or --project, not both');
        if (taskId) assertNotArchived(taskOrThrow(taskId));
        // The caller's scope now, not at the call's start: a watch outlives
        // the moment it was allowed, and ends once its access is gone.
        const read = (): Map<string, TaskView> => {
          const scope = ctx.rescope();
          const found = taskId
            ? [deps.getTask(taskId)]
            : (projectId ? [projectId] : [...scope.visibleProjectIds]).flatMap((id) =>
                deps.getTasks(id),
              );
          return new Map(
            found
              .filter((t): t is Task => !!t && t.archivedAt == null && scope.canSeeTask(t))
              .map((t) => [t.id, view(t)]),
          );
        };
        // A `reply` line when a messaged task has stopped working; only replies
        // to messages sent after the watch started (this watch's own record).
        const reported = new Set(
          [...read().keys()].flatMap((id) => taskMessages(id).map((m) => m.messageId)),
        );
        const replySource: TaskWatchSource = (watch) => {
          // One read per task at a time (else a burst of checks reads the same
          // reply twice before either marks it reported); a check arriving
          // meanwhile runs once more after it.
          const running = new Set<string>();
          const again = new Set<string>();
          const run = (id: string) => {
            if (running.has(id)) return void again.add(id);
            running.add(id);
            void replies
              .pendingReplies(id, reported)
              .then(
                (found) => {
                  for (const r of found) watch.emit({ event: 'reply', taskId: id, ...r });
                },
                (err) => console.warn('[tasks.watch] reading a reply failed:', err),
              )
              .finally(() => {
                running.delete(id);
                if (again.delete(id) && !watch.ended()) run(id);
              });
          };
          return (watched) => {
            for (const [id, task] of watched) {
              if (task.state !== 'working' && task.state !== 'waiting') run(id);
            }
          };
        };
        await watchTasks(
          {
            read,
            single: !!taskId,
            subscriptions: [deps.onActivityChange, deps.onTasksChange],
            pollMs: WATCH_POLL_MS,
            sources: [replySource],
          },
          stream,
        );
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.output',
      summary:
        "Read what a task's Claude Code session shows: the last `--lines` lines of its terminal as plain text.",
      input: z.object({
        taskId: z.string(),
        lines: z.number().int().min(1).max(400).default(100),
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['taskId'] },
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

  /** Start the task's session and wait until it is in Claude Code's registry
   *  with a socket; false when `deadline` passed first. */
  const startAndWait = async (task: Task, deadline: number): Promise<boolean> => {
    const started = await deps.startSession(task.id);
    if ('needsTrust' in started) throw new ControlError(409, view(task).detail!);
    const ready = (): boolean => !!deps.getLiveSessions().get(started.jobId)?.messagingSocketPath;
    while (!ready()) {
      if (Date.now() >= deadline) return false;
      await sleep(WAKE_POLL_MS);
    }
    return true;
  };

  registry.register(
    defineCapability({
      name: 'tasks.wake',
      summary:
        "Make sure a task's Claude Code session is running: returns at once if it is, otherwise starts it (with no message) and returns once it is up, for up to --timeout-sec seconds (max 110; timedOut: true when the time ran out, call again). To message a task, use `dashctl tasks message`, which wakes it itself. Your own SendMessage to the task's messageAddress also works, but a task whose messaging is needs-approval (bypassPermissions) holds it until a person delivers it in Dash, and a stopped task's old address fails (ENOENT). Refused while the task needs the trust prompt or is archived. A task cannot wake itself.",
      input: z.object({ taskId: z.string(), timeoutSec }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['taskId'] },
      readOnly: false,
      target: { taskId: 'taskId' },
      allowSelf: false,
      handler: async (_ctx, input) => {
        const task = taskOrThrow(input.taskId);
        assertNotArchived(task);
        const current = await freshView(task);
        if (current.state === 'needs-trust') throw new ControlError(409, current.detail!);
        // Already running: a start would be a no-op.
        if (current.messageAddress) return { task: current, timedOut: false };

        // No message: the caller's own message is the task's next turn.
        const up = await startAndWait(task, Date.now() + input.timeoutSec * 1000);
        return { task: view(taskOrThrow(task.id)), timedOut: !up };
      },
    }),
  );

  /** The inbox of the task's running session: the one reported on its live
   *  socket (another Claude Code session in the worktree reports its own). */
  const liveInbox = (taskId: string): TaskInbox | undefined => {
    const jobId = deps.getTask(taskId)?.jobId;
    const socket = jobId ? deps.getLiveSessions().get(jobId)?.messagingSocketPath : null;
    return socket ? deps.getInbox(taskId, socket) : undefined;
  };
  const waitForInbox = async (taskId: string, deadline: number): Promise<TaskInbox | undefined> => {
    for (;;) {
      const inbox = liveInbox(taskId);
      if (inbox || Date.now() >= deadline) return inbox;
      await sleep(WAKE_POLL_MS);
    }
  };

  registry.register(
    defineCapability({
      name: 'tasks.message',
      summary:
        "Send a task's Claude Code session a message (the body on stdin), as its next turn: it works for tasks in bypassPermissions too, with no Deliver click in Dash. A stopped session is started first. Returns messageId, queued and the task. Read the answer with `dashctl tasks reply <task-id> --message-id <id>` (or `dashctl tasks watch`): the task's last message of the turn the message starts is its reply. queued: true means the task was working, so its running turn reads the message after the tool call in flight and the reply may be mixed with that turn's work. Never send a message again after an error that says it may have been delivered: a message sent twice is a turn taken twice. A session whose Claude Code setting crossSessionInbound is hold or refuse sets the message aside or drops it without a word. Refused while the task needs the trust prompt or is archived. A task cannot message itself.",
      input: z.object({
        taskId: z.string(),
        text: z.string().trim().min(1).max(200_000).describe('The message body'),
        from: z
          .string()
          .trim()
          .min(1)
          .max(100)
          // eslint-disable-next-line no-control-regex
          .refine((f) => !/[\x00-\x1f\x7f\]]/.test(f), 'one line, without ]')
          .optional()
          .describe('Who the task is told the message is from (default: an orchestrator)'),
        noReply: z.boolean().optional().describe('Tell the task no reply is needed'),
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['taskId'], stdin: 'text' },
      readOnly: false,
      target: { taskId: 'taskId' },
      allowSelf: false,
      handler: async (ctx, input) => {
        const task = taskOrThrow(input.taskId);
        assertNotArchived(task);
        const current = await freshView(task);
        if (current.state === 'needs-trust') throw new ControlError(409, current.detail!);

        let inbox: TaskInbox | undefined;
        if (!current.messageAddress) {
          const deadline = Date.now() + MESSAGE_START_MS;
          if (!(await startAndWait(task, deadline))) {
            throw new ControlError(
              504,
              `${task.name}'s session did not start within ${MESSAGE_START_MS / 1000} s; nothing was sent, try again`,
            );
          }
          inbox = await waitForInbox(task.id, deadline);
          if (!inbox) {
            throw new ControlError(
              504,
              `${task.name}'s session started but reported no inbox within ${MESSAGE_START_MS / 1000} s; nothing was sent, try again`,
            );
          }
        } else {
          // A session started a moment ago may not have reported it yet.
          inbox = await waitForInbox(task.id, Date.now() + INBOX_GRACE_MS);
          if (!inbox) {
            throw new ControlError(
              409,
              `no inbox known yet for ${task.name}: run \`dashctl tasks restart ${task.id}\` (same conversation) and try again`,
            );
          }
        }

        const queued = view(taskOrThrow(task.id)).state === 'working';
        const messageId = `m_${randomBytes(4).toString('hex')}`;
        const sender = ctx.caller.kind === 'task' ? deps.getTask(ctx.caller.taskId) : undefined;
        const from =
          input.from ?? (sender ? `task "${sender.name}" (${sender.id})` : 'an orchestrator');
        const noReply = input.noReply === true;
        const text = `${messageHeader({ from, messageId, noReply })}\n\n${input.text}`;
        try {
          await deps.postToInbox(inbox, text);
        } catch (err) {
          deps.dropInbox(task.id, inbox.socket);
          const reason = reasonOf(err);
          if (err instanceof InboxWriteError && err.delivered === 'no') {
            throw new ControlError(502, `${reason}; nothing was sent`);
          }
          throw new ControlError(
            502,
            `${reason}. It may have been delivered: don't send it again, check \`dashctl tasks output ${task.id}\``,
          );
        }
        recordTaskMessage(task.id, {
          messageId,
          sentAt: Date.now(),
          queued,
          noReply,
          transcriptPath: inbox.transcriptPath,
        });
        return { messageId, queued, task: view(taskOrThrow(task.id)) };
      },
    }),
  );

  const replies = createReplyReader(deps);

  registry.register(
    defineCapability({
      name: 'tasks.reply',
      summary:
        "Read a task's reply to a message sent with `dashctl tasks message`: its last message of the turn the message started. status is done once the task has stopped working and has answered, else pending (text is what it has written so far, or null). Message ids are kept in memory until Dash restarts.",
      input: z.object({
        taskId: z.string(),
        messageId: z.string().describe('From `dashctl tasks message`'),
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['taskId'] },
      readOnly: true,
      target: { taskId: 'taskId' },
      handler: async (_ctx, input) => {
        const task = taskOrThrow(input.taskId);
        const record = findTaskMessage(task.id, input.messageId);
        if (!record) {
          throw new ControlError(
            404,
            `no message ${input.messageId} to ${task.name}: message ids are kept in memory until Dash restarts`,
          );
        }
        const reply = await replies.replyTo(task, record);
        return { messageId: record.messageId, queued: record.queued, ...reply };
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'tasks.open',
      summary: "Bring Dash's window to the front with the task open, for a person to look at.",
      input: taskIdInput,
      callers: ['orchestrator', 'task'],
      cli: { args: ['taskId'] },
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
      cli: { args: ['taskId'] },
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
      cli: { args: ['taskId'] },
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
      cli: { args: ['taskId'] },
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
      cli: { args: ['taskId'] },
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

/** What tasks.reply and the watch's reply lines read the transcript with. */
type ReplyDeps = Pick<
  TaskCapabilityDeps,
  | 'getTask'
  | 'getActivity'
  | 'getUntrustedRoot'
  | 'getLiveSessions'
  | 'transcriptPathFor'
  | 'readTranscript'
>;

export interface MessageReply {
  status: 'pending' | 'done';
  text: string | null;
}

/**
 * Replies to messages sent with tasks.message, read from the task's
 * transcript. `pendingReplies` is for a watch: call it when a task stops
 * working, with that watch's own set of message ids already reported; it
 * returns each reply that is done and not in the set (messages sent with
 * noReply are left out), and adds it to the set.
 */
export function createReplyReader(deps: ReplyDeps) {
  const replyTo = async (
    task: Task,
    record: { messageId: string; transcriptPath: string | null },
  ): Promise<MessageReply> => {
    const file = record.transcriptPath ?? deps.transcriptPathFor(task);
    const jsonl = file ? await deps.readTranscript(file) : null;
    const { text } = jsonl ? replyAfterMessage(jsonl, record.messageId) : { text: null };
    const state = toTaskView(
      task,
      deps.getActivity(),
      deps.getUntrustedRoot,
      deps.getLiveSessions(),
    ).state;
    // Waiting for a person is a turn not finished yet.
    const done = text !== null && state !== 'working' && state !== 'waiting';
    return { status: done ? 'done' : 'pending', text };
  };

  const pendingReplies = async (
    taskId: string,
    reported: Set<string>,
  ): Promise<Array<{ messageId: string; queued: boolean; text: string }>> => {
    const task = deps.getTask(taskId);
    if (!task) return [];
    const out: Array<{ messageId: string; queued: boolean; text: string }> = [];
    for (const record of taskMessages(taskId)) {
      if (record.noReply || reported.has(record.messageId)) continue;
      const reply = await replyTo(task, record);
      if (reply.status !== 'done') continue;
      reported.add(record.messageId);
      out.push({ messageId: record.messageId, queued: record.queued, text: reply.text! });
    }
    return out;
  };

  return { replyTo, pendingReplies };
}
