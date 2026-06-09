import type { PortHeuristicResult } from './types';

/**
 * Builds the slash-command invocation Dash types into the active task's TUI
 * when the user clicks "Set up" in the ports onboarding toast.
 *
 * Format: `/dash-port-setup signals: <list>; guesses: <list>`
 *
 * No trailing line-ending — the caller decides whether to auto-submit (\r)
 * or leave the line for the user to review and submit manually. The slash
 * command file at `<worktree>/.claude/commands/dash-port-setup.md`
 * (installed via `ports:installSetupCommand` immediately before this is
 * typed) carries the full prompt; this string just hands the agent the
 * heuristic context.
 */
export function buildPortsSetupCommand(heuristic: PortHeuristicResult): string {
  const signals = heuristic.signals.length > 0 ? heuristic.signals.join(', ') : 'none';
  const guesses =
    heuristic.guesses.length > 0
      ? heuristic.guesses.map((g) => `${g.label} (${g.envVar}=${g.defaultPort})`).join(', ')
      : 'none auto-detected';
  return `/dash-port-setup signals: ${signals}; guesses: ${guesses}`;
}
