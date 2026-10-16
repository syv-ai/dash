/**
 * When each task's dash shim last reached the control server (ControlServer's
 * onTaskContact). A shim lists tools as soon as Claude Code connects it, so a
 * contact after a session start means the task's dash tools are up; tasks.wake
 * waits on that.
 */

const lastContact = new Map<string, number>();

export function noteTaskContact(taskId: string): void {
  lastContact.set(taskId, Date.now());
}

/** Epoch ms of the task's last contact, or undefined if none since Dash started. */
export function lastTaskContact(taskId: string): number | undefined {
  return lastContact.get(taskId);
}
