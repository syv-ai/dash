import { useEffect } from 'react';
import { toast } from 'sonner';
import { useGit } from '../../stores/gitStore';
import { useProjects } from '../../stores/projectsStore';
import { newlyMergedPrs, type SeenPrStates } from '../../utils/mergedPrNotices';

const SEEN_KEY = 'prStatesSeen';

function readSeen(): SeenPrStates {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as SeenPrStates) : {};
  } catch {
    return {};
  }
}

function writeSeen(seen: SeenPrStates): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Best effort: without it a merge may be offered again after a restart.
  }
}

/**
 * When polling sees a task's PR merged, offer once to archive the task. The
 * last state seen per task is kept across restarts, so a merge made while
 * Dash was closed is offered on the next launch.
 */
export function useMergedPrToast(): void {
  useEffect(() => {
    let seen = readSeen();
    return useGit.subscribe((state, prev) => {
      if (state.prByTask === prev.prByTask) return;
      const tasks = Object.values(useProjects.getState().tasksByProject).flat();
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const { merged, next } = newlyMergedPrs(
        seen,
        state.prByTask,
        new Set(byId.keys()),
        (id) => !!byId.get(id)?.archivedAt,
      );
      seen = next;
      writeSeen(seen);
      for (const id of merged) {
        const task = byId.get(id);
        const pr = state.prByTask[id];
        if (!task || !pr) continue;
        toast(`PR #${pr.number} merged`, {
          description: `Archive ${task.name}?`,
          duration: 20_000,
          closeButton: true,
          action: {
            label: 'Archive',
            onClick: () => void useProjects.getState().archiveTask(id),
          },
        });
      }
    });
  }, []);
}
