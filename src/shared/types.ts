export interface Project {
  id: string;
  name: string;
  path: string;
  isGitRepo: boolean;
  gitRemote: string | null;
  gitBranch: string | null;
  baseRef: string | null;
  worktreeSetupScript: string | null;
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

export interface Task {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  path: string;
  status: string;
  useWorktree: boolean;
  autoApprove: boolean;
  branchCreatedByDash: boolean;
  linkedItems: LinkedItem[] | null;
  contextPrompt: string | null;
  archivedAt: string | null;
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

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
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
}

export interface PtyOptions {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  autoApprove?: boolean;
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

// ── Remote Control Types ────────────────────────────────────

export interface RemoteControlState {
  url: string;
  active: boolean;
}

// ── Pixel Agents Types ──────────────────────────────────────

export interface PixelAgentsOffice {
  id: string;
  url: string;
  token: string | null;
  enabled: boolean;
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

export interface ProbeFailure {
  /** 'global' for the home dir probe, otherwise an absolute project/worktree path. */
  scope: 'global' | string;
  /** errno code (EACCES, EIO, etc.) or 'unknown'. */
  code: string;
}

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

export interface PixelAgentsConfig {
  name: string;
  palette?: number;
  hueShift?: number;
  phrases?: string[];
  offices: PixelAgentsOffice[];
}

export type PixelAgentsOfficeStatus = 'connected' | 'registered' | 'disconnected' | 'unknown';

export interface PixelAgentsStatus {
  running: boolean;
  offices: Record<string, PixelAgentsOfficeStatus>;
}
