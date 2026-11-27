import { create } from 'zustand';
import { toast } from '../components/ui/toast';
import type {
  ActivityInfo,
  AutoUpdateStatus,
  ClaudeCliInfo,
  ClaudeUpdateMode,
  ClaudeUpdateState,
  ContextUsage,
  RateLimits,
  RemoteControlState,
  StatusLineData,
  SupervisorSession,
  Task,
} from '../../shared/types';
import { playNotificationSound, playPeonSound } from '../sounds';
import { limitPaces, recordLimits, type LimitHistories, type LimitPaces } from '../lib/pace';
import { mergeRateLimits } from '../lib/rateLimits';
import { replaceEqualDeep } from '../lib/replaceEqualDeep';
import { emptyTracker, observeActivity } from './activityTransitions';
import { useProjects } from './projectsStore';
import { useSettings } from './settingsStore';

interface TokenStatsRollup {
  totalTokens: number;
  totalCostUsd: number;
  taskCount: number;
}

/*
 * Every IPC push is a fresh copy of the whole map, so each set below goes
 * through `replaceEqualDeep`: an entry that didn't change keeps its identity,
 * and a component selecting one task's entry renders only when that task's
 * changed. Select the narrowest slice (`s.taskActivity[id]`), not the map.
 */
export interface RuntimeState {
  taskActivity: Record<string, ActivityInfo>;
  /** Each live session's last status line (context, cost, limits, model), by task id. */
  statusLine: Record<string, StatusLineData>;
  /** Each live session's context, from its status line, by task id. */
  contextUsage: Record<string, ContextUsage>;
  /** The account's limits, merged across the sessions' status lines (`mergeRateLimits`). */
  rateLimits: RateLimits | undefined;
  /** Recent readings of the limits, in memory, for their pace. */
  limitHistories: LimitHistories;
  /** Each limit's pace, from `limitHistories`. */
  paces: LimitPaces;
  remoteControlStates: Record<string, RemoteControlState>;
  projectTokenStats: Record<string, TokenStatsRollup>;
  /** Memories written since each project's memory last showed (the Agent tab), by project id. */
  newMemoryCounts: Record<string, number>;
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
  /** Live sessions on an older Claude Code than the installed one, and any
   *  restart onto it in progress; null before main has answered. */
  claudeUpdate: ClaudeUpdateState | null;
}

export interface RuntimeActions {
  refreshTokenRollups: () => Promise<void>;
  refreshNewMemoryCounts: () => Promise<void>;
  /** The project's memory showed: clear its badge, here and in the DB. */
  markMemorySeen: (projectId: string) => Promise<void>;
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
  /** Restart the outdated sessions on the installed Claude Code, now or once every task is done. */
  restartClaudeSessions: (mode: ClaudeUpdateMode) => Promise<void>;
  /** Drop a pending "restart when done". */
  cancelClaudeRestart: () => Promise<void>;
  /** Wire every live IPC subscription; returns a combined cleanup. */
  init: () => () => void;
}

export type RuntimeStore = RuntimeState & RuntimeActions;

/** The tasks with a live session: any activity but `stopped` (a sleeping
 *  session has no orb). For a `useShallow` selector: the ids, not the map. */
export function liveSessionIds(activity: Record<string, ActivityInfo>): string[] {
  return Object.keys(activity).filter((id) => activity[id]!.state !== 'stopped');
}

export const useRuntime = create<RuntimeStore>((set, get) => ({
  taskActivity: {},
  statusLine: {},
  contextUsage: {},
  rateLimits: undefined,
  limitHistories: {},
  paces: {},
  remoteControlStates: {},
  projectTokenStats: {},
  newMemoryCounts: {},
  globalTokenStats: { totalTokens: 0, totalCostUsd: 0, taskCount: 0 },
  claudeCli: null,
  supervisorSessions: [],
  updateStatus: null,
  claudeUpdate: null,

  refreshClaudeCli: async (opts) => {
    const resp = await window.electronAPI.detectClaude(opts);
    if (resp.success && resp.data) set({ claudeCli: resp.data });
    else console.warn('[detectClaude] failed:', resp.error);
  },

  refreshSessions: async () => {
    const resp = await window.electronAPI.sessionList({ refresh: true });
    const rows = resp.success ? resp.data : undefined;
    if (rows) set((s) => ({ supervisorSessions: replaceEqualDeep(s.supervisorSessions, rows) }));
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

  restartClaudeSessions: async (mode) => {
    const resp = await window.electronAPI.claudeUpdateRestart(mode);
    if (!resp.success) toast.error(resp.error ?? 'Could not restart the sessions');
  },

  cancelClaudeRestart: async () => {
    const resp = await window.electronAPI.claudeUpdateCancel();
    if (!resp.success) toast.error(resp.error ?? 'Could not cancel the restart');
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

  refreshNewMemoryCounts: async () => {
    const resp = await window.electronAPI.memoryNewCounts();
    if (resp.success && resp.data) set({ newMemoryCounts: resp.data });
  },

  markMemorySeen: async (projectId) => {
    set((s) => ({ newMemoryCounts: { ...s.newMemoryCounts, [projectId]: 0 } }));
    const resp = await window.electronAPI.memoryMarkSeen({ projectId });
    if (!resp.success) console.warn('[memoryMarkSeen] failed:', resp.error);
  },

  init: () => {
    const cleanups: Array<() => void> = [];

    // ── Activity (PTY busy/idle) ───────────────────────────
    {
      let tracker = emptyTracker();
      const observe = (activity: Record<string, ActivityInfo>) => {
        const r = observeActivity(tracker, activity, Date.now());
        tracker = r.tracker;
        return r;
      };

      const unsub = window.electronAPI.onPtyActivity((newActivity) => {
        const sound = useSettings.getState().notificationSound;
        const { finished, started } = observe(newActivity);
        // Peon mode: an idle → busy transition (the user submitted a prompt).
        if (sound === 'peon' && started.length > 0) playPeonSound('yes');
        if (finished.length > 0) {
          playNotificationSound(sound);
          const currentActiveId = useProjects.getState().activeTaskId;
          const toMarkUnseen = finished.filter((id) => id !== currentActiveId);
          if (toMarkUnseen.length > 0) {
            useSettings.getState().setUnseenTaskIds((prev) => new Set([...prev, ...toMarkUnseen]));
          }
        }
        set((s) => ({ taskActivity: replaceEqualDeep(s.taskActivity, newActivity) }));
      });
      cleanups.push(unsub);

      void window.electronAPI.ptyGetAllActivity().then((resp) => {
        if (resp.success && resp.data) {
          observe(resp.data);
          const data = resp.data;
          set((s) => ({ taskActivity: replaceEqualDeep(s.taskActivity, data) }));
        }
      });
    }

    // ── Status line (context, cost, limits, model) ─────────
    // Stale entries go with ContextUsageService.unregister() on PTY exit.
    {
      const receive = (data: Record<string, StatusLineData>) => {
        const now = Date.now();
        set((s) => {
          const statusLine = replaceEqualDeep(s.statusLine, data);
          const contextUsage = replaceEqualDeep(
            s.contextUsage,
            Object.fromEntries(Object.entries(statusLine).map(([id, sl]) => [id, sl.contextUsage])),
          );
          const rateLimits = replaceEqualDeep(s.rateLimits, mergeRateLimits(statusLine, now));
          const limitHistories = rateLimits
            ? recordLimits(s.limitHistories, rateLimits, now)
            : s.limitHistories;
          const paces = replaceEqualDeep(s.paces, limitPaces(limitHistories, rateLimits ?? {}));
          return { statusLine, contextUsage, rateLimits, limitHistories, paces };
        });
      };
      cleanups.push(window.electronAPI.onPtyStatusLine(receive));
      window.electronAPI
        .ptyGetAllStatusLine()
        .then((resp) => {
          if (resp.success && resp.data) receive(resp.data);
        })
        .catch((err) => console.warn('[statusLine] Initial fetch failed:', err));
    }

    // ── Supervisor sessions ────────────────────────────────
    {
      const receive = (rows: SupervisorSession[]) =>
        set((s) => ({ supervisorSessions: replaceEqualDeep(s.supervisorSessions, rows) }));
      cleanups.push(window.electronAPI.onSessionList(receive));
      void window.electronAPI.sessionList().then((resp) => {
        if (resp.success && resp.data) receive(resp.data);
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
        // Only the task's own project gets a new array, and only on a change.
        useProjects.setState((s) => {
          for (const [projectId, list] of Object.entries(s.tasksByProject)) {
            const task = list.find((t) => t.id === update.taskId);
            if (!task) continue;
            if (
              task.totalTokens === update.totalTokens &&
              task.totalCostUsd === update.totalCostUsd
            ) {
              return {};
            }
            const nextTask = {
              ...task,
              totalTokens: update.totalTokens,
              totalCostUsd: update.totalCostUsd,
            };
            return {
              tasksByProject: {
                ...s.tasksByProject,
                [projectId]: list.map((t) => (t === task ? nextTask : t)),
              },
            };
          }
          return {};
        });
        void get().refreshTokenRollups();
      });
      cleanups.push(unsub);
    }

    // ── New-memory badges (main watches every project's memory folder) ─
    {
      const unsub = window.electronAPI.onMemoryNewCount(({ projectId, count }) =>
        set((s) => ({ newMemoryCounts: { ...s.newMemoryCounts, [projectId]: count } })),
      );
      cleanups.push(unsub);
      void get()
        .refreshNewMemoryCounts()
        .catch((err) => console.warn('[memoryNewCounts] failed:', err));
    }

    // ── Auto-update ────────────────────────────────────────
    {
      const unsub = window.electronAPI.onAutoUpdateStatus((next) => set({ updateStatus: next }));
      cleanups.push(unsub);
      void window.electronAPI.autoUpdateGetStatus().then((resp) => {
        if (resp.success && resp.data) set({ updateStatus: resp.data });
      });
    }

    // ── Claude Code update (live sessions on an older CLI) ─
    {
      const unsub = window.electronAPI.onClaudeUpdateState((next) => set({ claudeUpdate: next }));
      cleanups.push(unsub);
      void window.electronAPI.claudeUpdateGetState().then((resp) => {
        if (resp.success && resp.data) set({ claudeUpdate: resp.data });
      });
    }

    // ── Claude CLI floor ───────────────────────────────────
    void get()
      .refreshClaudeCli()
      .catch((err) => console.warn('[detectClaude] failed:', err));

    return () => cleanups.forEach((fn) => fn());
  },
}));
