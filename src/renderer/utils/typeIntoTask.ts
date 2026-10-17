import { toast } from 'sonner';
import { useProjects } from '../stores/projectsStore';
import { sessionRegistry } from '../terminal/SessionRegistry';

const SESSION_WAIT_MS = 15_000;
// After connecting, the pane fits and redraws; let that settle before typing.
const SETTLE_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The task's terminal session once it is connected to its PTY, or null after a timeout. */
async function waitForSession(taskId: string) {
  const deadline = Date.now() + SESSION_WAIT_MS;
  while (Date.now() < deadline) {
    const session = sessionRegistry.get(taskId);
    if (session?.isLive) {
      await sleep(SETTLE_MS);
      return session;
    }
    await sleep(100);
  }
  return null;
}

/**
 * Open the task and put `text` in its session's prompt, unsent, for the user
 * to review and send. Multi-line text goes in as a bracketed paste, so its
 * newlines don't submit it. The markers are written directly rather than via
 * xterm's paste(), which adds them only once it has seen Claude Code turn
 * bracketed paste on, and a pane that just attached may not have. False (with
 * an error toast) when the session can't be reached.
 */
export async function typeIntoTask(taskId: string, text: string): Promise<boolean> {
  const task = Object.values(useProjects.getState().tasksByProject)
    .flat()
    .find((t) => t.id === taskId);
  useProjects.getState().setActiveTask(taskId);
  const session = await waitForSession(taskId);
  if (!session) {
    toast.error(`Could not reach ${task?.name ?? 'the task'}'s session`);
    return false;
  }
  session.writeInput(text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text);
  session.focus();
  return true;
}
