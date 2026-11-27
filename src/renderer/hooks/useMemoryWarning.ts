import { useEffect } from 'react';
import { MemoryStick } from 'lucide-react';
import type { MemoryAlert } from '@shared/systemHealth';
import { toast } from '../components/ui/toast';
import { idleTaskIds, memoryWarningCopy } from '../lib/memoryWarning';
import { track } from '../lib/telemetry';
import { useProjects } from '../stores/projectsStore';
import { useRuntime } from '../stores/runtimeStore';
import { useSettings } from '../stores/settingsStore';

const TOAST_KEY = 'memory-warning';

function idleNow(): string[] {
  return idleTaskIds(useRuntime.getState().taskActivity, useProjects.getState().activeTaskId);
}

/** Put every idle task to sleep, through the task's own "Put to sleep". */
function sleepIdleTasks(): void {
  const ids = idleNow();
  for (const id of ids) void useProjects.getState().closeTask(id);
  track('memory_warning_acted', { task_count: ids.length });
}

/** The newest alert waiting for Dash to get focus (main raised a desktop
 *  notification meanwhile); shown then, with the idle count of that moment. */
let pending: MemoryAlert | null = null;

function onAlert(alert: MemoryAlert): void {
  if (document.hasFocus()) {
    showWarning(alert);
    return;
  }
  if (!pending) {
    window.addEventListener(
      'focus',
      () => {
        const next = pending;
        pending = null;
        if (next) showWarning(next);
      },
      { once: true },
    );
  }
  pending = alert;
}

function showWarning(alert: MemoryAlert): void {
  const copy = memoryWarningCopy(alert, idleNow().length);
  if (copy.action) {
    toast.offer(copy.title, {
      key: TOAST_KEY,
      icon: MemoryStick,
      description: copy.description,
      action: { label: copy.action, onClick: sleepIdleTasks },
    });
  } else {
    toast.warning(copy.title, { key: TOAST_KEY, description: copy.description, lasting: true });
  }
}

/**
 * The memory warning (Settings → Notifications): pushes the setting to main's
 * SystemHealthService and turns its alerts into a toast that offers to put the
 * idle tasks to sleep. While Dash is in the background main raises a desktop
 * notification instead, and the toast waits for focus.
 */
export function useMemoryWarning(): void {
  const enabled = useSettings((s) => s.memoryWarning);
  const thresholdGb = useSettings((s) => s.memoryWarningGb);

  useEffect(() => {
    window.electronAPI.systemHealthConfigure({ enabled, thresholdGb });
  }, [enabled, thresholdGb]);

  useEffect(() => window.electronAPI.onMemoryAlert(onAlert), []);
}
