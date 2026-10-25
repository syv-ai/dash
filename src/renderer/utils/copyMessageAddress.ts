import { toast } from 'sonner';

/**
 * Copy where another Claude Code session's SendMessage reaches this task:
 * `name [ref]` and `uds:<socket>`, one per line. Both exist only while the
 * task's session runs, and change when it restarts.
 */
export async function copyTaskMessageAddress(taskId: string): Promise<void> {
  const resp = await window.electronAPI.getTaskMessageAddresses(taskId);
  if (!resp.success) {
    toast.error('Could not read the message address', { description: resp.error });
    return;
  }
  if (!resp.data) {
    toast('No running session to message', {
      description: 'Open the task to start its session, then copy again.',
    });
    return;
  }
  const text = `${resp.data.ref}\n${resp.data.uds}`;
  window.electronAPI.clipboardWriteText(text);
  toast.success('Message address copied', { description: text });
}
