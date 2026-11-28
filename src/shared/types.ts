import type { TaskEffort } from './effort';
import type { ReviewVerdict } from './prVerdict';

export type { TaskEffort } from './effort';

export interface Project {
  id: string;
  name: string;
  path: string;
  isGitRepo: boolean;
  gitRemote: string | null;
  gitBranch: string | null;
  baseRef: string | null;
  /** Set while archived: out of the project list, its task sessions asleep. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type IssueProvider = 'github' | 'ado';

export interface LinkedGithubIssue {
  provider: 'github';
  id: number;
  title: string;
  url: string;
  labels?: string[];
  body?: string;
}

export interface LinkedAdoWorkItem {
  provider: 'ado';
  id: number;
  title: string;
  url: string;
  type: string;
  state: string;
  tags?: string[];
  description?: string;
  acceptanceCriteria?: string;
  parents?: AzureDevOpsWorkItemRef[];
}

export type LinkedItem = LinkedGithubIssue | LinkedAdoWorkItem;

/**
 * Permission strategy passed to Claude CLI when a task PTY is spawned.
 * - `default`: prompt for every tool use (--permission-mode default)
 * - `acceptEdits`: auto-accept file edits, still prompt for shell (--permission-mode acceptEdits)
 * - `auto`: Claude Code's auto mode, a classifier approves safe actions (--permission-mode auto)
 * - `bypassPermissions`: skip all permission prompts (--dangerously-skip-permissions)
 */
export const PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'bypassPermissions'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.includes(value as PermissionMode);
}

/**
 * The mode a running session reports in its hook payloads (`permission_mode`,
 * hooks reference "Common input fields"): Dash's modes plus the two a session
 * can be in without Dash starting it there (`plan` via Shift+Tab, `dontAsk`).
 * It can differ from the task's own mode: the user cycled it in the session,
 * or a policy refused bypass and the session fell back.
 */
export const SESSION_PERMISSION_MODES = [
  'default',
  'plan',
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
] as const;
export type SessionPermissionMode = (typeof SESSION_PERMISSION_MODES)[number];

export function isSessionPermissionMode(value: unknown): value is SessionPermissionMode {
  return SESSION_PERMISSION_MODES.includes(value as SessionPermissionMode);
}

/**
 * Whether a task can be switched to bypassPermissions, from Claude Code's
 * settings files. `disabled`: `permissions.disableBypassPermissionsMode` is
 * `"disable"` in some file (`managed` when an organization set it). `not-accepted`:
 * nobody accepted Claude Code's bypass warning in user or managed settings
 * (`skipDangerousModePermissionPrompt`), and `claude --bg` refuses bypass without it.
 */
export type BypassAvailability =
  | { available: true }
  | { available: false; reason: 'disabled'; managed: boolean }
  | { available: false; reason: 'not-accepted' };

/**
 * Which Claude model a task's `claude` session starts with. 'default' omits the
 * `--model` flag entirely so the user's own Claude Code config decides; the rest
 * map to the CLI's model aliases (`--model opus|sonnet|haiku|fable`).
 */
export const TASK_MODELS = ['default', 'opus', 'sonnet', 'haiku', 'fable'] as const;
export type TaskModel = (typeof TASK_MODELS)[number];

/**
 * Lifecycle state of a task row. `idle` is the DB default; `active` is set when
 * a worktree is created. Archival is tracked separately via `archivedAt`, not a
 * status value. Legacy/unknown values are normalized to `idle` on read.
 */
export type TaskStatus = 'idle' | 'active';

export interface Task {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  path: string;
  status: TaskStatus;
  useWorktree: boolean;
  permissionMode: PermissionMode;
  /** Model the task's `claude` session starts with. 'default' = respect the
   *  user's own Claude Code config (no `--model` flag). */
  model: TaskModel;
  branchCreatedByDash: boolean;
  linkedItems: LinkedItem[] | null;
  contextPrompt: string | null;
  /** Worktree path before the 0.16 move to `<repo>/.claude/worktrees/`; null
   *  when the task was never moved. Claude transcripts written before the move
   *  live under this path's encoded dir. */
  previousPath: string | null;
  /** Short id of the task's session under Claude Code's supervisor (`claude
   *  agents --json` `id`); null until the first dispatch. */
  jobId: string | null;
  /** Claude session UUID of that job; used for `--bg --resume` re-dispatches. */
  sessionId: string | null;
  /** Set when Dash or the supervisor stopped the session (archive, idle stop). */
  sessionStoppedAt: string | null;
  archivedAt: string | null;
  /** Whether the task's session can reach Dash with dashctl (control API). */
  dashAccess: boolean;
  /** The person's own `claude` flags for the session, as typed (shell
   *  quoting, no expansion); null when none. Checked by validateExtraArgs. */
  extraArgs: string | null;
  /** Extra folders the session may read and edit (`--add-dir`), full paths. */
  addDirs: string[];
  /** `--effort` for the session; null → Settings → Claude's default. */
  effort: TaskEffort | null;
  /** The custom agent the session runs as (`--agent`); null for none. Fixed at creation. */
  agent: string | null;
  /** The task's own env vars for its session, over Settings → Claude's and
   *  under Dash's own (buildSessionEnv); {} for none. Checked by taskEnv.ts. */
  env: Record<string, string>;
  /** Deny a tool call that would wait on a permission prompt, instead of
   *  waiting (`permissions.denyInsteadOfPrompting` in the task's settings file). */
  denyInsteadOfPrompting: boolean;
  /** The task that created this one through the control API; null when a
   *  person created it. Fixed at creation. */
  parentTaskId: string | null;
  /** Pinned to the top of the sidebar's task list, asleep or not. */
  favorite: boolean;
  /** Agents can't archive or delete it (dashctl); a person can, after a confirm. */
  protected: boolean;
  sortOrder: number;
  totalTokens: number;
  totalCostUsd: number;
  tokensBackfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Task creation modes. Each variant carries only the fields that are meaningful
 * for that mode — `baseRef` is a full ref (`origin/main`) for new-branch worktree
 * creation; `branch` is a plain branch name for existing-branch flows. The
 * discriminator stops impossible combinations (e.g. `pushRemote` on a non-worktree
 * task) from reaching the create handler.
 */
export type CreateTaskOptions = {
  name: string;
  permissionMode: PermissionMode;
  model: TaskModel;
  linkedItems?: LinkedItem[];
  /** Context for the agent: submitted with the first message and persisted, so
   *  the SessionStart hook re-injects it after /clear and /compact. */
  contextPrompt?: string;
  /** A one-shot instruction submitted as (the end of) the first message and
   *  never persisted, so /clear and /compact don't re-run it. The control API's
   *  `prompt`; the task dialog doesn't use it. */
  initialPrompt?: string;
  /** undefined → project taskDefaults.dashAccess → false. Resolved only in TaskService.create. */
  dashAccess?: boolean;
  /** Extra `claude` flags, as typed. undefined → the project's default from
   *  `.dash/config.local.json`. Resolved only in TaskService.create. */
  extraArgs?: string;
  /** `--add-dir` folders. undefined → the project's default from
   *  `.dash/config.local.json`. Resolved only in TaskService.create. */
  addDirs?: string[];
  /** null/undefined → Settings → Claude's default at each start. */
  effort?: TaskEffort | null;
  /** `--agent` name (listAgents); fixed for the task's life. */
  agent?: string | null;
  /** The task's own env vars (Task.env); undefined → none. */
  env?: Record<string, string>;
  denyInsteadOfPrompting?: boolean;
  /** Task.protected; undefined → not protected. */
  protected?: boolean;
} & (
  | { kind: 'worktree-new-branch'; baseRef: string; pushRemote: boolean }
  | { kind: 'worktree-existing'; branch: string; updateFromRemote?: boolean }
  | { kind: 'in-place-checkout'; branch: string; updateFromRemote?: boolean }
  | { kind: 'in-place-no-git' }
);

/** Input to `TaskService.create` (main), shared by the task dialog and the control API. */
export type CreateTaskInput = CreateTaskOptions & {
  projectId: string;
  parentTaskId?: string | null;
};

/** `task:setDashAccess`: turn a task's Dash access on or off (applies at its next session start). */
export type SetTaskDashAccessInput = { taskId: string; enabled: boolean };

/**
 * `task:setLaunchOptions`: change how a task's session is launched (the flags
 * besides mode and model). Only the keys given change; a running session
 * picks them up when it restarts (changeSessionSetting does that).
 */
export type TaskLaunchOptions = Pick<
  Task,
  'extraArgs' | 'addDirs' | 'effort' | 'env' | 'denyInsteadOfPrompting'
>;
export type SetTaskLaunchOptionsInput = { taskId: string } & Partial<TaskLaunchOptions>;

/** `task:setFavorite`: pin a task to the top of the sidebar's task list, or unpin it. */
export type SetTaskFavoriteInput = { taskId: string; favorite: boolean };

/** `task:setProtected`: keep agents from archiving or deleting a task, or let them again. */
export type SetTaskProtectedInput = { taskId: string; protected: boolean };

/**
 * The ways another Claude Code session's SendMessage can reach a task's live
 * session. Both die with the session: a restart gets a new socket.
 */
export interface TaskMessageAddresses {
  /** `name [ref]`, the form ListAgents prints; the ref tells same-named sessions apart. */
  ref: string;
  /** `uds:<socket>`, what dashctl's `messageAddress` returns. */
  uds: string;
}

/** A task's `dashctl tasks notify` that no watch of its sender took: Dash holds it
 *  for the sender's next watch and shows it to the person. */
export interface HeldTaskNotice {
  taskId: string;
  projectId: string;
  taskName: string;
  text: string;
}

/** What `app:getControlInfo` reports for the Settings orchestrator row. */
export type ControlInfo = {
  /** `dashctl`, the command line other agents reach Dash with. */
  dashctlPath: string;
  /** False on win32: dashctl is a shell script, so the control API never starts. */
  supported: boolean;
};

/** How `TaskService.create` runs: who asked, and whether it starts the session
 *  itself (the API) or leaves that to the pane that mounts next (the UI). */
export type CreateTaskRunOptions = { startSession: boolean; source: 'ui' | 'api' };

export type CreateTaskResult = { task: Task; session: 'deferred' | 'started' | 'needs-trust' };

/** What a task delete removes besides the task row. Branch deletes only apply
 *  to branches Dash created; a missing flag means "keep". */
export interface DeleteTaskOptions {
  deleteWorktreeDir?: boolean;
  deleteLocalBranch?: boolean;
  deleteRemoteBranch?: boolean;
}

/** One legacy-layout task the launch dialog offers to move. */
export interface WorktreeMigrationTask {
  taskId: string;
  taskName: string;
  branch: string;
  archived: boolean;
  fromPath: string;
  toPath: string;
  /** The legacy directory exists but is no longer a git worktree (no `.git`
   *  inside — git pruned or removed it and only leftovers remain). Nothing to
   *  move; the dialog offers to remove the task instead. */
  stale: boolean;
}

/** Per-project group of the migration plan (only projects with legacy tasks). */
export interface WorktreeMigrationProject {
  projectId: string;
  projectName: string;
  projectPath: string;
  legacyDir: string;
  targetDir: string;
  tasks: WorktreeMigrationTask[];
}

export interface WorktreeMigrationResult {
  projectId: string;
  moved: string[];
  /** Stale tasks deleted (row + leftover directory) at the user's request. */
  removed: string[];
  failed: Array<{ taskId: string; taskName: string; error: string }>;
}

export interface Conversation {
  id: string;
  taskId: string;
  title: string;
  isActive: boolean;
  isMain: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TokenStatsRollup {
  totalTokens: number;
  totalCostUsd: number;
  taskCount: number;
}

/**
 * Machine-readable error category on a failed IpcResponse, so the renderer can
 * branch on the kind of failure instead of pattern-matching the message string.
 * - `VALIDATION`: arguments failed the handler's zod schema (a renderer bug).
 * - `NOT_FOUND`: the referenced entity (task, file, branch, commit…) is missing.
 * - `UNSUPPORTED_CLI`: the Claude Code CLI is missing or older than the floor
 *   Dash requires (`MIN_CLAUDE_VERSION`); the renderer shows the upgrade panel
 *   instead of falling back to a shell.
 * - `UNTRUSTED_WORKSPACE`: Claude Code refused to start a background session
 *   because its workspace trust prompt was never accepted for the folder; the
 *   pane shows that prompt (`ptyTrustWorkspace`) and starts again.
 * - `UNTRUSTED_ADD_DIR`: the same, for a folder the task adds (`--add-dir`);
 *   `data.folder` names it. The pane offers the same prompt, in that folder.
 * - `CONFLICT`: a conditional write found the row changed (or gone) since the
 *   version it named; `data` holds the current row, if any.
 * - `UNKNOWN`: any other caught error (the default).
 */
export type IpcErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'UNSUPPORTED_CLI'
  | 'UNTRUSTED_WORKSPACE'
  | 'UNTRUSTED_ADD_DIR'
  /** The caller cancelled the request (`lsp:cancel`). */
  | 'CANCELLED'
  /** The language server for the document isn't installed or has failed. */
  | 'UNAVAILABLE'
  /** A file read was given a directory. */
  | 'IS_DIRECTORY'
  | 'CONFLICT'
  | 'UNKNOWN';

/** Result of the startup `claude --version` probe, as exposed to the renderer. */
export interface ClaudeCliInfo {
  installed: boolean;
  version: string | null;
  path: string | null;
  /** Oldest Claude Code Dash runs task sessions on. */
  minVersion: string;
  /** False when missing or below `minVersion`; `unsupportedReason` says why. */
  supported: boolean;
  unsupportedReason: string | null;
}

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Present on failures (`success: false`); absent on success. */
  code?: IpcErrorCode;
}

export interface WorktreeInfo {
  id: string;
  name: string;
  branch: string;
  path: string;
  projectId: string;
  status: 'active' | 'error';
  createdAt: string;
}

export interface RemoveWorktreeOptions {
  deleteWorktreeDir?: boolean;
  deleteLocalBranch?: boolean;
  deleteRemoteBranch?: boolean;
}

export interface PtyOptions {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  permissionMode?: PermissionMode;
}

export interface TerminalSnapshot {
  version: 1;
  createdAt: string;
  cols: number;
  rows: number;
  data: string;
}

// ── Context Usage Types ─────────────────────────────────────

export interface ContextUsage {
  used: number;
  total: number;
  /** Always equals Math.min(100, Math.max(0, total > 0 ? (used / total) * 100 : 0)).
   *  Pre-computed for rendering convenience; derived from used/total at creation time. */
  percentage: number;
}

export interface SessionCost {
  totalCostUsd: number;
  totalDurationMs: number;
  totalApiDurationMs: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
}

export interface RateLimitInfo {
  usedPercentage: number;
  /** When this rate limit window resets. Epoch seconds (NOT milliseconds). */
  resetsAt: number;
  /** The account hit this limit (`UsageLimitHit`): it reads full until it resets. */
  reached?: true;
}

export interface RateLimits {
  fiveHour?: RateLimitInfo;
  sevenDay?: RateLimitInfo;
}

/**
 * A usage limit the account has hit (a StopFailure `rate_limit`), held in
 * main until the window resets, auto-resume fires or a turn succeeds.
 */
export interface UsageLimitHit {
  /** The window that was hit; null when Dash can't tell (a "usage limit"). */
  limit: keyof RateLimits | null;
  /** When it resets, epoch seconds; 0 when unknown. */
  resetsAt: number;
  /** When it was hit, epoch ms. */
  hitAt: number;
}

export interface StatusLineData {
  contextUsage: ContextUsage;
  cost?: SessionCost;
  rateLimits?: RateLimits;
  model?: string;
  updatedAt: number; // epoch ms
}

export interface UsageThresholds {
  /** Warn when context window usage exceeds this percentage (0-100), or null to disable. */
  contextPercentage: number | null;
  /** Warn when 5-hour rate limit usage exceeds this percentage (0-100), or null to disable. */
  fiveHourPercentage: number | null;
  /** Warn when 7-day rate limit usage exceeds this percentage (0-100), or null to disable. */
  sevenDayPercentage: number | null;
}

// ── Activity Types ──────────────────────────────────────────

/** `stopped`: the supervisor parked the session (idle timer, `claude stop`,
 *  machine restart); attaching resumes it. */
export type ActivityState = 'busy' | 'idle' | 'waiting' | 'error' | 'stopped';

/** Human-readable label for the current tool, derived from PreToolUse hook data. */
export interface ToolActivity {
  /** Raw tool name from Claude Code (e.g. "Bash", "Edit", "Grep", "Agent"). */
  toolName: string;
  /** Short human-readable description (e.g. "Running command", "Editing main.ts"). */
  label: string;
  /** What the call acts on, cut short: a Bash command, a file path, a URL,
   *  else its input as JSON (toolInputSummary). Absent when it had none. */
  input?: string;
}

/**
 * Why a turn ended on an API error: the `error` values Claude Code's
 * StopFailure hook documents (code.claude.com/docs/en/hooks), verbatim.
 */
export const STOP_FAILURE_ERRORS = [
  'rate_limit',
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'billing_error',
  'invalid_request',
  'model_not_found',
  'server_error',
  'max_output_tokens',
  'cloud_credential_error',
  'unknown',
] as const;

export type StopFailureError = (typeof STOP_FAILURE_ERRORS)[number];

export interface ActivityError {
  /** A StopFailure's error, or `supervisor` for a failed session row. */
  type: StopFailureError | 'supervisor';
  message?: string;
}

/** Rich activity info emitted to the renderer for each PTY. */
export interface ActivityInfo {
  state: ActivityState;
  /** Current tool being executed (set by PreToolUse, cleared by PostToolUse/Stop). */
  tool?: ToolActivity;
  /** Error details when state is 'error'. */
  error?: ActivityError;
  /** True while Claude Code is compacting context. */
  compacting?: boolean;
  /** What a `waiting` task waits for, or why a `stopped` one sleeps (not shown: sleeping tasks get no dot). */
  detail?: string;
  /** An `idle` the user brought about by interrupting the turn (Esc, Ctrl+C):
   *  seen by definition, so it isn't flagged unseen or chimed for. */
  interrupted?: true;
  /** The mode the session last reported (the main agent's hooks), when it has. */
  permissionMode?: SessionPermissionMode;
}

/** When a task's session last spoke, and since when it waits; epoch ms, null when not known. */
export interface ActivityTiming {
  /** The last hook from the session (a prompt, a tool call, a turn's end). */
  lastActiveAt: number | null;
  /** When the current wait began; null unless the task waits. */
  waitingSince: number | null;
}

/** Why the renderer puts a task's session to sleep (`session_slept.reason`):
 *  a person's "Put to sleep" or "Sleep idle tasks", or the auto-sleep setting. */
export type RendererSleepReason = 'manual' | 'auto_sleep';

// ── Claude Code session supervisor ─────────────────────────────

/** `state` column of `claude agents --json`. */
export type SupervisorState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped';
/** `status` column of `claude agents --json`, present while the process is alive. */
export type SupervisorStatus = 'busy' | 'waiting' | 'idle';

/** One row of `claude agents --json`. Unknown fields are dropped; fields the
 *  research-preview CLI may rename degrade to `undefined`, never throw. */
export interface SupervisorSession {
  /** Short job id (first 8 hex chars of `sessionId`); absent for interactive sessions. */
  id?: string;
  sessionId?: string;
  name?: string;
  cwd: string;
  kind: 'interactive' | 'background';
  startedAt: number;
  state?: SupervisorState;
  status?: SupervisorStatus;
  waitingFor?: string;
  pid?: number;
  /** Model-written one-line summary of what the session is doing. */
  detail?: string;
}

// ── Branch Types ─────────────────────────────────────────────

export interface BranchInfo {
  name: string; // "main", "develop"
  ref: string; // "origin/main", "origin/develop"
  shortHash: string; // "a1b2c3d"
  relativeDate: string; // "2 days ago"
  // Present iff the branch tracks a remote and we successfully measured.
  // Both fields move together — never one without the other.
  upstream?: { ahead: number; behind: number };
  // True when this branch is currently checked out in the primary repo or any
  // worktree. Git refuses a second worktree on an already-checked-out branch, so
  // the New Task modal steers worktree-existing away from these.
  checkedOut?: boolean;
  // The worktree holding it (the project path itself for the primary checkout),
  // so the modal can say *who* has the branch instead of a bare "in use".
  checkedOutPath?: string;
}

// ── Git Types ────────────────────────────────────────────────

export type FileChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'
  // Gitignored — only surfaced in the diff-editor tree when the user opts in via
  // the "show ignored" toggle. Never produced by `git status`; synthesized for
  // display. Not counted as a "changed" file.
  | 'ignored';

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  staged: boolean;
  additions: number;
  deletions: number;
  oldPath?: string; // For renames
}

export interface GitStatus {
  branch: string | null;
  /** HEAD's commit, detached or not; null before the first commit. */
  headSha: string | null;
  hasUpstream: boolean;
  /** The branch the checkout tracks, when its remote-tracking ref exists
   *  (the branch is on the remote as far as the last fetch knows). */
  upstream: GitUpstream | null;
  ahead: number;
  behind: number;
  files: FileChange[];
}

/** A commit's pages on its forge; null where there is none (not pushed, an
 *  author the forge doesn't know, a host Dash can't link to). */
export interface CommitLinks {
  commitUrl: string | null;
  authorUrl: string | null;
}

/** Which commits the checkout and its upstream don't share. */
export interface UpstreamCommits {
  /** HEAD's commits the upstream lacks, newest first. */
  unpushed: string[];
  /** The upstream's tip; null without an upstream. */
  upstreamHead: string | null;
}

/** A tracked remote branch: `origin` + `feat/x` (shown as `origin/feat/x`). */
export interface GitUpstream {
  remote: string;
  branch: string;
}

export interface DiffResult {
  filePath: string;
  hunks: DiffHunk[];
  isBinary: boolean;
  additions: number;
  deletions: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

// ── Commit Graph Types ──────────────────────────────────────

export interface CommitRef {
  name: string;
  type: 'local' | 'remote' | 'tag' | 'head';
}

export interface CommitNode {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorDate: number;
  subject: string;
  refs: CommitRef[];
}

export interface GraphConnection {
  fromColumn: number;
  toColumn: number;
  fromRow: number;
  toRow: number;
  color: number;
  type: 'straight' | 'merge-in' | 'merge-out';
}

export interface GraphCommit {
  commit: CommitNode;
  lane: number;
  laneColor: number;
  connections: GraphConnection[];
}

export interface CommitGraphData {
  commits: GraphCommit[];
  totalCount: number;
  maxLanes: number;
}

export interface CommitDetail {
  commit: CommitNode;
  body: string;
  stats: { additions: number; deletions: number; filesChanged: number };
}

// ── GitHub Types ────────────────────────────────────────────

export interface GithubIssue {
  number: number;
  title: string;
  labels: string[];
  state: string;
  body: string;
  url: string;
  assignees?: string[];
}

// ── Azure DevOps Types ─────────────────────────────────────

export interface AzureDevOpsWorkItemRef {
  id: number;
  title: string;
  type: string;
  state: string;
  url: string;
}

export interface AzureDevOpsWorkItem {
  id: number;
  title: string;
  state: string;
  type: string;
  url: string;
  assignedTo?: string;
  tags?: string[];
  description?: string;
  acceptanceCriteria?: string;
  parents?: AzureDevOpsWorkItemRef[];
}

export interface AzureDevOpsConfig {
  organizationUrl: string;
  project: string;
  pat: string;
}

// ── Pull Request Types ──────────────────────────────────────

export type PullRequestState = 'open' | 'merged' | 'closed';

/** A PR's combined checks: any failure fails it, then any still running. */
export type CiState = 'passing' | 'failing' | 'pending';

/** Where a PR lives. */
export type PrProvider = 'github' | 'ado';

/** Which PR: its provider and number. */
export interface PrRef {
  provider: PrProvider;
  number: number;
}

/** A review's outcome. GitHub offers comment / approve / request_changes; ADO's
 *  vote adds approve_with_suggestions / wait_for_author / reject. */
export type PrVerdict =
  | 'comment'
  | 'approve'
  | 'request_changes'
  | 'approve_with_suggestions'
  | 'wait_for_author'
  | 'reject';

/** A reaction on a PR comment: GitHub's eight, or ADO's one, a like. */
export type PrReactionContent =
  | 'THUMBS_UP'
  | 'THUMBS_DOWN'
  | 'LAUGH'
  | 'HOORAY'
  | 'CONFUSED'
  | 'HEART'
  | 'ROCKET'
  | 'EYES'
  | 'LIKE';

/** One reaction on a comment: how many gave it, and whether the viewer did. */
export interface PrReaction {
  content: PrReactionContent;
  count: number;
  viewerReacted: boolean;
}

/** One comment in a PR review thread, or a general PR comment. */
export interface PrReviewComment {
  id: string;
  author: string;
  /** The author's page on the forge; null where it has none (ADO). */
  authorUrl: string | null;
  body: string;
  createdAt: string;
  url: string;
  /** Reactions someone gave (count > 0), in the forge's order. */
  reactions: PrReaction[];
}

/** A review thread on a PR, anchored to a file and line. */
export interface PrReviewThread {
  id: string;
  path: string;
  /** Last line of the commented range (in the PR head's file for RIGHT, the base's
   *  for LEFT); null once outdated, or for a comment on the whole file. */
  line: number | null;
  /** First line of a multi-line comment, else null. */
  startLine: number | null;
  /** RIGHT: the PR's version of the file; LEFT: the base's (a removed line). */
  side: 'LEFT' | 'RIGHT';
  /** The lines it was left on have changed since. */
  isOutdated: boolean;
  resolved: boolean;
  comments: PrReviewComment[];
}

/** Where a PR stands on its forge. */
export type PrState = 'open' | 'draft' | 'merged' | 'closed';

/** A reviewer and where their review stands. GitHub's states are approved /
 *  changes_requested / commented / pending; ADO's vote adds
 *  approved_with_suggestions / waiting / rejected. */
export interface PrReviewer {
  name: string;
  /** Their page on the forge; null where it has none (ADO). */
  url: string | null;
  state:
    | 'approved'
    | 'changes_requested'
    | 'commented'
    | 'pending'
    | 'approved_with_suggestions'
    | 'waiting'
    | 'rejected';
  /** Their review is required to merge (ADO's required reviewer). GitHub
   *  doesn't say per reviewer: code owners and branch protection decide. */
  required?: true;
  /** They declined to review (ADO); GitHub has no such answer. */
  declined?: true;
  /** A group or team asked to review, not one person. */
  group?: true;
}

/** The person's own latest review of a PR (GitHub's review, ADO's vote). */
export interface PrViewerReview {
  /** What it said: on GitHub an approval or change request outlasts a
   *  later plain comment, as on the forge. */
  state: Exclude<PrReviewer['state'], 'pending'>;
  /** When, ISO 8601; '' when the forge doesn't say. */
  at: string;
  /** Commits have landed on the PR since. */
  stale: boolean;
}

/** One CI check on a PR's head. */
export interface PrCheck {
  name: string;
  state: 'passing' | 'failing' | 'pending' | 'skipped';
  url: string | null;
}

/** A file the PR changes (base..head), from local git. */
export interface PrFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  /** A rename's path at base. */
  oldPath?: string;
  additions: number;
  deletions: number;
  /** Its blob id at head; null once deleted. What a viewed mark is checked against. */
  blob: string | null;
}

/** An issue linked to a PR: one it closes (GitHub), or a linked work item (ADO). */
export interface PrIssue {
  number: number;
  title: string;
  url: string;
}

/** What a forge offers beyond the shared model, so a caller asks the
 *  forge's facts instead of naming the forge. The same for every PR on it. */
export interface ForgeCapabilities {
  /** The reactions a comment takes, in the forge's order: GitHub's eight, ADO's like. */
  reactions: readonly PrReactionContent[];
  /** How a reply to a general comment posts: `quote` where the conversation
   *  isn't threaded (GitHub: a new comment quoting it), `thread` where each
   *  general comment is a thread (ADO). */
  generalReply: 'quote' | 'thread';
  /** What a task links to: GitHub issues or ADO work items. */
  linkedItems: 'issues' | 'workItems';
}

/** A PR's review: all its threads and general comments, with the commits its diff spans. */
export interface PrReview {
  provider: PrProvider;
  /** What its forge offers (see ForgeCapabilities). */
  capabilities: ForgeCapabilities;
  number: number;
  title: string;
  /** The PR's description, in Markdown. */
  body: string;
  url: string;
  /** GitHub refuses approve / request changes on your own PR. */
  viewerIsAuthor: boolean;
  /** You're asked to review it and haven't yet. */
  viewerIsRequestedReviewer: boolean;
  /** You're among its assignees; false on ADO, which has none. */
  viewerIsAssignee: boolean;
  /** You've left a comment on it: in a thread or its conversation. */
  viewerCommented: boolean;
  /** The verdicts this provider offers, in display order. */
  verdicts: PrVerdict[];
  /** Merge-base of the PR's base and head: the left side of its diff. */
  base: string;
  head: string;
  /** File threads, resolved or not. */
  threads: PrReviewThread[];
  /** General PR comments and review summaries, oldest first. */
  conversation: PrReviewComment[];
  /** The provider had more threads than were loaded. */
  partial?: boolean;
  author: string;
  /** The author's page on the forge; null where it has none (ADO). */
  authorUrl: string | null;
  /** When the PR was opened, ISO 8601; '' when the forge doesn't say. */
  createdAt: string;
  /** Its latest activity, ISO 8601: GitHub's `updatedAt`; on ADO the newest of
   *  its creation, close, iterations (pushes) and threads (comments, votes). */
  lastActivityAt: string;
  state: PrState;
  /** Branch names, without `refs/heads/`. */
  baseRef: string;
  headRef: string;
  /** Commits in base..head. */
  commits: number;
  /** Commits on the base branch's tip not in head; null when `origin/<baseRef>`
   *  can't be resolved locally. */
  behindBase: number | null;
  reviewers: PrReviewer[];
  /** The person's own latest review; null when they haven't reviewed it. */
  viewerReview: PrViewerReview | null;
  /** [] on ADO, which has none. */
  assignees: string[];
  /** The issues it closes (GitHub) or its linked work items (ADO). */
  issues: PrIssue[];
  checks: PrCheck[];
  files: PrFile[];
}

/** The fields of a PrReview that take local git: the merge-base its diff
 *  starts from, its files, its commit count and how far behind base it is. */
export type PrGitField = 'base' | 'files' | 'commits' | 'behindBase';

/** A review thread as its forge alone tells it: `isOutdated` is null where
 *  only local git can tell (ADO, whose `line` is then where ADO tracked it). */
export type PrDetailsThread = Omit<PrReviewThread, 'isOutdated'> & { isOutdated: boolean | null };

/** A PR's review as its forge alone tells it, read without a git call (the
 *  project's PR list): the git-derived fields aren't in the type, so they
 *  can't be read off it. `head` is the forge's head commit, which needn't be
 *  in any checkout. */
export type PrDetails = Omit<PrReview, PrGitField | 'threads'> & { threads: PrDetailsThread[] };

/** A task's draft summary for a PR: the review's PR-level comment. */
export interface PrReviewSummary {
  body: string;
  author: 'user' | 'agent';
  /** When it was last written; absent on a write. */
  updatedAt?: string;
}

/** What a submit sends: the verdict, its summary, and the task's drafts for the PR. */
export interface PrSubmission {
  verdict: PrVerdict;
  body: string;
  /** New threads, on the PR's (RIGHT) side. */
  comments: { draftId: string; path: string; startLine: number; endLine: number; body: string }[];
  replies: { draftId: string; threadId: string; body: string }[];
}

/** Why a write to the PR failed. `scope`: the token can't write; `fix` says how to grant it. */
export type PrWriteError =
  | { kind: 'scope'; fix: string }
  | { kind: 'pending-review' }
  | { kind: 'other'; message: string };

/** The drafts that reached the PR (their rows are deleted), and the error that stopped the rest. */
export interface SubmitResult {
  postedDraftIds: string[];
  error?: PrWriteError;
  /** Line comments written on an older head of the PR, kept as drafts instead
   *  of being posted on code they weren't written about. */
  heldBackDraftIds?: string[];
}

export interface PullRequestInfo {
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  provider: 'github' | 'ado';
  /** The PR's last commit, to tell whether the branch has moved past it. */
  headSha?: string;
  /** Open PRs only; null when it has no checks. */
  ci?: CiState | null;
  /** Stands for its branch now (see relevantPrs); the others are its history. */
  current?: boolean;
}

/**
 * A pull request as surfaced by the "From PR" task quick-start. Unlike
 * PullRequestInfo (a per-branch lookup for the PR badge), this carries the
 * head branch + author needed to start a task on the PR. `number` is the gh
 * PR number / ADO pullRequestId; `headRefName` (the source, "from") and
 * `baseRefName` (the target, "against") are plain branch names (ADO's
 * refs/heads/ prefix already stripped).
 */
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  author: string;
  headRefName: string;
  baseRefName: string;
  provider: 'github' | 'ado';
  /** Its head is in a fork: a same-named branch there isn't this repo's. */
  fromFork: boolean;
}

/** Narrows a PR listing to those from (`head`) or into (`base`) a branch. */
export interface PrListFilter {
  head?: string;
  base?: string;
}

/** A relevant PR as the PRs view lists it: the listing's PR, plus what the
 *  forge answers in the same call. A fact the forge's listing doesn't carry
 *  is null (ADO lists no update time, line counts, threads or checks). */
export interface RelevantPr extends PullRequest {
  draft: boolean;
  /** ISO 8601. */
  updatedAt: string | null;
  additions: number | null;
  deletions: number | null;
  /** Its review threads: unresolved, and all. */
  threads: { open: number; total: number } | null;
  ci: CiState | null;
  /** Where you stand on it; null when the forge couldn't say who you are. */
  viewer: PrViewerInvolvement | null;
  /** The issues it closes (GitHub) or its linked work items (ADO); null
   *  where the listing didn't ask (ADO, past its newest rows). */
  issues: PrIssue[] | null;
  /** Where its review stands (`shared/prVerdict`): GitHub's review decision
   *  or latest reviews, ADO's votes. Null with no one asked. */
  verdict: ReviewVerdict | null;
  /** A fork PR's head branch page on the fork; null for a same-repo PR or
   *  where the forge didn't say. */
  headUrl: string | null;
  /** How many commits it would merge; null where the listing didn't count
   *  them (ADO, past its newest rows). */
  commits: number | null;
}

/** Where you stand on a listed PR. */
export interface PrViewerInvolvement {
  isAuthor: boolean;
  /** Among its assignees; always false on ADO, which has none. */
  isAssignee: boolean;
  /** Asked to review it, by name, and not yet reviewed; a team's or group's
   *  request doesn't count as you. */
  isRequestedReviewer: boolean;
}

/** The open PRs that matter to a task's branch: opened from it, or into it.
 *  Newest first; both empty on a detached HEAD (`branch` null). */
export interface RelevantPrs {
  branch: string | null;
  from: RelevantPr[];
  into: RelevantPr[];
}

/** Where a checkout stands against a PR's head: HEAD is it, and the commits
 *  HEAD has that it lacks (`ahead`) and the other way round (`behind`). */
export interface CheckoutVsHead {
  atHead: boolean;
  ahead: number;
  behind: number;
}

/** A task's relevant PRs (null when the forge couldn't be asked) and the PR
 *  it is in review mode for (`task_review_targets`), or null. */
export interface TaskPrs {
  relevant: RelevantPrs | null;
  mode: PrRef | null;
}

// ── Remote Control Types ────────────────────────────────────

export interface RemoteControlState {
  url: string;
  active: boolean;
}

// ── Diff editor IPC ───────────────────────────────────────────

/** Reference for the "original" side of a working-tree diff: HEAD or staged index. */
export type WorkingRef = 'HEAD' | 'index';

/** A folder's paths for the editor's tree: its files, and the directories git
 *  lists as a single entry (a symlinked directory, or a fully ignored one),
 *  which the tree shows as folders and lists lazily (`editorListDir`). */
export interface RepoListing {
  files: string[];
  dirs: string[];
  /** The working tree's: its gitignored files and folders, read with it so a
   *  tree shows them in the same frame as the rest. */
  ignored?: RepoListing;
}

/** One entry of a directory listed for the tree; `dir` follows symlinks. */
export interface DirEntry {
  name: string;
  dir: boolean;
}

/** Working-tree read: original (HEAD/index) + working copy with disk metadata. */
export interface EditorReadWorkingResult {
  originalContent: string; // '' for untracked / new files
  workingContent: string | null; // null when the file is deleted on disk
  mtimeMs: number; // 0 when working file is absent
  sizeBytes: number; // 0 when working file is absent
  isBinary: boolean; // true → content fields are ''
  isLargeFile: boolean; // true → content fields are ''
  language: string; // Monaco language id; '' fallback
}

/** A preview's image (`editor:readImages`), inlined as a `data:` URI, or why
 *  not: outside the editor's root (or a link out of it), not an image type by
 *  its name and bytes, over the cap, or not there. */
export type PreviewImage =
  | { dataUri: string }
  | { refused: 'outside' | 'type' | 'size' | 'missing' };

/** Commit read: parent (original) vs commit (modified). No disk metadata; read-only. */
export interface EditorReadCommitResult {
  originalContent: string; // parent commit's content; '' for root commit / added files
  modifiedContent: string; // this commit's content; '' for deleted files
  isBinary: boolean;
  isLargeFile: boolean;
  language: string;
}

/** Branch-diff read: file content at the base branch (original) + working
 *  copy on disk (modified). Editable, like working-view: disk metadata is
 *  returned so the existing stale-check + writeWorking path works unchanged. */
export interface EditorReadBranchResult {
  originalContent: string; // git show <base>:<path>; '' when missing in base
  workingContent: string | null; // null when deleted on disk
  mtimeMs: number; // 0 when working file is absent
  sizeBytes: number; // 0 when working file is absent
  isBinary: boolean;
  isLargeFile: boolean;
  language: string;
}

export type EditorWriteResult =
  | { ok: true; mtimeMs: number; sizeBytes: number }
  | { ok: false; stale: true; currentMtimeMs: number; currentSizeBytes: number };

/** One git-blame record per final line of a file (line is 1-indexed). Faithful
 *  to `git blame --incremental`; presentation decisions live in the renderer. */
export interface BlameLine {
  line: number; // 1-indexed final line number
  sha: string; // 40-char commit hash; all-zeros when uncommitted
  shortSha: string; // 7-char abbreviation (of sha, so '0000000' when uncommitted)
  author: string; // author name as reported by git
  authorEmail: string; // author email, angle brackets stripped
  authorTime: number; // author time, unix seconds (0 when absent)
  summary: string; // commit subject line
  uncommitted: boolean; // true → not-yet-committed working-tree line
}

/** Result of editor:blame — one entry per line, in ascending line order. */
export interface EditorBlameResult {
  lines: BlameLine[];
}

/** Commit summary for the diff editor's commit drawer. Includes the body so
 *  hover popovers can render the full message without a second IPC. */
export interface EditorCommitListItem {
  hash: string;
  shortHash: string;
  authorName: string;
  authorDate: number;
  subject: string;
  body: string;
  /** Lines added/removed by this commit (summed across its files). 0 for merge
   *  commits, which carry no diffstat. */
  additions: number;
  deletions: number;
}

// ── Workspace ports ──────────────────────────────────────────

/** Where a host port came from. Surfaced in the ports panel tooltip. */
export type PortSource = 'fixed' | 'hash' | 'override' | 'probe';

export interface TaskPort {
  id: string;
  taskId: string;
  label: string;
  /** null for Tier 1 (fixed) entries — they have no env var. */
  envVar: string | null;
  /** null for Tier 1 entries; the schema-declared port the assignment was derived from. */
  defaultPort: number | null;
  hostPort: number;
  source: PortSource;
  /** Optional repo-specific service commands from .dash/ports.json. */
  runCommand: string | null;
  stopCommand: string | null;
  logsCommand: string | null;
  cwd: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Per-task liveness map keyed by host port. 'unknown' = first probe pending. */
export type PortLiveness = 'up' | 'down' | 'unknown';

export interface PortLivenessUpdate {
  taskId: string;
  results: Record<number, PortLiveness>;
}

export interface PortHeuristicGuess {
  label: string;
  envVar: string;
  defaultPort: number;
}

/** Result of the project-shape heuristic. `alreadyConfigured` short-circuits
 *  the panel's onboarding card when .dash/ports.json already exists, so the
 *  renderer can call detect unconditionally without first probing the list.
 *  `configError` is set when the file exists but failed to parse — distinct
 *  from "file doesn't exist" so the onboarding poll can stop and surface
 *  the error to the user instead of waiting forever for a file that's there
 *  but malformed. */
export interface PortHeuristicResult {
  needsPorts: boolean;
  signals: string[];
  guesses: PortHeuristicGuess[];
  alreadyConfigured: boolean;
  configError?: string;
}

// ── Diff editor comments ──────────────────────────────────────

/** A persisted annotation on a working-tree file in the diff editor.
 *  Modal-session UX, but stored in SQLite so reopens restore prior state.
 *  Keyed by (taskId, filePath); `sent` is a per-comment flag that excludes
 *  the comment from the next prompt bundle by default. */
export interface DiffComment {
  id: string;
  taskId: string;
  filePath: string;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  text: string;
  sent: boolean;
  /** Diff state the anchor is meaningful against: 'live' (working/branch
   *  views share the working file), 'commit:<hash>' for a frozen commit, or
   *  'pr:<provider>:<n>' for a draft review comment on a PR. */
  viewScope: string;
  /** Which side of the diff the lines are on; always RIGHT outside PR drafts. */
  side: 'LEFT' | 'RIGHT';
  /** A PR draft reply: the remote thread it answers. Null for line comments. */
  replyTo: string | null;
  /** A PR line draft: the PR head commit its lines are in. Null for replies,
   *  outside PR scopes, and for drafts written before Dash recorded it. */
  commit: string | null;
  /** Who wrote it. An agent's draft becomes the user's once they edit its text. */
  author: 'user' | 'agent';
  /** A note is local, for the agent; a comment is a PR review draft that
   *  Submit posts. Only PR scopes hold comments. */
  kind: DiffCommentKind;
  createdAt: string;
  updatedAt: string;
}

export type DiffCommentKind = 'note' | 'comment';

/** Payload for `diffComments:upsert` from the renderer. The handler stamps
 *  createdAt/updatedAt and reflects the row back as a full DiffComment. */
export interface DiffCommentInput {
  id: string;
  taskId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  sent: boolean;
  viewScope: string;
  side?: 'LEFT' | 'RIGHT';
  replyTo?: string | null;
  /** Defaults to 'note'. */
  kind?: DiffCommentKind;
  /** The PR head its lines are in; left out, it stays as it is. */
  commit?: string | null;
  /** Refuse the write (a CONFLICT) unless the row is still at this updatedAt:
   *  the version the person started editing. */
  ifUnchangedSince?: string;
}

// ── Auto-update ─────────────────────────────────────────────

export type AutoUpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'ready';

/**
 * The updater's entire observable state. Broadcast whole on `autoUpdate:status`
 * so the renderer never has to stitch it together from separate events.
 */
export interface AutoUpdateStatus {
  state: AutoUpdateState;
  availableVersion: string | null;
  /** Release notes from the update manifest, when the feed carries them. */
  releaseNotes: string | null;
  /** 0–100 while downloading, else null. */
  percent: number | null;
  /** Epoch ms when a check last finished — found, not found or failed. */
  lastCheckAt: number | null;
  /** Epoch ms when the in-flight check started; null when not checking. */
  checkStartedAt: number | null;
  /** Last failure text, kept so Settings can explain an otherwise silent failure. */
  lastError: string | null;
  /** False when the updater isn't wired up: dev builds and Windows. */
  initialized: boolean;
}

// ── Claude Code update (live sessions on an older CLI) ──────

/** Where a "restart sessions on the new Claude Code" request stands. */
export type ClaudeUpdateRestart =
  | { phase: 'none' }
  /** "Restart when done": waiting for these tasks (working or asking) to finish. */
  | { phase: 'waiting'; activeTaskIds: string[] }
  | { phase: 'restarting'; done: number; total: number };

/**
 * A newer Claude Code than some live task sessions run. Broadcast whole on
 * `claudeUpdate:state`.
 */
export interface ClaudeUpdateState {
  /** `claude --version`'s number ("2.1.333"), or null before the probe answers. */
  installedVersion: string | null;
  /** Live task sessions on an older version than `installedVersion`. */
  outdated: { taskId: string; version: string }[];
  restart: ClaudeUpdateRestart;
}

export type ClaudeUpdateMode = 'now' | 'whenDone';

/**
 * Claude Code auto-memory categories, in display order: standing rules first,
 * facts that go stale last. `other` catches missing or unknown types.
 */
export const MEMORY_TYPES = ['feedback', 'user', 'reference', 'project', 'other'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** The index file Claude keeps beside the memories. */
export const MEMORY_INDEX_FILE = 'MEMORY.md';

/**
 * How much of the index Claude Code loads into a session: its first lines, or
 * its first bytes, whichever runs out first. Nothing past that is seen.
 */
export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_INDEX_MAX_BYTES = 25_000;

/** What Dash reads from a memory's file. */
export interface MemoryFields {
  /** Frontmatter `name`. */
  name: string;
  description: string;
  type: MemoryType;
  /** Markdown without the frontmatter block. */
  body: string;
}

/** One `<name>.md` file in a project's auto-memory folder. */
export interface MemoryEntry extends MemoryFields {
  /** Basename, e.g. `feedback_testing.md`: the stable id within a folder. */
  file: string;
  /** Frontmatter `name`, falling back to the basename without `.md`. */
  name: string;
  mtimeMs: number;
  /** Whether MEMORY.md links to this file. */
  inIndex: boolean;
  /** Linked, but only past the part of MEMORY.md Claude loads: as good as unindexed. */
  pastIndexLimit: boolean;
}

/** A project's auto-memory, as Claude Code stores it. */
export interface ProjectMemory {
  /** Absolute memory folder Dash resolved (shown even when it doesn't exist). */
  dir: string;
  exists: boolean;
  /** Whether the folder has a MEMORY.md. */
  hasIndex: boolean;
  entries: MemoryEntry[];
  /** Memory files MEMORY.md links to that aren't in the folder. */
  dangling: string[];
}
