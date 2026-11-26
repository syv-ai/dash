import { parseClaudeVersion } from '../services/claudeCli';

/**
 * The Claude Code version a drift report carries. Hook payloads name no
 * version, so a task's comes from what its own session last said (the
 * statusLine's `version`, or the version ClaudeUpdateService read from its
 * process); otherwise the installed `claude --version`; otherwise `unknown`.
 */
const taskVersions = new Map<string, string>();
let installed: string | null = null;

const normalise = (raw: string | null | undefined) => parseClaudeVersion(raw)?.join('.') ?? null;

export function setInstalledClaudeVersion(raw: string | null): void {
  installed = normalise(raw);
}

export function noteTaskClaudeVersion(taskId: string, raw: string | null | undefined): void {
  const v = normalise(raw);
  if (v) taskVersions.set(taskId, v);
}

export function claudeVersionFor(taskId?: string): string {
  return (taskId && taskVersions.get(taskId)) || installed || 'unknown';
}
