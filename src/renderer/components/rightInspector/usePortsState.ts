import { useEffect, useState } from 'react';
import type { TaskPort, PortLiveness } from '../../../shared/types';

export interface PortsState {
  ports: TaskPort[];
  liveness: Record<number, PortLiveness>;
  refreshing: boolean;
  hasContent: boolean;
  livenessSummary: { up: number; total: number };
  refresh: () => Promise<void>;
}

/**
 * Runtime state for the ports drawer — owns the list fetch and the liveness
 * subscription. The onboarding/heuristic side lives in usePortsOnboarding so
 * the drawer doesn't need to know anything about pre-setup state.
 */
export function usePortsState(taskId: string | null): PortsState {
  const [ports, setPorts] = useState<TaskPort[]>([]);
  const [liveness, setLiveness] = useState<Record<number, PortLiveness>>({});
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!taskId) {
      setPorts([]);
      setLiveness({});
      return;
    }
    let cancelled = false;
    (async () => {
      const resp = await window.electronAPI.portsList(taskId);
      if (cancelled) return;
      if (resp.success && resp.data) setPorts(resp.data);
      const live = await window.electronAPI.portsLivenessGet(taskId);
      if (cancelled) return;
      if (live.success && live.data) setLiveness(live.data);
    })();
    return () => {
      cancelled = true;
      window.electronAPI.portsUnwatch(taskId).catch(() => {});
    };
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    const off = window.electronAPI.onPortsLiveness((update) => {
      if (update.taskId !== taskId) return;
      setLiveness(update.results);
    });
    return off;
  }, [taskId]);

  // Ensure the main-process file watcher on .dash/ports.json for this task so
  // external edits (manual tweaks, deletes, agent writes outside the setup
  // flow) are reflected without forcing a refresh-button click. The watcher
  // is task-lifetime in main; mounting just makes sure it's armed.
  useEffect(() => {
    if (!taskId) return;
    window.electronAPI.portsWatchConfig(taskId).catch(() => {});
  }, [taskId]);

  // Two refresh paths funnel into one re-pull:
  //   1. dash:ports:invalidate (window CustomEvent) — fired by the
  //      onboarding poll's success branch within this renderer.
  //   2. ports:configChanged (IPC) — fired by PortsConfigWatcher in main
  //      when ports.json changes on disk.
  useEffect(() => {
    if (!taskId) return;
    const refetch = async () => {
      const resp = await window.electronAPI.portsList(taskId);
      if (resp.success && resp.data) setPorts(resp.data);
    };
    const winHandler = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId?: string }>).detail;
      if (detail?.taskId === taskId) void refetch();
    };
    window.addEventListener('dash:ports:invalidate', winHandler);
    const offIpc = window.electronAPI.onPortsConfigChanged((data) => {
      if (data.taskId === taskId) void refetch();
    });
    return () => {
      window.removeEventListener('dash:ports:invalidate', winHandler);
      offIpc();
    };
  }, [taskId]);

  const refresh = async () => {
    if (!taskId || refreshing) return;
    setRefreshing(true);
    try {
      const resp = await window.electronAPI.portsRefresh(taskId);
      if (resp.success && resp.data) setPorts(resp.data);
    } finally {
      setRefreshing(false);
    }
  };

  let up = 0;
  for (const p of ports) if (liveness[p.hostPort] === 'up') up++;

  return {
    ports,
    liveness,
    refreshing,
    hasContent: ports.length > 0,
    livenessSummary: { up, total: ports.length },
    refresh,
  };
}
