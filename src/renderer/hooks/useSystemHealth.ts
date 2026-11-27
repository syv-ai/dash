import { useEffect } from 'react';
import { MemoryStick } from 'lucide-react';
import type { MemoryAlert } from '@shared/systemHealth';
import { toast } from '../components/ui/toast';
import { memoryWarningCopy } from '../lib/memoryWarning';
import { track } from '../lib/telemetry';
import { useSettings } from '../stores/settingsStore';
import { idleTasksNow, sleepIdleTasks, useSystemHealthStore } from '../stores/systemHealthStore';

const TOAST_KEY = 'memory-warning';

function actOnWarning(): void {
  track('memory_warning_acted', { task_count: sleepIdleTasks() });
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
  const copy = memoryWarningCopy(alert, idleTasksNow().length);
  if (copy.action) {
    toast.offer(copy.title, {
      key: TOAST_KEY,
      icon: MemoryStick,
      description: copy.description,
      action: { label: copy.action, onClick: actOnWarning },
    });
  } else {
    toast.warning(copy.title, { key: TOAST_KEY, description: copy.description, lasting: true });
  }
}

/**
 * Settings → System health: pushes the settings to main's SystemHealthService,
 * turns its alerts into a toast that offers to put the idle tasks to sleep
 * (while Dash is in the background main raises a desktop notification
 * instead, and the toast waits for focus), and keeps its snapshots for the
 * sidebar's health icon (`useSystemHealthStore`).
 */
export function useSystemHealth(): void {
  const alerts = useSettings((s) => s.memoryWarning);
  const indicator = useSettings((s) => s.systemHealthIcon);
  const thresholdGb = useSettings((s) => s.memoryWarningGb);

  useEffect(() => {
    window.electronAPI.systemHealthConfigure({ alerts, indicator, thresholdGb });
    // An icon turned off forgets its reading; turned back on, it waits for a fresh one.
    if (!indicator) useSystemHealthStore.getState().setSnapshot(null);
  }, [alerts, indicator, thresholdGb]);

  useEffect(() => window.electronAPI.onMemoryAlert(onAlert), []);
  useEffect(
    () => window.electronAPI.onSystemHealthSnapshot(useSystemHealthStore.getState().setSnapshot),
    [],
  );
}
