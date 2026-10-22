import { useEffect } from 'react';
import { toast } from 'sonner';
import { useGit } from '../../stores/gitStore';
import { useProjects } from '../../stores/projectsStore';
import { usePrReviews } from '../../stores/prReviewStore';
import { buildReviewPrompt, newReviewComments, type SeenReview } from '../../utils/prReviewNotices';
import { typeIntoTask } from '../../utils/typeIntoTask';

const SEEN_KEY = 'prReviewCommentsSeen';
/** At most one review lookup per task this often, however often its PRs are polled. */
const MIN_INTERVAL_MS = 60_000;

function readSeen(): Record<string, SeenReview> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, SeenReview>) : {};
  } catch {
    return {};
  }
}

function writeSeen(seen: Record<string, SeenReview>): void {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Best effort: without it, comments may be announced again after a restart.
  }
}

/**
 * When polling sees new comments in an open GitHub PR's unresolved review
 * threads, offer once to send those threads to the task as a draft. The
 * comments seen per task are kept across restarts.
 */
export function useReviewCommentsToast(): void {
  useEffect(() => {
    const seen = readSeen();
    const lastLook: Record<string, number> = {};

    const look = async (taskId: string, projectId: string, cwd: string, prNumber: number) => {
      const loaded = await usePrReviews.getState().load(projectId, cwd, prNumber);
      if (!loaded.ok) return;
      const review = loaded.review;
      const { threads, count, next } = newReviewComments(seen[taskId], review);
      seen[taskId] = next;
      writeSeen(seen);
      const task = Object.values(useProjects.getState().tasksByProject)
        .flat()
        .find((t) => t.id === taskId);
      if (count === 0 || !task || task.archivedAt) return;
      toast(`${count} new review ${count === 1 ? 'comment' : 'comments'} on PR #${prNumber}`, {
        description: task.name,
        duration: 20_000,
        closeButton: true,
        action: {
          label: 'Send to task',
          onClick: () => void typeIntoTask(taskId, buildReviewPrompt(review, threads)),
        },
      });
    };

    return useGit.subscribe((state, prev) => {
      if (state.prByTask === prev.prByTask) return;
      const tasks = Object.values(useProjects.getState().tasksByProject).flat();
      const now = Date.now();
      for (const [taskId, prs] of Object.entries(state.prByTask)) {
        const pr = prs[0];
        if (!pr || pr.state !== 'open' || pr.provider !== 'github') continue;
        if (now - (lastLook[taskId] ?? 0) < MIN_INTERVAL_MS) continue;
        const task = tasks.find((t) => t.id === taskId);
        const project = useProjects.getState().projects.find((p) => p.id === task?.projectId);
        const cwd = task?.path || project?.path;
        if (!task || task.archivedAt || !cwd) continue;
        lastLook[taskId] = now;
        void look(taskId, task.projectId, cwd, pr.number);
      }
    });
  }, []);
}
