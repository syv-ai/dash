/**
 * A task's effort: Claude Code's levels plus ultracode, passed as
 * `claude --effort <level>` (code.claude.com/docs/en/model-config, fetched
 * 2026-11-27). `--effort ultracode` turns ultracode on at `xhigh` and needs
 * Claude Code 2.1.203 (below MIN_CLAUDE_VERSION). A level the model lacks
 * falls back to the highest it has at or below it.
 */
export const TASK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'] as const;
export type TaskEffort = (typeof TASK_EFFORTS)[number];

export function isTaskEffort(value: unknown): value is TaskEffort {
  return TASK_EFFORTS.includes(value as TaskEffort);
}

/** Names as the pickers show them. */
export const EFFORT_LABELS: Record<TaskEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-High',
  max: 'Max',
  ultracode: 'Ultracode',
};

/**
 * The effort a task gets when it sets none: Settings → Claude's Effort and
 * Ultracode, as one value. Ultracode wins (it runs at X-High); Auto is none,
 * so Claude Code decides.
 */
export function defaultEffortFrom(level: string, ultracode: boolean): TaskEffort | null {
  if (ultracode) return 'ultracode';
  return isTaskEffort(level) ? level : null;
}
