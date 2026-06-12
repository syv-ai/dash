import { create } from 'zustand';
import { toast } from 'sonner';
import type {
  ActivityInfo,
  RemoteControlState,
  RtkStatus,
  RtkDownloadProgress,
  Task,
} from '../../shared/types';
import { playNotificationSound, playPeonSound } from '../sounds';
import { useProjects } from './projectsStore';
import { useSettings } from './settingsStore';

const MIN_BUSY_DURATION_MS = 3000;

interface TokenStatsRollup {
  totalTokens: number;
  totalCostUsd: number;
  taskCount: number;
}

export interface RuntimeState {
  taskActivity: Record<string, ActivityInfo>;
  remoteControlStates: Record<string, RemoteControlState>;
  projectTokenStats: Record<string, TokenStatsRollup>;
  globalTokenStats: TokenStatsRollup;
  rtkStatus: RtkStatus | null;
  rtkDownloadProgress: RtkDownloadProgress | null;
}

export interface RuntimeActions {
  refreshTokenRollups: () => Promise<void>;
  enableRtk: (enabled: boolean) => Promise<void>;
  downloadRtk: () => Promise<void>;
  /** Wire every live IPC subscription; returns a combined cleanup. */
  init: () => () => void;
}

export type RuntimeStore = RuntimeState & RuntimeActions;

export const useRuntime = create<RuntimeStore>((set, get) => ({
  taskActivity: {},
  remoteControlStates: {},
  projectTokenStats: {},
  globalTokenStats: { totalTokens: 0, totalCostUsd: 0, taskCount: 0 },
  rtkStatus: null,
  rtkDownloadProgress: null,

  refreshTokenRollups: async () => {
    const { projects } = useProjects.getState();
    const global = await window.electronAPI.getGlobalTokenStats();
    if (global.success && global.data) set({ globalTokenStats: global.data });
    const entries = await Promise.all(
      projects.map(async (p) => {
        const r = await window.electronAPI.getProjectTokenStats(p.id);
        return [
          p.id,
          r.success && r.data ? r.data : { totalTokens: 0, totalCostUsd: 0, taskCount: 0 },
        ] as const;
      }),
    );
    set({ projectTokenStats: Object.fromEntries(entries) });
  },

  enableRtk: async (enabled) => {
    // Optimistic update only applies to the installed arm — the type forbids
    // `enabled` on { installed: false }.
    set((s) => ({
      rtkStatus: s.rtkStatus?.installed ? { ...s.rtkStatus, enabled } : s.rtkStatus,
    }));
    const resp = await window.electronAPI.rtkSetEnabled(enabled);
    if (!resp.success) {
      toast.error(resp.error ?? 'Failed to toggle RTK');
      const s = await window.electronAPI.rtkGetStatus();
      if (s.success && s.data) set({ rtkStatus: s.data });
      else console.error('[rtk:getStatus after setEnabled failure]', s.error);
      return;
    }
    if (resp.data?.warning) toast.warning(resp.data.warning);
  },

  downloadRtk: async () => {
    set({ rtkDownloadProgress: { phase: 'downloading', percent: 0 } });
    const resp = await window.electronAPI.rtkDownload();
    if (!resp.success) {
      set({ rtkDownloadProgress: { phase: 'error', error: resp.error ?? 'download failed' } });
      return;
    }
    if (resp.data?.warning) toast.warning(resp.data.warning);
  },

  init: () => {
    const cleanups: Array<() => void> = [];

    // ── Activity (PTY busy/idle) ───────────────────────────
    {
      const prevState: Record<string, string> = {};
      // PTYs that have been idle at least once — skip the initial busy→idle that
      // fires when a direct-spawn PTY first registers.
      const hasBeenIdle = new Set<string>();
      // When each PTY entered busy, so we can ignore brief flashes (< 3s).
      const busySince: Record<string, number> = {};

      const unsub = window.electronAPI.onPtyActivity((newActivity) => {
        const sound = useSettings.getState().notificationSound;
        // Peon mode: detect idle→busy transitions (user submits query).
        if (sound === 'peon') {
          for (const [id, info] of Object.entries(newActivity)) {
            if (prevState[id] === 'idle' && info.state === 'busy' && hasBeenIdle.has(id)) {
              playPeonSound('yes');
              break;
            }
          }
        }
        // busy→idle transitions for PTYs that completed a full work cycle.
        const newlyDoneIds: string[] = [];
        for (const [id, info] of Object.entries(newActivity)) {
          if (prevState[id] === 'busy' && info.state === 'idle' && hasBeenIdle.has(id)) {
            const elapsed = Date.now() - (busySince[id] ?? Date.now());
            if (elapsed >= MIN_BUSY_DURATION_MS) newlyDoneIds.push(id);
          }
        }
        // Track busy start times (after detection — busySince still read above).
        for (const [id, info] of Object.entries(newActivity)) {
          if (info.state === 'busy' && prevState[id] !== 'busy') busySince[id] = Date.now();
          else if (info.state !== 'busy') delete busySince[id];
        }
        if (newlyDoneIds.length > 0) {
          playNotificationSound(sound);
          const currentActiveId = useProjects.getState().activeTaskId;
          const toMarkUnseen = newlyDoneIds.filter((id) => id !== currentActiveId);
          if (toMarkUnseen.length > 0) {
            useSettings.getState().setUnseenTaskIds((prev) => new Set([...prev, ...toMarkUnseen]));
          }
        }
        for (const [id, info] of Object.entries(newActivity)) {
          if (info.state === 'idle') hasBeenIdle.add(id);
        }
        for (const id of hasBeenIdle) {
          if (!(id in newActivity)) hasBeenIdle.delete(id);
        }
        for (const k of Object.keys(prevState)) delete prevState[k];
        for (const [id, info] of Object.entries(newActivity)) prevState[id] = info.state;

        set({ taskActivity: newActivity });
      });
      cleanups.push(unsub);

      window.electronAPI.ptyGetAllActivity().then((resp) => {
        if (resp.success && resp.data) {
          for (const [id, info] of Object.entries(resp.data)) {
            prevState[id] = info.state;
            if (info.state === 'idle') hasBeenIdle.add(id);
          }
          set({ taskActivity: resp.data });
        }
      });
    }

    // ── Remote control ─────────────────────────────────────
    {
      const unsub = window.electronAPI.onRemoteControlStateChanged(({ ptyId, state }) => {
        set((s) => {
          if (!state) {
            const next = { ...s.remoteControlStates };
            delete next[ptyId];
            return { remoteControlStates: next };
          }
          return { remoteControlStates: { ...s.remoteControlStates, [ptyId]: state } };
        });
      });
      cleanups.push(unsub);

      window.electronAPI.ptyRemoteControlGetAllStates().then((resp) => {
        if (resp.success && resp.data) set({ remoteControlStates: resp.data });
      });
    }

    // ── Token stats: write per-task rollups back into projectsStore ─
    {
      const unsub = window.electronAPI.onTokenStatsUpdated((update) => {
        useProjects.setState((s) => {
          const next: Record<string, Task[]> = {};
          for (const [projectId, list] of Object.entries(s.tasksByProject)) {
            next[projectId] = list.map((t) =>
              t.id === update.taskId
                ? { ...t, totalTokens: update.totalTokens, totalCostUsd: update.totalCostUsd }
                : t,
            );
          }
          return { tasksByProject: next };
        });
        get().refreshTokenRollups();
      });
      cleanups.push(unsub);
    }

    // ── RTK status + download progress ─────────────────────
    {
      let cancelled = false;
      // Retry once on transient failure — a single startup flake otherwise leaves
      // rtkStatus null forever and the Settings card stays stuck on "loading…".
      const tryFetch = (attempt: number): void => {
        window.electronAPI.rtkGetStatus().then((resp) => {
          if (cancelled) return;
          if (resp.success && resp.data) set({ rtkStatus: resp.data });
          else if (attempt < 1) setTimeout(() => tryFetch(attempt + 1), 500);
          else set({ rtkStatus: { installed: false, downloadable: false } });
        });
      };
      tryFetch(0);
      const unsub = window.electronAPI.onRtkDownloadProgress((progress) => {
        set({ rtkDownloadProgress: progress });
        if (progress.phase === 'done') {
          window.electronAPI.rtkGetStatus().then((resp) => {
            if (resp.success && resp.data) set({ rtkStatus: resp.data });
          });
        }
      });
      cleanups.push(() => {
        cancelled = true;
        unsub();
      });
    }

    return () => cleanups.forEach((fn) => fn());
  },
}));
