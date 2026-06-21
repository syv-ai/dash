export interface Project {
  id: string;
  name: string;
  path: string;
  isGitRepo: boolean;
  gitRemote: string | null;
  gitBranch: string | null;
  baseRef: string | null;
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
 * - `default`: prompt for every tool use (no flag)
 * - `acceptEdits`: auto-accept file edits, still prompt for shell (--permission-mode acceptEdits)
 * - `bypassPermissions`: skip all permission prompts (--dangerously-skip-permissions)
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

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
  branchCreatedByDash: boolean;
  linkedItems: LinkedItem[] | null;
  contextPrompt: string | null;
  /** Per-task override of the project's default worktree setup/teardown scripts
   *  (newline-separated commands). Null = no per-task scripts. */
  setupScript: string | null;
  teardownScript: string | null;
  archivedAt: string | null;
  sortOrder: number;
  totalTokens: number;
  totalCostUsd: number;
  tokensBackfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
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
 * - `UNKNOWN`: any other caught error (the default).
 */
export type IpcErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'UNKNOWN';

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

export interface ReserveWorktree {
  id: string;
  path: string;
  branch: string;
  projectId: string;
  projectPath: string;
  baseRef: string;
  createdAt: string;
}

export interface RemoveWorktreeOptions {
  deleteWorktreeDir?: boolean;
  deleteLocalBranch?: boolean;
  deleteRemoteBranch?: boolean;
  /** Per-task teardown override (newline-separated commands) run before removal.
   *  Undefined → fall back to the project's .dash/config.json teardown. */
  teardownScript?: string | null;
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
}

export interface RateLimits {
  fiveHour?: RateLimitInfo;
  sevenDay?: RateLimitInfo;
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

export type ActivityState = 'busy' | 'idle' | 'waiting' | 'error';

/** Human-readable label for the current tool, derived from PreToolUse hook data. */
export interface ToolActivity {
  /** Raw tool name from Claude Code (e.g. "Bash", "Edit", "Grep", "Agent"). */
  toolName: string;
  /** Short human-readable description (e.g. "Running command", "Editing main.ts"). */
  label: string;
}

/** Error info from StopFailure hook. */
export interface ActivityError {
  type: 'rate_limit' | 'auth_error' | 'billing_error' | 'unknown';
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
}

// ── Git Types ────────────────────────────────────────────────

export type FileChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted';

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
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  files: FileChange[];
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

export interface PullRequestInfo {
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  provider: 'github' | 'ado';
}

/**
 * A pull request as surfaced by the "From PR" task quick-start. Unlike
 * PullRequestInfo (a per-branch lookup for the PR badge), this carries the
 * head branch + author needed to start a task on the PR. `number` is the gh
 * PR number / ADO pullRequestId; `headRefName` is the plain branch name
 * (ADO's refs/heads/ prefix already stripped).
 */
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  author: string;
  headRefName: string;
  provider: 'github' | 'ado';
}

// ── Remote Control Types ────────────────────────────────────

export interface RemoteControlState {
  url: string;
  active: boolean;
}

// ── Skills Registry Types ──────────────────────────────────

/**
 * Slim card-and-search shape persisted in the local SQLite cache. We deliberately drop
 * registry fields we don't display (license, permissionNote, sourceUrl, author, source)
 * — users who want license details click through to GitHub.
 */
export interface RegistrySkill {
  name: string;
  description: string;
  repo: string;
  path: string;
  branch: string;
  category: string;
  tags: string[];
  stars: number;
  /** "compatible" → safe to install, "restricted" → license requires verification before reuse. */
  distribution?: 'compatible' | 'restricted';
}

/**
 * Tagged union so renderers can't confuse "no cache yet" with "stale cache" — the
 * earlier optional-fields shape made it easy to render an empty browser silently when
 * a refresh failure replaced a populated cache.
 */
export type SkillsRegistryMeta =
  | { status: 'never-fetched'; totalCount: 0; fetchedAt: null }
  | { status: 'fresh'; totalCount: number; fetchedAt: number }
  | { status: 'stale'; totalCount: number; fetchedAt: number; refreshError: string };

export interface SkillsSearchArgs {
  query: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface SkillsSearchResult {
  skills: RegistrySkill[];
  total: number;
}

/** A skill found on disk by `listInstalled`. The catalog field carries the registry
 *  metadata when the skill is also in our cached top-N — null otherwise (e.g. user
 *  installed a long-tail skill, or a skill from outside the registry). */
export interface InstalledSkill {
  /** Folder name under .claude/skills/. */
  skillName: string;
  /** True iff installed at ~/.claude/skills/<skillName>/. */
  globalInstalled: boolean;
  /** Subset of probePaths where the skill is installed. */
  installedPaths: string[];
  catalog: RegistrySkill | null;
}

export interface InstalledSkillsResult {
  skills: InstalledSkill[];
  /** Paths that couldn't be enumerated (EACCES, EIO etc.) — those probes silently
   *  truncated prior to this field, so the UI now warns the user that the list may
   *  be incomplete instead of misrepresenting "not found" results. */
  probeFailures: ProbeFailure[];
}

/** Structured probe failure so the renderer can render the right label per scope without
 *  string-sniffing. `code` is either an errno (EACCES, EIO, …) or a Dash-internal sentinel
 *  ('marker-corrupt') so the UI can offer the matching recovery action. */
export type ProbeFailure =
  | { scope: 'global'; code: string }
  | { scope: 'path'; path: string; code: string };

export interface SkillInstallStatus {
  global: boolean;
  /** Subset of the input probe paths where the skill is currently installed. The caller
   *  passes both project roots and task worktree paths; the renderer maps them back. */
  installedPaths: string[];
  /** Non-ENOENT errors per probe path — e.g. EACCES on /Users/foo/proj means we can't tell
   *  whether the skill is installed there. UI should treat any of these as "unknown"
   *  rather than "not installed", and ideally list each affected path inline. */
  probeFailures?: ProbeFailure[];
}

export type SkillInstallTarget =
  | { kind: 'global' }
  | { kind: 'project'; projectPath: string }
  /** A task lives in its own worktree directory; installing here writes uncommitted
   *  files into that worktree only — invisible to other tasks and to the project root. */
  | { kind: 'task'; worktreePath: string };

/** Identifies a remote skill in the registry. */
export interface SkillRef {
  repo: string;
  path: string;
  branch: string;
}

export interface SkillInstallArgs {
  ref: SkillRef;
  skillName: string;
  target: SkillInstallTarget;
}

export interface SkillUninstallArgs {
  skillName: string;
  target: SkillInstallTarget;
}

/* ── Plugins (Claude Code native plugin system) ──────────────────────────────
 * Dash manages plugins by driving the `claude plugin …` CLI and reading the
 * on-disk catalog (each marketplace's .claude-plugin/marketplace.json). The
 * three scopes mirror the skills install targets:
 *   user    → Global   (~/.claude/settings.json)
 *   project → Project  (<project>/.claude/settings.json, shared via git)
 *   local   → Task     (this worktree/repo only, not shared)
 * Project/local operations must run with the CLI's cwd set to the relevant
 * directory so Claude Code resolves the right repo. */

export type PluginScope = 'user' | 'project' | 'local';

/** Where a plugin operation runs. `cwd` is the directory the `claude` CLI is
 *  invoked from — required for project/local so the correct repo is targeted. */
export type PluginInstallTarget =
  | { scope: 'user' }
  | { scope: 'project'; cwd: string }
  | { scope: 'local'; cwd: string };

/** A marketplace registered with Claude Code (from `claude plugin marketplace list`). */
export interface PluginMarketplace {
  name: string;
  /** Source kind reported by the CLI: 'github' | 'git' | 'local' | 'url' | … */
  source: string;
  repo?: string;
  url?: string;
  path?: string;
  installLocation?: string;
}

/** An available plugin from a marketplace's catalog (marketplace.json `plugins[]`). */
export interface CatalogPlugin {
  /** `${name}@${marketplace}` — the identifier all CLI commands take. */
  id: string;
  name: string;
  marketplace: string;
  description?: string;
  author?: string;
  category?: string;
  homepage?: string;
  version?: string;
}

/** A plugin install record from `claude plugin list --json`. A single plugin can
 *  appear multiple times (once per scope it's installed in). */
export interface InstalledPlugin {
  id: string;
  name: string;
  marketplace: string;
  version?: string;
  /** 'user' | 'project' | 'local' | 'managed' (managed = admin, read-only). */
  scope: string;
  enabled: boolean;
  /** Set for project/local scopes — the repo the install belongs to. */
  projectPath?: string;
}

/** Everything the Plugins panel needs in one read. */
export interface PluginsOverview {
  /** The `claude` CLI was located; without it the panel is read-only/empty. */
  claudeAvailable: boolean;
  marketplaces: PluginMarketplace[];
  catalog: CatalogPlugin[];
  installed: InstalledPlugin[];
}

export interface AddMarketplaceArgs {
  source: string;
  scope?: PluginScope;
  cwd?: string;
  /** Git sparse-checkout filter paths for monorepo marketplaces (--sparse). */
  sparse?: string[];
}

export interface RemoveMarketplaceArgs {
  name: string;
  scope?: PluginScope;
  cwd?: string;
}

export interface PluginInstallArgs {
  id: string;
  target: PluginInstallTarget;
}

export interface PluginUninstallArgs {
  id: string;
  target: PluginInstallTarget;
}

export interface PluginSetEnabledArgs {
  id: string;
  enabled: boolean;
  target: PluginInstallTarget;
}

// ── RTK (Rust Token Killer) Types ───────────────────────────

export type RtkSource = 'path' | 'managed';

// `enabled` only makes sense when a binary is installed — RtkService.setEnabled
// throws if you try to enable without resolution. Encoding the rule in the
// type means TS prevents the impossible state at construction; the IPC
// pre-flight check that previously enforced it at runtime can be dropped.
export type RtkStatus =
  | {
      installed: true;
      version: string;
      path: string;
      source: RtkSource;
      enabled: boolean;
      downloadable: boolean;
    }
  | { installed: false; downloadable: boolean };

export type RtkDownloadProgress =
  | { phase: 'downloading'; percent: number }
  | { phase: 'verifying' }
  | { phase: 'extracting' }
  | { phase: 'done'; version: string }
  | { phase: 'error'; error: string };

export type RtkExecDiff =
  | {
      kind: 'ok';
      /** Stdout of the raw tested command, capped for IPC payload size. */
      rawStdout: string;
      /** Stdout of the rtk-rewritten command, capped for IPC payload size. */
      compressedStdout: string;
      /** Untruncated byte counts, so the UI can show honest savings math. */
      rawBytes: number;
      compressedBytes: number;
      /** True when stdout was truncated at the runShell cap; bytes counts
       *  reflect the truncated buffer in that case (we stop reading). */
      truncated: boolean;
    }
  | {
      /** Diff capture itself failed — distinct from "rtk chose pass-through".
       *  UI must NOT render this as a successful no-op rewrite. */
      kind: 'failed';
      /** Which stage broke: `setup` (mkdtemp/git init), `raw` (the original
       *  command), `rewritten` (the rtk-rewritten command), or `unknown`. */
      stage: 'setup' | 'raw' | 'rewritten' | 'unknown';
      /** Exit code when the command exited non-zero; absent when the failure
       *  happened before spawn (mkdtemp, git init, etc.). */
      exitCode?: number;
      /** Truncated stderr for the failed stage, when available. */
      stderr?: string;
      /** Human-readable reason — what to show in the UI. */
      reason: string;
    };

// Three orthogonal optionals (`rewrittenCommand: string | null`, `blocked?`,
// `execDiff?`) admitted impossible combinations in production code (e.g.
// blocked AND rewritten). A nested outcome discriminant collapses them so
// the renderer's three branches map 1:1 to representable states.
export type RtkTestResult =
  | { ok: false; testedCommand?: string; error: string }
  | {
      ok: true;
      testedCommand: string;
      rawOutput: string;
      outcome: RtkTestOutcome;
    };

export type RtkTestOutcome =
  // rtk ran cleanly and chose pass-through (no rewrite for this command).
  | { kind: 'pass-through' }
  // rtk used exit 2 to block the tool call. Distinct from a failure.
  | { kind: 'blocked'; stderr: string }
  // rtk emitted a rewrite. execDiff is best-effort visualization, not a
  // correctness signal — its absence/failure does not invalidate the rewrite.
  | { kind: 'rewritten'; rewrittenCommand: string; execDiff?: RtkExecDiff };

// ── Diff editor IPC ───────────────────────────────────────────

/** Reference for the "original" side of a working-tree diff: HEAD or staged index. */
export type WorkingRef = 'HEAD' | 'index';

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

/** Commit summary for the diff editor's commit drawer. Includes the body so
 *  hover popovers can render the full message without a second IPC. */
export interface EditorCommitListItem {
  hash: string;
  shortHash: string;
  authorName: string;
  authorDate: number;
  subject: string;
  body: string;
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
  createdAt: string;
  updatedAt: string;
}

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
}

/* ── Unified Extensions model (Skills + Plugins across scopes) ──────────────
 * See docs/specs/2026-06-17-skills-plugins-extensions-design.md. Phase 1 lists
 * what is installed/enabled at each scope; inheritance resolution is Phase 2. */

/** skillOverrides visibility values (per Claude Code settings). */
export type SkillVisibility = 'on' | 'name-only' | 'user-invocable-only' | 'off';

/** A concrete scope the Extensions surface can read/write. */
export interface ExtensionScopeRef {
  /** Stable id: 'global' | `project:${projectId}` | `task:${taskId}`. */
  id: string;
  kind: 'global' | 'project' | 'task';
  /** Display label: 'Global', project name, or task name. */
  name: string;
  /** Root directory whose `.claude/` this scope owns (home dir for global). */
  path: string;
  /** Owning project id (task scope only). */
  projectId?: string;
}

/** What the renderer passes so the main process can enumerate Project/Task scopes. */
export interface ExtensionScopeInput {
  projects: { id: string; name: string; path: string }[];
  tasks: { taskId: string; name: string; worktreePath: string; projectId: string }[];
}

export interface OverviewPlugin {
  /** plugin@marketplace */
  id: string;
  name: string;
  marketplace: string;
  enabled: boolean;
  version?: string;
}

export interface OverviewSkill {
  /** Skill folder name under .claude/skills. */
  name: string;
  /** Resolved from this scope's skillOverrides; defaults to 'on' when unset. */
  visibility: SkillVisibility;
  /** True when a Dash install marker is present (installed from the registry). */
  fromRegistry: boolean;
}

export interface ScopeExtensions {
  scope: ExtensionScopeRef;
  plugins: OverviewPlugin[];
  skills: OverviewSkill[];
  /** Raw skill-visibility overrides set in THIS scope's settings (not inherited).
   *  Lets the renderer detect a child scope overriding an inherited skill whose
   *  folder isn't local. */
  skillOverrides: Record<string, SkillVisibility>;
}

export interface ExtensionsOverview {
  claudeAvailable: boolean;
  scopes: ScopeExtensions[];
}

export interface SetSkillOverrideArgs {
  scope: ExtensionScopeRef;
  skillName: string;
  /** null clears the override (reverts to the skill's own default). */
  visibility: SkillVisibility | null;
}

export type PluginComponentKind = 'skill' | 'agent' | 'command' | 'hook';

/** One read-only component bundled inside a plugin (name + optional description). */
export interface PluginComponentSummary {
  name: string;
  description?: string;
}

/** Full detail for one bundled plugin component, read from the plugin's install dir. */
export interface ComponentDetail {
  kind: PluginComponentKind;
  name: string;
  description?: string;
  allowedTools?: string[];
  model?: string;
  /** The component's source: SKILL.md / agent .md / command .md text, or a hook's
   *  config JSON. */
  raw?: string;
  /** Bundled files (skills only) as POSIX-relative paths, excluding SKILL.md. */
  files?: string[];
}

export interface GetPluginComponentDetailArgs {
  pluginId: string;
  kind: PluginComponentKind;
  /** Component name (command names may contain `/` for namespacing). */
  name: string;
}

/** Everything a plugin bundles, grouped by component type. Read-only — Claude Code
 *  enables/disables a plugin's components as a unit. */
export interface PluginComponents {
  skills: PluginComponentSummary[];
  agents: PluginComponentSummary[];
  commands: PluginComponentSummary[];
  hooks: PluginComponentSummary[];
}

/** Standalone skill detail parsed from its SKILL.md. */
export interface SkillDetail {
  name?: string;
  description?: string;
  allowedTools?: string[];
  model?: string;
  /** Full raw SKILL.md contents (frontmatter + body) for the detail drawer. */
  raw?: string;
  /** Other files bundled in the skill folder (scripts, references, assets) as
   *  POSIX-relative paths, excluding SKILL.md itself. Sorted. */
  files?: string[];
}

export interface GetPluginComponentsArgs {
  /** plugin@marketplace */
  pluginId: string;
}

export interface GetSkillDetailArgs {
  scope: ExtensionScopeRef;
  skillName: string;
}
