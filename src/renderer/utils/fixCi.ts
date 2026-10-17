import { toast } from 'sonner';
import { useProjects } from '../stores/projectsStore';
import { sessionRegistry } from '../terminal/SessionRegistry';
import type { PullRequestInfo } from '../../shared/types';

const SESSION_WAIT_MS = 10_000;

/** The task's terminal session once its pane has mounted, or null after a timeout. */
async function waitForSession(taskId: string) {
  const deadline = Date.now() + SESSION_WAIT_MS;
  while (Date.now() < deadline) {
    const session = sessionRegistry.get(taskId);
    if (session) return session;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * "Fix CI": main writes the PR's failed checks to a file in the task's
 * checkout; this opens the task and types a one-line prompt pointing at that
 * file into its session, left as a draft for the user to send.
 */
export async function fixCi(taskId: string, pr: PullRequestInfo): Promise<void> {
  const { tasksByProject, projects, setActiveTask } = useProjects.getState();
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

  const { prompt } = resp.data;
  setActiveTask(taskId);
  const session = await waitForSession(taskId);
  if (!session) {
    toast.error(`Could not reach ${task.name}'s session`);
    return;
  }
  session.writeInput(prompt);
  session.focus();
  toast.success(`Fix CI prompt typed into ${task.name}`, {
    description: 'Review it, then press Enter to send.',
  });
}
