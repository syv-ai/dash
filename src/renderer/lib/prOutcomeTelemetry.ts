import { useGit } from '../stores/gitStore';
import { useProjects } from '../stores/projectsStore';
import { prOutcomes, type SeenBranchPrs } from '../utils/prOutcomes';
import { track } from './telemetry';

const SEEN_KEY = 'prOutcomesSeen';

function readSeen(): SeenBranchPrs {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as SeenBranchPrs) : {};
  } catch {
    return {};
  }
}

function writeSeen(seen: SeenBranchPrs): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Best effort: without it the next launch looks at every branch afresh, and says nothing.
  }
}

/**
 * Task outcomes from the PR polling Dash already does (docs/telemetry.md):
 * `pr_opened` for a PR new to a task's branch, `branch_merged` when one is
 * merged. The provider only. Call once at startup.
 */
export function installPrOutcomeTelemetry(): void {
  let seen = readSeen();
  useGit.subscribe((state, prev) => {
    if (state.branchPrsByTask === prev.branchPrsByTask) return;
    const tasks = Object.values(useProjects.getState().tasksByProject).flat();
    const branchOf = new Map(tasks.map((t) => [t.id, state.branchByTask[t.id] ?? t.branch]));
    const listed: Parameters<typeof prOutcomes>[1] = {};
    for (const [taskId, prs] of Object.entries(state.branchPrsByTask)) {
      const branch = branchOf.get(taskId);
      if (branch) listed[`${taskId}@${branch}`] = prs;
    }
    const { opened, merged, next } = prOutcomes(seen, listed);
    seen = next;
    writeSeen(seen);
    for (const pr of opened) track('pr_opened', { provider: pr.provider });
    for (const pr of merged) track('branch_merged', { provider: pr.provider });
  });
}
