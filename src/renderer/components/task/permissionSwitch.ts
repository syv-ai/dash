import type {
  BypassAvailability,
  PermissionMode,
  SessionPermissionMode,
} from '../../../shared/types';

/**
 * What switching a task's permission mode takes. A session's mode is fixed
 * when Dash dispatches it (`claude --bg` keeps its flags across respawns), and
 * Claude Code can't enter bypassPermissions in a session started without it
 * (permission-modes docs), so a task with a session restarts: a fresh job that
 * resumes the same conversation with the new flag. Pure, so it is tested.
 */

/** Names as the picker shows them; `plan` and `dontAsk` only a session reports. */
export const MODE_LABELS: Record<SessionPermissionMode, string> = {
  default: 'Default',
  plan: 'Plan',
  acceptEdits: 'Accept edits',
  auto: 'Auto',
  dontAsk: "Don't ask",
  bypassPermissions: 'Yolo',
};

export interface SwitchConfirm {
  title: string;
  message: string;
  confirmLabel: string;
}

export type PermissionSwitch =
  | { kind: 'none' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'apply'; restart: boolean; confirm: SwitchConfirm | null };

const BYPASS_RISK =
  'Yolo skips every permission prompt: Claude runs edits and shell commands without asking, with nothing to stop a prompt injection.';
const RESTART = 'Switching restarts the session, which resumes the same conversation.';

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

export function planPermissionSwitch(opts: {
  from: PermissionMode;
  to: PermissionMode;
  /** A live session or a parked job, either of which holds the old flags. */
  hasSession: boolean;
  /** Only read for a switch to bypassPermissions. */
  bypass: BypassAvailability | null;
}): PermissionSwitch {
  const { from, to, hasSession } = opts;
  if (from === to) return { kind: 'none' };
  if (to === 'bypassPermissions') {
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
      title: `Switch this task to ${MODE_LABELS[to]}?`,
      message: RESTART,
      confirmLabel: 'Restart session',
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
