import { create } from 'zustand';
import { toast } from 'sonner';
import type {
  ActivityInfo,
  AutoUpdateStatus,
  ClaudeCliInfo,
  RemoteControlState,
  SupervisorSession,
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
  /** Startup `claude --version` probe; null until it answers. MainContent gates
   *  the task terminal on `supported`. */
  claudeCli: ClaudeCliInfo | null;
  /** Every session under Claude Code's supervisor (`claude agents --json --all`),
   *  refreshed by main's reconcile loop. Task-owned rows are matched by
   *  `Task.jobId`; the rest are "foreign" and listed per project. */
  supervisorSessions: SupervisorSession[];
  /** The updater's whole state, or null before main has answered. Drives the
   *  sidebar banner and the Settings → Updates card. */
  updateStatus: AutoUpdateStatus | null;
}

export interface RuntimeActions {
  refreshTokenRollups: () => Promise<void>;
  /** Re-read the CLI probe; `refresh` re-runs `claude --version` in main. */
  refreshClaudeCli: (opts?: { refresh?: boolean }) => Promise<void>;
  /** Ask main for a fresh supervisor listing. */
  refreshSessions: () => Promise<void>;
  stopSession: (jobId: string) => Promise<void>;
  removeSession: (jobId: string) => Promise<void>;
  /** Turn a foreign session into a task under `projectId`; resolves with the task. */
  adoptSession: (projectId: string, jobId: string) => Promise<Task | null>;
  /** Ask main to look for an update now (bypasses the background cooldown). */
  checkForUpdates: () => Promise<void>;
  /** Restart into a downloaded update. */
  installUpdate: () => Promise<void>;
  /** Wire every live IPC subscription; returns a combined cleanup. */
  init: () => () => void;
}

export type RuntimeStore = RuntimeState & RuntimeActions;

export const useRuntime = create<RuntimeStore>((set, get) => ({
  taskActivity: {},
  remoteControlStates: {},
  projectTokenStats: {},
  globalTokenStats: { totalTokens: 0, totalCostUsd: 0, taskCount: 0 },
  claudeCli: null,
  supervisorSessions: [],
  updateStatus: null,

  refreshClaudeCli: async (opts) => {
    const resp = await window.electronAPI.detectClaude(opts);
    if (resp.success && resp.data) set({ claudeCli: resp.data });
    else console.warn('[detectClaude] failed:', resp.error);
  },

  refreshSessions: async () => {
    const resp = await window.electronAPI.sessionList({ refresh: true });
    if (resp.success && resp.data) set({ supervisorSessions: resp.data });
  },

  stopSession: async (jobId) => {
    const resp = await window.electronAPI.sessionStop(jobId);
    if (!resp.success) toast.error(resp.error ?? 'Could not stop the session');
  },

  removeSession: async (jobId) => {
    const resp = await window.electronAPI.sessionRemove(jobId);
    if (!resp.success) toast.error(resp.error ?? 'Could not remove the session');
  },

  adoptSession: async (projectId, jobId) => {
    const resp = await window.electronAPI.sessionAdopt({ projectId, jobId });
    if (!resp.success || !resp.data) {
      toast.error(resp.error ?? 'Could not adopt the session');
      return null;
    }
    await useProjects.getState().loadTasks(projectId);
    return resp.data;
  },

  checkForUpdates: async () => {
    const resp = await window.electronAPI.autoUpdateCheck();
    if (!resp.success) {
      toast.error(resp.error ?? 'Could not check for updates');
      return;
    }
    // The check may have been a no-op (already downloading, or inside the
    // cooldown) without emitting anything, so reconcile from the source of
    // truth — otherwise the card can sit on "Checking…" forever.
    const status = await window.electronAPI.autoUpdateGetStatus();
    if (status.success && status.data) set({ updateStatus: status.data });
  },

  installUpdate: async () => {
    const resp = await window.electronAPI.autoUpdateQuitAndInstall();
    if (!resp.success) toast.error(resp.error ?? 'Could not install the update');
  },

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

  init: () => {
    const cleanups: Array<() => void> = [];

    // ── Activity (PTY busy/idle) ───────────────────────────
    {
      const prevState: Record<string, string> = {};
      // PTYs that have been idle at least once — skip the initial busy→idle that
      // fires when a task's activity entry first registers. `stopped` (session
      // parked by the supervisor) counts as a resting state too.
      const hasBeenIdle = new Set<string>();
      const isResting = (state: string) => state === 'idle' || state === 'stopped';
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
          if (isResting(info.state)) hasBeenIdle.add(id);
        }
        for (const id of hasBeenIdle) {
          if (!(id in newActivity)) hasBeenIdle.delete(id);
        }
        for (const k of Object.keys(prevState)) delete prevState[k];
        for (const [id, info] of Object.entries(newActivity)) prevState[id] = info.state;

        set({ taskActivity: newActivity });
      });
      cleanups.push(unsub);

      void window.electronAPI.ptyGetAllActivity().then((resp) => {
        if (resp.success && resp.data) {
          for (const [id, info] of Object.entries(resp.data)) {
            prevState[id] = info.state;
            if (isResting(info.state)) hasBeenIdle.add(id);
          }
          set({ taskActivity: resp.data });
        }
      });
    }

    // ── Supervisor sessions ────────────────────────────────
    {
      const unsub = window.electronAPI.onSessionList((rows) => set({ supervisorSessions: rows }));
      cleanups.push(unsub);
      void window.electronAPI.sessionList().then((resp) => {
        if (resp.success && resp.data) set({ supervisorSessions: resp.data });
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

      void window.electronAPI.ptyRemoteControlGetAllStates().then((resp) => {
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
        void get().refreshTokenRollups();
      });
      cleanups.push(unsub);
    }

    // ── Auto-update ────────────────────────────────────────
    {
      const unsub = window.electronAPI.onAutoUpdateStatus((next) => set({ updateStatus: next }));
      cleanups.push(unsub);
      void window.electronAPI.autoUpdateGetStatus().then((resp) => {
        if (resp.success && resp.data) set({ updateStatus: resp.data });
      });
    }

    // ── Claude CLI floor ───────────────────────────────────
    void get()
      .refreshClaudeCli()
      .catch((err) => console.warn('[detectClaude] failed:', err));

    return () => cleanups.forEach((fn) => fn());
  },
}));
