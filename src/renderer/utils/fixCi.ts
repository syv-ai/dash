import { toast } from 'sonner';
import { useProjects } from '../stores/projectsStore';
import { typeIntoTask } from './typeIntoTask';
import type { PullRequestInfo } from '../../shared/types';

/**
 * "Fix CI": main writes the PR's failed checks to a file in the task's
 * checkout; this opens the task and types a one-line prompt pointing at that
 * file into its session, left as a draft for the user to send.
 */
export async function fixCi(taskId: string, pr: PullRequestInfo): Promise<void> {
  const { tasksByProject, projects } = useProjects.getState();
  const task = Object.values(tasksByProject)
    .flat()
    .find((t) => t.id === taskId);
  const cwd = task?.path || projects.find((p) => p.id === task?.projectId)?.path;
  if (!task || !cwd) return;

  const loading = toast.loading(`Fetching the failed checks of PR #${pr.number}…`);
  const resp = await window.electronAPI.githubWriteCiReport({
    cwd,
    number: pr.number,
    url: pr.url,
    headSha: pr.headSha,
  });
  toast.dismiss(loading);
  if (!resp.success) {
    toast.error(`Could not fetch the checks of PR #${pr.number}`, { description: resp.error });
    return;
  }
  if (!resp.data) {
    toast(`No failed checks on PR #${pr.number}`, { description: 'They may have been re-run.' });
    return;
  }

  if (!(await typeIntoTask(taskId, resp.data.prompt))) return;
  toast.success(`Fix CI prompt typed into ${task.name}`, {
    description: 'Review it, then press Enter to send.',
  });
}
