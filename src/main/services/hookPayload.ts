/**
 * True for a hook fired inside a subagent: Claude Code sets `agent_id` only
 * there. A subagent's tool calls are not the task's own turn — a background
 * subagent keeps working after the main turn ends or is interrupted with
 * Escape, and no Stop hook follows its calls — so they must not drive the
 * task's activity dot.
 */
export function isSubagentHook(payload: Record<string, unknown>): boolean {
  return typeof payload.agent_id === 'string' && payload.agent_id !== '';
}
