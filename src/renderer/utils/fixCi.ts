import { toast } from '../components/ui/toast';
import { selectTaskById, useProjects } from '../stores/projectsStore';
import { typeIntoTask } from './typeIntoTask';
import type { PullRequestInfo } from '../../shared/types';

/**
 * "Fix CI": main writes the PR's failed checks to a file in the task's
 * checkout; this opens the task and types a one-line prompt pointing at that
 * file into its session, left as a draft for the user to send.
 */
export async function fixCi(taskId: string, pr: PullRequestInfo): Promise<void> {
  const state = useProjects.getState();
  const { projects } = state;
  const task = selectTaskById(state, taskId);
  const cwd = task?.path || projects.find((p) => p.id === task?.projectId)?.path;
  if (!task || !cwd) return;

  // One toast: the spinner becomes the failure or the "nothing failed" note,
  // or goes away once there is a prompt to type.
  const failed = `Could not fetch the checks of PR #${pr.number}`;
  const report = await toast
    .progress(
      window.electronAPI.githubWriteCiReport({
        cwd,
        number: pr.number,
        url: pr.url,
        headSha: pr.headSha,
      }),
      {
        loading: `Fetching the failed checks of PR #${pr.number}…`,
        success: (resp) => {
          if (!resp.success) return { kind: 'error', title: failed, description: resp.error };
          if (!resp.data)
            return {
              kind: 'info',
              title: `No failed checks on PR #${pr.number}`,
              description: 'They may have been re-run.',
            };
          return null;
        },
        error: (err) => ({ kind: 'error', title: failed, description: String(err) }),
      },
    )
    .then((resp) => (resp.success ? resp.data : null))
    .catch(() => null);
  if (!report) return;

  if (!(await typeIntoTask(taskId, report.prompt))) return;
  toast.success(`Fix CI prompt typed into ${task.name}`, {
    description: 'Review it, then press Enter to send.',
  });
}
