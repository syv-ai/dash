import type { ActivityState, SessionPermissionMode, Task, TaskModel } from '../../../shared/types';
import { formatTimeAgo } from '../../../shared/relativeTime';
import { flagNoteText, validateExtraArgs } from '../../../shared/extraArgs';
import { EFFORT_LABELS } from '../../../shared/effort';
import { liveModelDiffers } from '../task/sessionSettingChange';
import { tildePath } from '../../lib/displayPath';
import { formatCost, formatTokensPrecise } from '../../utils/format';

/** One key/value line in the Details tab. */
export interface DetailRow {
  label: string;
  value: string;
  /** Hover text: the exact value behind a rounded one. */
  title?: string;
  /** Text a copy button beside the value puts on the clipboard (ids, the
   *  full path behind a `~` one). */
  copy?: string;
  /** The value is command text (extra arguments): set in the code font. */
  mono?: boolean;
  /** A caution chip after the value, with this as its tooltip. */
  caution?: string;
}

export interface TaskDetailsInput {
  task: Task;
  projectName: string | null;
  /** Its project is a git checkout (`selectProjectHasGit`): else no Kind, as a
   *  plain folder's tasks all run in it. */
  hasGit: boolean;
  /** The task that created this one through the control API, by name. */
  parentTaskName: string | null;
  /** The live model from the session's status line, if it has reported. */
  liveModel: string | null;
  /** Context window used, 0–100; null until the session has replied. */
  contextPercent: number | null;
  showCost: boolean;
  /** The session's live state, absent while Dash isn't attached to one. */
  activity: ActivityState | null;
  /** The mode the session's hooks last reported, if it has. */
  livePermissionMode: SessionPermissionMode | null;
  /** When the conversation last changed (its transcript's mtime, epoch ms). */
  lastActiveMs: number | null;
  /** The home folder, shown as `~` in paths. */
  homeDir: string;
  /** Epoch ms: "4 min ago" is measured from it. */
  now: number;
}

/** The Details tab's plain sections; the rich ones (git, PRs, linked items,
 *  prompt) render from their own sources. */
export interface TaskDetailSections {
  task: DetailRow[];
  session: DetailRow[];
  usage: DetailRow[];
}

const PERMISSION_LABELS: Record<SessionPermissionMode, string> = {
  default: 'Ask every time',
  plan: 'Plan',
  acceptEdits: 'Accept edits',
  auto: 'Auto (classifier approves safe actions)',
  dontAsk: "Don't ask",
  bypassPermissions: 'Skip all prompts',
};

const ACTIVITY_LABELS: Record<Exclude<ActivityState, 'stopped'>, string> = {
  busy: 'Working',
  idle: 'Idle',
  waiting: 'Needs you',
  error: 'Failed',
};

/** The session's state now: live when attached; else when it last stopped,
 *  or that it never started. */
function sessionState(task: Task, activity: ActivityState | null): string {
  if (activity && activity !== 'stopped') return ACTIVITY_LABELS[activity];
  const stopped = formatWhen(task.sessionStoppedAt);
  if (stopped) return `Stopped ${stopped}`;
  if (activity === 'stopped') return 'Stopped';
  return task.jobId ? 'Not attached' : 'Not started';
}

const MODEL_LABELS: Record<TaskModel, string> = {
  default: 'Claude Code default',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
};

/** A DB timestamp as a Date: ISO strings, or SQLite's UTC "YYYY-MM-DD HH:MM:SS". */
export function parseDbTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = /[TZ]/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatWhen(value: string | null | undefined): string | null {
  const d = parseDbTime(value);
  return d ? formatDate(d) : null;
}

function formatDate(d: Date): string {
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * When the task's session last did something: "Active now" while it works;
 * else its conversation's last change (or, without a transcript, when it
 * stopped) as "4 min ago", the exact time in the tooltip. Null when it never
 * ran.
 */
export function lastActiveRow(
  input: Pick<TaskDetailsInput, 'task' | 'activity' | 'lastActiveMs' | 'now'>,
): DetailRow | null {
  if (input.activity === 'busy') return { label: 'Last active', value: 'Active now' };
  const ms = input.lastActiveMs ?? parseDbTime(input.task.sessionStoppedAt)?.getTime() ?? null;
  if (ms === null) return null;
  return {
    label: 'Last active',
    value: formatTimeAgo(ms / 1000, input.now / 1000),
    title: formatDate(new Date(ms)),
  };
}

/**
 * The task's own `claude` flags, as typed, with a caution chip naming the
 * risky ones (they widen or strip what Claude Code guards). Null when none.
 */
export function extraArgsRow(task: Pick<Task, 'extraArgs'>): DetailRow | null {
  const value = task.extraArgs?.trim();
  if (!value) return null;
  const { risky } = validateExtraArgs(value);
  return {
    label: 'Extra arguments',
    value,
    copy: value,
    mono: true,
    caution: risky.length > 0 ? risky.map(flagNoteText).join('\n') : undefined,
  };
}

/** The task's own env vars as `KEY=value` lines, in the code font. Null when none. */
export function envRow(task: Pick<Task, 'env'>): DetailRow | null {
  const lines = Object.entries(task.env).map(([key, value]) => `${key}=${value}`);
  if (lines.length === 0) return null;
  return {
    label: 'Environment',
    value: lines.join(', '),
    title: lines.join('\n'),
    copy: lines.join('\n'),
    mono: true,
  };
}

/** Rows with a value; the rest are left out rather than shown as "—". */
function present(rows: Array<DetailRow | null | false>): DetailRow[] {
  return rows.filter((r): r is DetailRow => !!r && r.value !== '');
}

/** The Details tab's task, session and usage rows: only what is set. */
export function taskDetailSections(input: TaskDetailsInput): TaskDetailSections {
  const { task } = input;
  const created = parseDbTime(task.createdAt);

  return {
    task: present([
      { label: 'Name', value: task.name },
      !!input.projectName && { label: 'Project', value: input.projectName },
      input.hasGit && {
        label: 'Kind',
        value: task.useWorktree ? 'Worktree' : 'Main checkout',
        title: task.useWorktree
          ? 'Works in its own git worktree'
          : "Works in the project's own folder",
      },
      {
        label: task.useWorktree ? 'Worktree' : 'Folder',
        value: tildePath(task.path, input.homeDir),
        title: task.path,
        copy: task.path,
      },
      !!input.parentTaskName && { label: 'Created by', value: input.parentTaskName },
      task.protected && {
        label: 'Protected',
        value: "Agents can't archive or delete it",
      },
      !!created && { label: 'Created', value: formatWhen(task.createdAt) ?? '' },
      lastActiveRow(input),
    ]),
    session: present([
      {
        label: 'Model',
        value: input.liveModel ?? MODEL_LABELS[task.model],
        title: liveModelDiffers(task.model, input.liveModel)
          ? `Configured: ${MODEL_LABELS[task.model]}`
          : undefined,
      },
      { label: 'Effort', value: task.effort ? EFFORT_LABELS[task.effort] : 'Default' },
      !!task.agent && { label: 'Agent', value: task.agent, copy: task.agent },
      {
        label: 'Permissions',
        value: PERMISSION_LABELS[input.livePermissionMode ?? task.permissionMode],
        title:
          input.livePermissionMode && input.livePermissionMode !== task.permissionMode
            ? `Configured: ${PERMISSION_LABELS[task.permissionMode]}`
            : undefined,
      },
      task.denyInsteadOfPrompting && {
        label: 'Prompts',
        value: 'Denied, not asked',
        title: 'A tool call that would wait on a permission prompt is denied, and the turn goes on',
      },
      {
        label: 'State',
        value: sessionState(task, input.activity),
      },
      !!task.sessionId && { label: 'Session', value: task.sessionId, copy: task.sessionId },
      !!task.jobId && { label: 'Job', value: task.jobId, copy: task.jobId },
      { label: 'Dash access', value: task.dashAccess ? 'On' : 'Off' },
      task.addDirs.length > 0 && {
        label: task.addDirs.length === 1 ? 'Folder' : 'Folders',
        value: task.addDirs.map((d) => tildePath(d, input.homeDir)).join(', '),
        title: task.addDirs.join('\n'),
        copy: task.addDirs.join('\n'),
      },
      extraArgsRow(task),
      envRow(task),
    ]),
    usage: present([
      task.totalTokens > 0 && {
        label: 'Tokens',
        value: formatTokensPrecise(task.totalTokens),
        title: `${task.totalTokens.toLocaleString()} tokens`,
      },
      input.showCost &&
        task.totalCostUsd > 0 && { label: 'Cost', value: formatCost(task.totalCostUsd) },
      input.contextPercent !== null && {
        label: 'Context',
        value: `${Math.round(input.contextPercent)}%`,
      },
    ]),
  };
}
