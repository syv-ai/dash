import type {
  BypassAvailability,
  PermissionMode,
  SessionPermissionMode,
  Task,
  TaskModel,
} from '../../../shared/types';
import { normalizeAddDirs, sameAddDirs } from '../../../shared/addDirs';
import { EFFORT_LABELS, type TaskEffort } from '../../../shared/effort';

/**
 * What changing a task's session settings takes. Pure, so it is tested.
 *
 * None of them applies to a running session live. Dash dispatches a session
 * as `claude --bg` with the mode and model as flags (`supervisorSession.ts`),
 * and the supervisor respawns the job with those same flags. Dash access is
 * baked into the task's settings file at dispatch. So a task with a session
 * restarts: a fresh job that resumes the same conversation with the new flag.
 *
 * - Permission mode: Claude Code can't enter bypassPermissions in a session
 *   started without it (permission-modes docs).
 * - Model: `/model <name>` typed into the session is a live switch, but it
 *   also saves the model as the user's default for every new session
 *   (model-config docs: "Typing `/model <name>` directly behaves like Enter",
 *   which saves the default), and keystrokes into the pty would land in
 *   whatever the person is typing. Only the picker's `s` key is session-only,
 *   and driving a picker blind isn't reliable. Claude Code has no supported
 *   control channel for it, so the model restarts too: the owner's call is
 *   restart-and-resume over typing into Claude Code's input (2026-11-27).
 */

export type SessionSettingChange =
  | { setting: 'permissionMode'; to: PermissionMode }
  | { setting: 'model'; to: TaskModel }
  | { setting: 'dashAccess'; to: boolean }
  /** The person's own flags, as typed; null for none. */
  | { setting: 'extraArgs'; to: string | null }
  /** Extra folders the session may read and edit (`--add-dir`). */
  | { setting: 'addDirs'; to: string[] }
  /** `--effort`; null → Settings → Claude's default. */
  | { setting: 'effort'; to: TaskEffort | null };

/** The task fields a session setting change reads. */
export type SessionSettingsOf = Pick<
  Task,
  'permissionMode' | 'model' | 'dashAccess' | 'extraArgs' | 'addDirs' | 'effort'
>;

/** Whether the change leaves the setting as it is (extra arguments compare trimmed). */
function isUnchanged(task: SessionSettingsOf, change: SessionSettingChange): boolean {
  if (change.setting === 'extraArgs') {
    return (task.extraArgs?.trim() || null) === (change.to?.trim() || null);
  }
  if (change.setting === 'addDirs') return sameAddDirs(task.addDirs, change.to);
  return task[change.setting] === change.to;
}

/** Names as the picker shows them; `plan` and `dontAsk` only a session reports. */
export const MODE_LABELS: Record<SessionPermissionMode, string> = {
  default: 'Default',
  plan: 'Plan',
  acceptEdits: 'Accept edits',
  auto: 'Auto',
  dontAsk: "Don't ask",
  bypassPermissions: 'Yolo',
};

/** Names as the model picker shows them. */
export const MODEL_LABELS: Record<TaskModel, string> = {
  default: 'Default',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
};

export interface SettingConfirm {
  title: string;
  message: string;
  confirmLabel: string;
}

export type SessionSettingPlan =
  | { kind: 'none' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'apply'; restart: boolean; confirm: SettingConfirm | null };

const BYPASS_RISK =
  'Yolo skips every permission prompt: Claude runs edits and shell commands without asking, with nothing to stop a prompt injection.';
const RESTART = 'Switching restarts the session, which resumes the same conversation.';
const RESTART_CHANGE = 'Changing them restarts the session, which resumes the same conversation.';
const RESTART_LABEL = 'Restart session';

/** Why Yolo can't be picked, or null when it can (or it isn't known yet). */
export function bypassUnavailableReason(bypass: BypassAvailability | null): string | null {
  if (!bypass || bypass.available) return null;
  if (bypass.reason === 'disabled') {
    return bypass.managed
      ? "Your organization's Claude Code settings turn Yolo off (permissions.disableBypassPermissionsMode)."
      : 'A Claude Code settings file turns Yolo off (permissions.disableBypassPermissionsMode).';
  }
  return 'Claude Code needs its bypass warning accepted once: run claude --dangerously-skip-permissions in a terminal and accept it.';
}

/** The question a restart asks, per setting. */
function restartTitle(change: SessionSettingChange): string {
  switch (change.setting) {
    case 'permissionMode':
      return `Switch this task to ${MODE_LABELS[change.to]}?`;
    case 'model':
      return `Switch this task to ${MODEL_LABELS[change.to]}?`;
    case 'dashAccess':
      return change.to ? 'Turn on Dash access?' : 'Turn off Dash access?';
    case 'extraArgs':
      return change.to?.trim()
        ? 'Restart with these extra arguments?'
        : 'Drop the extra arguments?';
    case 'effort':
      return change.to
        ? `Switch this task to ${EFFORT_LABELS[change.to]} effort?`
        : "Switch this task to Settings' effort?";
    case 'addDirs':
      return normalizeAddDirs(change.to).length > 0
        ? 'Restart with these folders?'
        : 'Drop the added folders?';
  }
}

export function planSessionSettingChange(opts: {
  task: SessionSettingsOf;
  change: SessionSettingChange;
  /** A live session or a parked job, either of which holds the old flags. */
  hasSession: boolean;
  /** Only read for a switch to bypassPermissions. */
  bypass: BypassAvailability | null;
}): SessionSettingPlan {
  const { task, change, hasSession } = opts;
  if (isUnchanged(task, change)) return { kind: 'none' };
  if (change.setting === 'permissionMode' && change.to === 'bypassPermissions') {
    const reason = bypassUnavailableReason(opts.bypass);
    if (reason) return { kind: 'blocked', reason };
    return {
      kind: 'apply',
      restart: hasSession,
      confirm: {
        title: 'Switch this task to Yolo?',
        message: hasSession ? `${BYPASS_RISK} ${RESTART}` : BYPASS_RISK,
        confirmLabel: hasSession ? 'Restart in Yolo' : 'Switch to Yolo',
      },
    };
  }
  if (!hasSession) return { kind: 'apply', restart: false, confirm: null };
  return {
    kind: 'apply',
    restart: true,
    confirm: {
      title: restartTitle(change),
      message:
        change.setting === 'extraArgs' || change.setting === 'addDirs' ? RESTART_CHANGE : RESTART,
      confirmLabel: RESTART_LABEL,
    },
  };
}

/**
 * A line for the mode the session reports when it isn't the task's: cycled
 * with Shift+Tab, or fallen back from a bypass a setting refused.
 */
export function sessionModeNote(
  taskMode: PermissionMode,
  sessionMode: SessionPermissionMode | undefined,
): string | undefined {
  if (!sessionMode || sessionMode === taskMode) return undefined;
  return `The session is in ${MODE_LABELS[sessionMode]} now.`;
}

/**
 * Whether the model the status line reports (its `model.display_name`,
 * "Sonnet 4.6") isn't the task's: switched with `/model` in the session, or
 * a restart still pending. A task on the user's default names no family, so
 * nothing it runs is a mismatch.
 */
export function liveModelDiffers(
  taskModel: TaskModel,
  liveModel: string | null | undefined,
): boolean {
  if (!liveModel || taskModel === 'default') return false;
  return !liveModel.toLowerCase().includes(taskModel);
}

/** A line for the model the session runs when it isn't the task's. */
export function sessionModelNote(
  taskModel: TaskModel,
  liveModel: string | null | undefined,
): string | undefined {
  return liveModelDiffers(taskModel, liveModel) ? `The session is on ${liveModel} now.` : undefined;
}
