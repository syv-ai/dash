import type { LoopConfig, LoopRole, PermissionMode } from '@shared/types';
import { LoopService } from './LoopService';

/**
 * Per-role spawn policy for a loop's two agents. Centralised in main so the
 * renderer only has to say which role a terminal hosts; everything else (model,
 * permission, the seed prompt, and the manager's write-deny settings) is derived
 * here from the task's LoopConfig.
 */

/**
 * Tools/commands the MANAGER may never use. The manager runs UNPROMPTED so it can
 * read/grep/inspect freely, and this deny list — passed via `claude --settings`
 * (per-process; the agents share a worktree so a cwd settings file can't differ
 * per agent) — is what enforces "never writes code". Deny beats every allow, so
 * the structured edit tools are a hard block; the Bash patterns cover the
 * git-write / destructive surface (best-effort, defense-in-depth).
 */
export const MANAGER_DENY: readonly string[] = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash(git commit:*)',
  'Bash(git add:*)',
  'Bash(git push:*)',
  'Bash(git reset:*)',
  'Bash(git checkout:*)',
  'Bash(git restore:*)',
  'Bash(git merge:*)',
  'Bash(git rebase:*)',
  'Bash(rm:*)',
  'Bash(mv:*)',
];

/** The `--settings` object that makes the manager read-everything / write-nothing. */
export function managerDenySettings(): { permissions: { deny: string[] } } {
  return { permissions: { deny: [...MANAGER_DENY] } };
}

/** Coarse model-strength rank for the manager≥worker guard. 0 = unknown/unranked. */
function modelRank(model: string | undefined): number {
  if (!model) return 0;
  const m = model.toLowerCase();
  if (m.includes('opus')) return 4;
  if (m.includes('sonnet')) return 3;
  if (m.includes('haiku')) return 2;
  if (m.includes('fable')) return 1;
  return 0;
}

/** The manager mirrors the worker's model unless explicitly overridden. */
export function resolveAgentModel(role: LoopRole, config: LoopConfig): string | undefined {
  const worker = config.worker?.model;
  if (role === 'worker') return worker;
  return config.manager?.model ?? worker;
}

/**
 * True when both models are known-ranked and the manager is weaker than the
 * worker — an anti-pattern (a weak overseer can't grade a strong worker). The
 * creation modal uses this to warn; it does not hard-block (unranked custom ids
 * may be fine).
 */
export function managerWeakerThanWorker(config: LoopConfig): boolean {
  const w = modelRank(config.worker?.model);
  const m = modelRank(resolveAgentModel('manager', config));
  return w > 0 && m > 0 && m < w;
}

/** Worker permission by phased-trust level (overridable). L1/L2 edit within the
 *  worktree; only L3 runs fully unattended. The worker is always the sole writer. */
export function workerPermissionForLevel(config: LoopConfig): PermissionMode {
  if (config.worker?.permissionMode) return config.worker.permissionMode;
  return config.level === 'L3' ? 'bypassPermissions' : 'acceptEdits';
}

export interface LoopSpawnPolicy {
  permissionMode: PermissionMode;
  initialPrompt: string;
  model?: string;
  effort?: string;
  /** Extra `claude --settings` JSON merged at spawn (manager write-deny). */
  extraSettings?: Record<string, unknown>;
}

/** Resolve everything main needs to spawn a loop agent of `role`. */
export function buildLoopSpawn(role: LoopRole, config: LoopConfig): LoopSpawnPolicy {
  if (role === 'manager') {
    return {
      // Unprompted so reads don't stall; writes blocked by extraSettings, not this.
      permissionMode: config.manager?.permissionMode ?? 'bypassPermissions',
      initialPrompt: LoopService.managerPrompt(config),
      model: resolveAgentModel('manager', config),
      effort: config.manager?.effort,
      extraSettings: managerDenySettings(),
    };
  }
  return {
    permissionMode: workerPermissionForLevel(config),
    initialPrompt: LoopService.workerIterationPrompt(config),
    model: resolveAgentModel('worker', config),
    effort: config.worker?.effort,
  };
}
