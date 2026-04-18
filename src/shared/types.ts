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
  lastSessionId: string | null;
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

// ── RTK (Rust Token Killer) Types ───────────────────────────

/** Where the rtk binary was resolved from. */
export type RtkSource = 'path' | 'managed' | 'none';

export interface RtkStatus {
  /** Whether an rtk binary is resolvable right now. */
  installed: boolean;
  /** Version string from `rtk --version`, if resolvable. */
  version: string | null;
  /** Absolute path to the resolved binary, or null. */
  path: string | null;
  /** 'path' = user-installed on $PATH, 'managed' = downloaded by Dash, 'none' = not installed. */
  source: RtkSource;
  /** User has flipped the "inject RTK hook per task" toggle on. */
  enabled: boolean;
  /** Whether Dash can auto-download rtk for this platform (no Windows release upstream). */
  downloadable: boolean;
}

export type RtkDownloadPhase = 'idle' | 'downloading' | 'extracting' | 'done' | 'error';

export interface RtkDownloadProgress {
  phase: RtkDownloadPhase;
  /** 0–100 for 'downloading', undefined otherwise. */
  percent?: number;
  /** Set when phase === 'error'. */
  error?: string;
  /** Resolved tag (e.g. "v0.42.0") when phase === 'done'. */
  version?: string;
}

/** Result of invoking `rtk hook claude` against a synthetic PreToolUse payload. */
export interface RtkTestResult {
  /** Whether rtk ran without crashing — even "no rewrite" is a valid pass. */
  ok: boolean;
  /** Command we fed rtk (shown in UI so the user knows what was tested). */
  testedCommand?: string;
  /** Command rtk would substitute in, or null if it chose pass-through. */
  rewrittenCommand?: string | null;
  /** True when rtk actually emitted a rewrite directive (proof of compression). */
  wouldCompress?: boolean;
  /** Trimmed stdout for the debug disclosure. Max ~2 KB. */
  rawOutput?: string;
  /** Populated on crash / missing binary / stderr panic. */
  error?: string;
}
