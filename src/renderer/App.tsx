import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { TUI_FEATURE_IDS, TUI_COLS, TUI_ROWS } from '@shared/tuiProtocol';
import { LeftSidebar } from './components/leftSidebar/LeftSidebar';
import { MainContent } from './components/MainContent';
import { openInIde } from './lib/openInIde';
import { RightInspector } from './components/rightInspector/RightInspector';
import { PortsDrawerWrapper } from './components/rightInspector/PortsDrawerWrapper';
const DiffEditor = lazy(() => import('./components/diffEditor/DiffEditor'));
import { ShellDrawerWrapper } from './components/ShellDrawerWrapper';
import { CommitGraphModal } from './components/CommitGraph/CommitGraphModal';
import { SkillsBrowserModal } from './components/SkillsBrowserModal';
import { TaskModal } from './components/TaskModal';
import { AddProjectModal } from './components/AddProjectModal';
import { DeleteTaskModal } from './components/DeleteTaskModal';
import { DeleteProjectModal } from './components/DeleteProjectModal';
import { RemoteControlModal } from './components/RemoteControlModal';
import { SettingsModal } from './components/SettingsModal';
import { ProjectSettingsModal } from './components/ProjectSettingsModal';
import { TaskSettingsModal } from './components/TaskSettingsModal';
import { AdoSetupModal } from './components/AdoSetupModal';
import { isAdoRemote } from '../shared/urls';
import { ToastContainer } from './components/Toast';
import { toast } from 'sonner';
import { getBillionToastContent } from './utils/billionToast';
import { useStatusLine } from './hooks/useStatusLine';
import { useThresholdAlerts } from './hooks/useThresholdAlerts';
import type {
  Task,
  GitStatus,
  RemoteControlState,
  ActivityInfo,
  PullRequestInfo,
  RtkStatus,
  RtkDownloadProgress,
} from '../shared/types';
import type { CreateTaskOptions } from './components/TaskModal';
import { matchesBinding } from './keybindings';
import { sessionRegistry } from './terminal/SessionRegistry';
import { resolveTheme } from './terminal/terminalThemes';
import { resolveTerminalFontValue } from './terminal/terminalFonts';
import { playNotificationSound, playPeonSound } from './sounds';
import { useSettings } from './stores/settingsStore';
import { useUi } from './stores/uiStore';
import { useShallow } from 'zustand/react/shallow';
import {
  useProjects,
  selectActiveProject,
  selectActiveTask,
  selectActiveProjectTasks,
} from './stores/projectsStore';

const GIT_POLL_INTERVAL = 5000;
/** Chrome around the pinned TUI canvas (panel padding + drawer gutter) added
 *  to the measured canvas px so the panel hugs it without clipping. */
const TUI_PANEL_CHROME_PX = 52;
/** Trim the hugged panel width — the canvas has built-in right whitespace, so
 *  the panel can sit narrower than the full canvas without clipping content. */
const TUI_PANEL_WIDTH_SCALE = 0.85;
/** Bounds for the hugged right-panel width (%) — matches the panel's min/max. */
const TUI_PANEL_MIN_PCT = 12;
const TUI_PANEL_MAX_PCT = 40;
const EMPTY_CONTEXT_USAGE: Record<string, import('../shared/types').ContextUsage> = {};

export function App() {
  // Projects/tasks domain state lives in projectsStore; subscribe via selectors.
  const projects = useProjects((s) => s.projects);
  const tasksByProject = useProjects((s) => s.tasksByProject);
  const activeProjectId = useProjects((s) => s.activeProjectId);
  const activeTaskId = useProjects((s) => s.activeTaskId);
  const isCreatingTask = useProjects((s) => s.isCreatingTask);
  // Pre-resolved for the TaskModal so the issue picker + branch banner render at
  // their final size on first paint, instead of popping in mid-mount.
  const ghAvailable = useProjects((s) => s.ghAvailable);
  const adoConfiguredById = useProjects((s) => s.adoConfiguredById);
  const branchesByProject = useProjects((s) => s.branchesByProject);
  // Action aliases keep existing call sites compiling unchanged.
  const setActiveProjectId = useProjects((s) => s.setActiveProject);
  const setActiveTaskId = useProjects((s) => s.setActiveTask);
  // ── UI / modal state (uiStore) ───────────────────────────
  const showTaskModal = useUi((s) => s.showTaskModal);
  const setShowTaskModal = useUi((s) => s.setShowTaskModal);
  const taskModalProjectId = useUi((s) => s.taskModalProjectId);
  const setTaskModalProjectId = useUi((s) => s.setTaskModalProjectId);
  const showAddProjectModal = useUi((s) => s.showAddProjectModal);
  const setShowAddProjectModal = useUi((s) => s.setShowAddProjectModal);
  const cloneStatus = useUi((s) => s.cloneStatus);
  const setCloneStatus = useUi((s) => s.setCloneStatus);
  const deleteTaskTarget = useUi((s) => s.deleteTaskTarget);
  const setDeleteTaskTarget = useUi((s) => s.setDeleteTaskTarget);
  const deleteProjectTarget = useUi((s) => s.deleteProjectTarget);
  const setDeleteProjectTarget = useUi((s) => s.setDeleteProjectTarget);
  const projectSettingsTarget = useUi((s) => s.projectSettingsTarget);
  const setProjectSettingsTarget = useUi((s) => s.setProjectSettingsTarget);
  const taskSettingsTarget = useUi((s) => s.taskSettingsTarget);
  const setTaskSettingsTarget = useUi((s) => s.setTaskSettingsTarget);
  const adoSetup = useUi((s) => s.adoSetup);
  const setAdoSetup = useUi((s) => s.setAdoSetup);
  const showSettings = useUi((s) => s.showSettings);
  const setShowSettings = useUi((s) => s.setShowSettings);
  const showSkillsBrowser = useUi((s) => s.showSkillsBrowser);
  const setShowSkillsBrowser = useUi((s) => s.setShowSkillsBrowser);
  const settingsInitialTab = useUi((s) => s.settingsInitialTab);
  const setSettingsInitialTab = useUi((s) => s.setSettingsInitialTab);
  const theme = useSettings((s) => s.theme);
  const keybindings = useSettings((s) => s.keybindings);
  const notificationSound = useSettings((s) => s.notificationSound);
  const desktopNotification = useSettings((s) => s.desktopNotification);
  const autoUpdateEnabled = useSettings((s) => s.autoUpdateEnabled);
  const setAutoUpdateEnabled = useSettings((s) => s.setAutoUpdateEnabled);
  const updateNotificationsEnabled = useSettings((s) => s.updateNotificationsEnabled);
  const shellDrawerCollapsed = useSettings((s) => s.shellDrawerCollapsed);
  const setShellDrawerCollapsed = useSettings((s) => s.setShellDrawerCollapsed);
  // Ports drawer defaults to collapsed so it doesn't intrude on projects
  // that aren't using port management; the collapsed bar still shows status.
  const portsDrawerCollapsed = useSettings((s) => s.portsDrawerCollapsed);
  const setPortsDrawerCollapsed = useSettings((s) => s.setPortsDrawerCollapsed);
  const shellDrawerPosition = useSettings((s) => s.shellDrawerPosition);
  const terminalTheme = useSettings((s) => s.terminalTheme);
  const terminalFontFamily = useSettings((s) => s.terminalFontFamily);
  const setPreferredIDE = useSettings((s) => s.setPreferredIDE);
  const availableIDEs = useProjects((s) => s.availableIDEs);

  // One-shot localStorage → SQLite migration for drawer tabs. After upgrading
  // past commit 3, per-task tab state lives in the drawer_tabs table owned by
  // main. We scrape the old `shellTabs:*` / `shellActiveTab:*` keys and hand
  // them to drawerTabsBulkUpsert; once the IPC succeeds, the keys are deleted
  // so subsequent mounts no-op.
  useEffect(() => {
    const entries: Array<{
      taskId: string;
      tabs: Array<{ id: string; kind: 'shell' | 'tui'; label: string; position: number }>;
      activeTabId: string | null;
    }> = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('shellTabs:')) continue;
      const taskId = key.slice('shellTabs:'.length);
      try {
        const raw = JSON.parse(localStorage.getItem(key) ?? '[]');
        if (!Array.isArray(raw)) continue;
        entries.push({
          taskId,
          tabs: raw.map((t: { id: string; label?: string }, idx: number) => ({
            id: t.id,
            kind: 'shell' as const,
            label: t.label ?? String(idx + 1),
            position: idx,
          })),
          activeTabId: localStorage.getItem(`shellActiveTab:${taskId}`),
        });
      } catch {
        /* skip corrupted */
      }
    }

    if (entries.length === 0) return;
    window.electronAPI.drawerTabsBulkUpsert(entries).then((resp) => {
      if (!resp.success) return;
      for (const e of entries) {
        localStorage.removeItem(`shellTabs:${e.taskId}`);
        localStorage.removeItem(`shellActiveTab:${e.taskId}`);
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.detectAvailableIDEs().then((res) => {
      if (cancelled) return;
      if (!res.success || !res.data) {
        console.warn('[openInIDE] Failed to detect available IDEs:', res.error);
        return;
      }
      useProjects.getState().setAvailableIDEs(res.data);
      // Self-heal: if the stored IDE was uninstalled, fall back to auto so
      // Settings doesn't show a phantom selection and clicks don't 404.
      setPreferredIDE((current) => {
        if (current === 'auto' || current === 'custom') return current;
        if (res.data!.some((d) => d.id === current)) return current;
        return 'auto';
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const commitAttribution = useSettings((s) => s.commitAttribution);
  const effortLevel = useSettings((s) => s.effortLevel);
  const syncShellEnv = useSettings((s) => s.syncShellEnv);
  const customClaudeEnvVars = useSettings((s) => s.customClaudeEnvVars);
  // RTK state
  const [rtkStatus, setRtkStatus] = useState<RtkStatus | null>(null);
  const [rtkDownloadProgress, setRtkDownloadProgress] = useState<RtkDownloadProgress | null>(null);

  useEffect(() => {
    // Retry once on transient failure — without it, a single flake at startup
    // leaves rtkStatus null forever and the Settings card stays stuck on
    // "loading…".
    let cancelled = false;
    const tryFetch = (attempt: number): void => {
      window.electronAPI.rtkGetStatus().then((resp) => {
        if (cancelled) return;
        if (resp.success && resp.data) {
          setRtkStatus(resp.data);
        } else if (attempt < 1) {
          console.warn('[rtk:getStatus] retrying after transient failure:', resp.error);
          setTimeout(() => tryFetch(attempt + 1), 500);
        } else {
          console.error('[rtk:getStatus] gave up after retry:', resp.error);
          // Sentinel so the Settings card stops spinning. `enabled` is
          // unrepresentable on the not-installed arm by design.
          setRtkStatus({ installed: false, downloadable: false });
        }
      });
    };
    tryFetch(0);
    const cleanup = window.electronAPI.onRtkDownloadProgress((progress) => {
      setRtkDownloadProgress(progress);
      if (progress.phase === 'done') {
        window.electronAPI.rtkGetStatus().then((resp) => {
          if (resp.success && resp.data) setRtkStatus(resp.data);
          else console.error('[rtk:getStatus after download]', resp.error);
        });
      }
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  // Sync desktop notification settings to main process
  useEffect(() => {
    window.electronAPI.setDesktopNotification?.({
      enabled: desktopNotification,
    });
  }, [desktopNotification]);

  // Hydrate auto-update preference from main (file is source of truth) on mount.
  // Gate the sync-to-main effect on this so the localStorage-derived initial
  // value can't overwrite the file before we've read it.
  const autoUpdateHydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.autoUpdateGetEnabled?.().then((res) => {
      if (cancelled) return;
      if (res.success && typeof res.data === 'boolean') {
        setAutoUpdateEnabled(res.data);
      }
      autoUpdateHydratedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync auto-update enabled to main process (only after hydration)
  useEffect(() => {
    if (!autoUpdateHydratedRef.current) return;
    window.electronAPI.autoUpdateSetEnabled?.(autoUpdateEnabled);
  }, [autoUpdateEnabled]);
  // Sync commit attribution to main process
  useEffect(() => {
    window.electronAPI.setCommitAttribution?.(commitAttribution);
  }, [commitAttribution]);
  // Sync shell env inheritance to main process
  useEffect(() => {
    window.electronAPI.setSyncShellEnv?.(syncShellEnv);
  }, [syncShellEnv]);
  // Sync Claude Code env vars to main process
  useEffect(() => {
    const vars: Record<string, string> = { ...customClaudeEnvVars };
    if (effortLevel !== 'auto') vars.CLAUDE_CODE_EFFORT_LEVEL = effortLevel;
    window.electronAPI.setClaudeEnvVars?.(vars);
  }, [effortLevel, customClaudeEnvVars]);

  // Activity state — keys are PTY IDs that have active sessions
  const [taskActivity, setTaskActivity] = useState<Record<string, ActivityInfo>>({});

  // Remote control state
  const [remoteControlStates, setRemoteControlStates] = useState<
    Record<string, RemoteControlState>
  >({});
  const remoteControlModalPtyId = useUi((s) => s.remoteControlModalPtyId);
  const setRemoteControlModalPtyId = useUi((s) => s.setRemoteControlModalPtyId);

  // Status line data (context + cost + rate limits) — derived contextUsage & latestRateLimits
  const { statusLineData, contextUsage, latestRateLimits } = useStatusLine();

  // Usage thresholds for popup notifications
  const usageThresholds = useSettings((s) => s.usageThresholds);

  const notificationSoundRef = useRef(notificationSound);
  useEffect(() => {
    notificationSoundRef.current = notificationSound;
  }, [notificationSound]);

  const unseenTaskIds = useSettings((s) => s.unseenTaskIds);
  const setUnseenTaskIds = useSettings((s) => s.setUnseenTaskIds);

  const activeTaskIdRef = useRef(activeTaskId);
  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);

  // Clear unseen when a task becomes active
  useEffect(() => {
    if (!activeTaskId) return;
    setUnseenTaskIds((prev) => {
      if (!prev.has(activeTaskId)) return prev;
      const next = new Set(prev);
      next.delete(activeTaskId);
      return next;
    });
  }, [activeTaskId]);

  // Right-sidebar: 5-hour / 7-day rate limit bars
  const showRateLimits = useSettings((s) => s.showRateLimits);
  const showUsageInline = useSettings((s) => s.showUsageInline);
  const showContextUsageOnTaskCards = useSettings((s) => s.showContextUsageOnTaskCards);

  // Rotation — tasks the user cycles through with Ctrl+Tab
  const showActiveTasksSection = useSettings((s) => s.showActiveTasksSection);
  const setShowActiveTasksSection = useSettings((s) => s.setShowActiveTasksSection);

  // Token-stats rollups (per-project + global). Live-updated via tokenStats:updated event.
  const [projectTokenStats, setProjectTokenStats] = useState<
    Record<string, { totalTokens: number; totalCostUsd: number; taskCount: number }>
  >({});
  const [globalTokenStats, setGlobalTokenStats] = useState<{
    totalTokens: number;
    totalCostUsd: number;
    taskCount: number;
  }>({ totalTokens: 0, totalCostUsd: 0, taskCount: 0 });

  const refreshTokenRollups = useCallback(async () => {
    const global = await window.electronAPI.getGlobalTokenStats();
    if (global.success && global.data) setGlobalTokenStats(global.data);
    const entries = await Promise.all(
      projects.map(async (p) => {
        const r = await window.electronAPI.getProjectTokenStats(p.id);
        return [
          p.id,
          r.success && r.data ? r.data : { totalTokens: 0, totalCostUsd: 0, taskCount: 0 },
        ] as const;
      }),
    );
    setProjectTokenStats(Object.fromEntries(entries));
  }, [projects]);

  useEffect(() => {
    refreshTokenRollups();
  }, [refreshTokenRollups]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onTokenStatsUpdated((update) => {
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
      refreshTokenRollups();
    });
    return unsubscribe;
  }, [refreshTokenRollups]);

  // Celebrate each billion-token milestone. The threshold filters out the
  // initial DB load (0 → multi-billion in one step) and one-shot backfill jumps
  // for individual tasks (can add hundreds of millions). Live recomputes
  // increment by a few thousand at a time, so any plausible single-step delta
  // is well under 50M.
  const prevGlobalTotalRef = useRef<number | null>(null);
  useEffect(() => {
    const newTotal = globalTokenStats.totalTokens;
    const prev = prevGlobalTotalRef.current;
    prevGlobalTotalRef.current = newTotal;

    if (prev === null) return;
    const delta = newTotal - prev;
    if (delta <= 0 || delta >= 50_000_000) return;

    const prevB = Math.floor(prev / 1_000_000_000);
    const newB = Math.floor(newTotal / 1_000_000_000);
    if (newB <= prevB) return;
    for (let b = prevB + 1; b <= newB; b++) {
      const { title, description } = getBillionToastContent(b, newTotal);
      toast.success(title, { description, duration: 8000 });
    }
  }, [globalTokenStats.totalTokens]);

  const rotationExclusions = useSettings((s) => s.rotationExclusions);
  const setRotationExclusions = useSettings((s) => s.setRotationExclusions);

  const rotationOrder = useSettings((s) => s.rotationOrder);
  const setRotationOrder = useSettings((s) => s.setRotationOrder);

  // Clean up rotationOrder: prune IDs for tasks that no longer exist
  useEffect(() => {
    const allTaskIds = new Set(
      Object.values(tasksByProject)
        .flat()
        .map((t) => t.id),
    );
    if (allTaskIds.size > 0 && rotationOrder.length > 0) {
      const pruned = rotationOrder.filter((id) => allTaskIds.has(id));
      if (pruned.length !== rotationOrder.length) {
        setRotationOrder(pruned);
      }
    }
  }, [tasksByProject]);

  // Git state
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [diffFile, setDiffFile] = useState<{
    cwd: string;
    filePath: string;
    staged: boolean;
    initialView?: { kind: 'working'; ref: 'HEAD' | 'index' } | { kind: 'commit'; hash: string };
  } | null>(null);
  const [prInfo, setPrInfo] = useState<PullRequestInfo | null>(null);
  const [showCommitGraph, setShowCommitGraph] = useState(false);

  const sidebarCollapsed = useSettings((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettings((s) => s.setSidebarCollapsed);
  const changesPanelCollapsed = useSettings((s) => s.changesPanelCollapsed);
  const setChangesPanelCollapsed = useSettings((s) => s.setChangesPanelCollapsed);

  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const changesPanelRef = useRef<ImperativePanelHandle>(null);
  const shellDrawerPanelRef = useRef<ImperativePanelHandle>(null);
  const sidebarAnimating = useUi((s) => s.sidebarAnimating);
  const setSidebarAnimating = useUi((s) => s.setSidebarAnimating);
  const changesAnimating = useUi((s) => s.changesAnimating);
  const setChangesAnimating = useUi((s) => s.setChangesAnimating);
  const shellDrawerAnimating = useUi((s) => s.shellDrawerAnimating);
  const setShellDrawerAnimating = useUi((s) => s.setShellDrawerAnimating);
  const fileWatcherCleanup = useRef<(() => void) | null>(null);
  const gitPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeProject = useProjects(selectActiveProject);

  // Color of the active terminal bg — used to make the main-pane header strip
  // blend with whatever palette the user has selected (default / Dracula / Tokyo Night / …)
  const terminalBg = useMemo(
    () => resolveTheme(terminalTheme, theme === 'dark').background || undefined,
    [terminalTheme, theme],
  );
  // Full ITheme passed to the file editor so its Monaco view matches the terminal.
  const resolvedTerminalTheme = useMemo(
    () => resolveTheme(terminalTheme, theme === 'dark'),
    [terminalTheme, theme],
  );

  const activeTask = useProjects(selectActiveTask);
  // All non-archived tasks for the active project (for cycling).
  // selectActiveProjectTasks filters → a fresh array every call, so it must be wrapped in
  // useShallow; a raw subscription feeds useSyncExternalStore an ever-changing snapshot and
  // loops infinitely. (selectActiveProject/Task return existing objects, so they're stable.)
  const activeProjectTasks = useProjects(useShallow(selectActiveProjectTasks));

  // Side-car TUI features (ports onboarding today). On active-task change,
  // ask main to spawn each feature's flow + Clack TUI inside a drawer tab —
  // unless the project dismissed the feature, or a TUI is already active or
  // suppressed for this task. Main owns the state machine; the renderer just
  // kicks it off.
  useEffect(() => {
    if (!activeTask || !activeTask.projectId) return;
    const project = projects.find((p) => p.id === activeTask.projectId);
    if (!project) return;
    const taskId = activeTask.id;
    const projectId = activeTask.projectId;
    const taskName = activeTask.name;
    const projectName = project.name;
    const cwd = activeTask.path;

    for (const featureId of TUI_FEATURE_IDS) {
      window.electronAPI.wizardActive({ featureId, taskId }).then((resp) => {
        if (resp.success && resp.data) return;
        window.electronAPI.requestWizard({
          featureId,
          taskId,
          projectId,
          taskName,
          projectName,
          cwd,
          cols: TUI_COLS,
          rows: TUI_ROWS,
        });
      });
    }
  }, [activeTask, projects]);

  // Orchestrator broadcasts ports:restart-task when the user picks 'restart'
  // on the DONE screen. SessionRegistry restarts both agent + shell PTYs so
  // they pick up the freshly allocated env vars (Dash injects them from
  // SQLite at spawn time).
  useEffect(() => {
    const off = window.electronAPI.onPortsRestartTask((tid) => {
      sessionRegistry.restartAllForTask(tid);
    });
    return off;
  }, []);

  // Ports TUI migrate flow: main created a `port-setup` worktree task and
  // already spawned the new orchestrator + side-car in its drawer. We need
  // to (a) refresh the source project's task list so the new task shows up
  // in the sidebar and (b) switch active to it so the user lands on the new
  // TUI. The payload's projectId (not activeProjectId) targets the right
  // project even if the user switched projects during the migrate window.
  useEffect(() => {
    const off = window.electronAPI.onPortsTuiMigrated(async ({ toTaskId, projectId }) => {
      await loadTasksForProject(projectId);
      setActiveProjectId(projectId);
      setActiveTaskId(toTaskId);
    });
    return off;
  }, []);

  // Memoized props for SkillsBrowserModal. Without these, App.tsx re-renders (terminal
  // activity, git polls, PTY events) hand the modal new array references every time,
  // and the modal's loadInstalled useCallback re-fires its refetch effect — flickering
  // the list back to a loading state on every unrelated re-render.
  const skillsModalProjects = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
    [projects],
  );
  const skillsModalActiveTasks = useMemo(
    () =>
      projects.flatMap((p) => {
        const tasks = tasksByProject[p.id] ?? [];
        // Only worktree-backed, non-archived tasks: a task without a worktree shares the
        // project root, so installing there would just be a project install.
        return tasks
          .filter((t) => t.useWorktree && !t.archivedAt)
          .map((t) => ({
            taskId: t.id,
            taskName: t.name,
            worktreePath: t.path,
            projectId: p.id,
            projectName: p.name,
          }));
      }),
    [projects, tasksByProject],
  );

  // Rotation: all tasks with activity, minus exclusions
  const rotationTasks = React.useMemo(() => {
    const tasks: Task[] = [];
    for (const projectTasks of Object.values(tasksByProject)) {
      for (const task of projectTasks) {
        if (
          !task.archivedAt &&
          taskActivity[task.id] !== undefined &&
          !rotationExclusions.has(task.id)
        ) {
          tasks.push(task);
        }
      }
    }
    // Sort by persisted rotation order; unknown tasks go to the end
    if (rotationOrder.length > 0) {
      const orderMap = new Map(rotationOrder.map((id, i) => [id, i]));
      tasks.sort((a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity));
    }
    return tasks;
  }, [tasksByProject, taskActivity, rotationExclusions, rotationOrder]);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  // `gh auth status` spawns a subprocess (100-500ms); warm it once so the
  // TaskModal can read the result synchronously instead of mid-mount.
  useEffect(() => {
    window.electronAPI.githubCheckAvailable().then((r) => {
      if (r.success) useProjects.getState().setGhAvailable(!!r.data);
    });
  }, []);

  // Pre-fetch ADO config + branches for the active project so the TaskModal
  // opens with its final layout. Narrow deps so unrelated re-renders don't refetch.
  const activeProjectIdForFetch = activeProject?.id;
  const activeProjectPathForFetch = activeProject?.path;
  const activeProjectIsGit = activeProject?.isGitRepo ?? false;
  useEffect(() => {
    if (!activeProjectIdForFetch) return;
    const id = activeProjectIdForFetch;
    window.electronAPI.adoCheckConfigured(id).then((r) => {
      if (r.success) useProjects.getState().setAdoConfigured(id, !!r.data);
    });
    if (activeProjectIsGit && activeProjectPathForFetch) {
      window.electronAPI.gitListBranches(activeProjectPathForFetch).then((r) => {
        if (r.success && r.data) {
          useProjects.getState().setBranchesForProject(id, r.data);
        }
      });
    }
  }, [activeProjectIdForFetch, activeProjectPathForFetch, activeProjectIsGit]);

  // Focus a specific task when notification is clicked
  useEffect(() => {
    return window.electronAPI.onFocusTask((taskId) => {
      setActiveTaskId(taskId);
    });
  }, []);

  // Activity monitor — subscribe first, then query to avoid race
  useEffect(() => {
    const prevState: Record<string, string> = {};
    // Track PTYs that have been idle at least once, so we skip the initial
    // busy→idle transition that fires when a direct-spawn PTY first registers.
    const hasBeenIdle = new Set<string>();
    // Track when each PTY entered busy state, so we can ignore brief flashes
    // (e.g. startup child processes) that shouldn't trigger "done" notifications.
    const busySince: Record<string, number> = {};
    const MIN_BUSY_DURATION_MS = 3000;

    const unsubscribe = window.electronAPI.onPtyActivity((newActivity) => {
      // Peon mode: detect idle→busy transitions (user submits query)
      if (notificationSoundRef.current === 'peon') {
        for (const [id, info] of Object.entries(newActivity)) {
          if (prevState[id] === 'idle' && info.state === 'busy' && hasBeenIdle.has(id)) {
            playPeonSound('yes');
            break;
          }
        }
      }
      // Detect any busy→idle transition (only for PTYs that completed a full work cycle)
      // Skip transitions from 'waiting' — those are not task completions
      // Skip brief busy flashes (< 3s) — these are startup artifacts, not real work
      const newlyDoneIds: string[] = [];
      for (const [id, info] of Object.entries(newActivity)) {
        if (prevState[id] === 'busy' && info.state === 'idle' && hasBeenIdle.has(id)) {
          const elapsed = Date.now() - (busySince[id] ?? Date.now());
          if (elapsed >= MIN_BUSY_DURATION_MS) {
            newlyDoneIds.push(id);
          }
        }
      }

      // Track busy start times (after detection, so busySince is still available above)
      for (const [id, info] of Object.entries(newActivity)) {
        if (info.state === 'busy' && prevState[id] !== 'busy') {
          busySince[id] = Date.now();
        } else if (info.state !== 'busy') {
          delete busySince[id];
        }
      }
      if (newlyDoneIds.length > 0) {
        playNotificationSound(notificationSoundRef.current);
        const currentActiveId = activeTaskIdRef.current;
        const toMarkUnseen = newlyDoneIds.filter((id) => id !== currentActiveId);
        if (toMarkUnseen.length > 0) {
          setUnseenTaskIds((prev) => new Set([...prev, ...toMarkUnseen]));
        }
      }
      // Mark PTYs that have reached idle (so the *next* busy→idle triggers)
      for (const [id, info] of Object.entries(newActivity)) {
        if (info.state === 'idle') hasBeenIdle.add(id);
      }
      // Clean up removed PTYs
      for (const id of hasBeenIdle) {
        if (!(id in newActivity)) hasBeenIdle.delete(id);
      }
      // Update previous state (shallow copy of states only)
      for (const k of Object.keys(prevState)) delete prevState[k];
      for (const [id, info] of Object.entries(newActivity)) {
        prevState[id] = info.state;
      }

      setTaskActivity(newActivity);
    });

    window.electronAPI.ptyGetAllActivity().then((resp) => {
      if (resp.success && resp.data) {
        for (const [id, info] of Object.entries(resp.data)) {
          prevState[id] = info.state;
          if (info.state === 'idle') hasBeenIdle.add(id);
        }
        setTaskActivity(resp.data);
      }
    });

    return unsubscribe;
  }, []);

  // Remote control — subscribe to state changes
  useEffect(() => {
    const unsubscribe = window.electronAPI.onRemoteControlStateChanged(({ ptyId, state }) => {
      setRemoteControlStates((prev) => {
        if (!state) {
          const next = { ...prev };
          delete next[ptyId];
          return next;
        }
        return { ...prev, [ptyId]: state };
      });
    });

    window.electronAPI.ptyRemoteControlGetAllStates().then((resp) => {
      if (resp.success && resp.data) {
        setRemoteControlStates(resp.data);
      }
    });

    return unsubscribe;
  }, []);

  // Task name lookup (used for threshold alerts and settings)
  const taskNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const tasks of Object.values(tasksByProject)) {
      for (const t of tasks) names[t.id] = t.name;
    }
    return names;
  }, [tasksByProject]);

  // Threshold alerts — fires toast notifications when usage exceeds thresholds
  useThresholdAlerts(statusLineData, latestRateLimits, usageThresholds, taskNames);

  // Persist usage thresholds

  // (Selection persistence to localStorage is handled by projectsStore's
  // setActiveProject/setActiveTask actions.)

  // Clear stale activeTaskId if it no longer exists in loaded tasks.
  // Wait until all projects have had their tasks loaded to avoid clearing
  // prematurely when tasks load out of order across projects.
  useEffect(() => {
    if (!activeTaskId || projects.length === 0) return;
    if (Object.keys(tasksByProject).length < projects.length) return;
    for (const tasks of Object.values(tasksByProject)) {
      if (tasks.some((t) => t.id === activeTaskId && !t.archivedAt)) return;
    }
    setActiveTaskId(null);
  }, [tasksByProject, activeTaskId, projects.length]);

  // Load tasks for all projects when projects change
  useEffect(() => {
    for (const project of projects) {
      loadTasksForProject(project.id);
    }
    // Ensure reserve worktree for active project
    if (activeProjectId) {
      const project = projects.find((p) => p.id === activeProjectId);
      if (project) {
        window.electronAPI.worktreeEnsureReserve({
          projectId: activeProjectId,
          projectPath: project.path,
        });
      }
    }
  }, [projects, activeProjectId]);

  // Detect pre-existing duplicate non-worktree tasks at the same cwd and warn
  // the user once per app session. The new resume strategy (`claude --continue`)
  // assumes one active task per cwd; duplicates from before the constraint
  // existed will cross-resume each other's sessions until manually resolved.
  const duplicateWarningFiredRef = useRef(false);
  useEffect(() => {
    if (duplicateWarningFiredRef.current) return;
    if (Object.keys(tasksByProject).length < projects.length) return;

    const offenders: { projectName: string; path: string; tasks: string[] }[] = [];
    for (const [projectId, tasks] of Object.entries(tasksByProject)) {
      const groups = new Map<string, Task[]>();
      for (const t of tasks) {
        if (t.useWorktree || t.archivedAt) continue;
        const list = groups.get(t.path) ?? [];
        list.push(t);
        groups.set(t.path, list);
      }
      for (const [path, group] of groups) {
        if (group.length > 1) {
          const project = projects.find((p) => p.id === projectId);
          offenders.push({
            projectName: project?.name ?? projectId,
            path,
            tasks: group.map((t) => t.name),
          });
        }
      }
    }

    if (offenders.length === 0) return;
    duplicateWarningFiredRef.current = true;

    const summary = offenders
      .map((o) => `"${o.projectName}": ${o.tasks.map((n) => `"${n}"`).join(', ')}`)
      .join('; ');
    toast.error(
      `Multiple tasks share the same directory and may cross-resume each other's Claude sessions. Archive duplicates to fix: ${summary}`,
      { duration: 20_000 },
    );
  }, [tasksByProject, projects]);

  // Theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
    sessionRegistry.setAllTerminalThemes(terminalTheme, theme === 'dark');
  }, [theme, terminalTheme]);

  useEffect(() => {
    const resolved = resolveTerminalFontValue(terminalFontFamily);
    document.documentElement.style.setProperty('--terminal-font', resolved);
    sessionRegistry.setAllTerminalFonts(resolved);
  }, [terminalFontFamily]);

  // Git: watch active task directory + poll
  useEffect(() => {
    if (fileWatcherCleanup.current) {
      fileWatcherCleanup.current();
      fileWatcherCleanup.current = null;
    }
    if (gitPollTimer.current) {
      clearInterval(gitPollTimer.current);
      gitPollTimer.current = null;
    }

    if (!activeTask) {
      setGitStatus(null);
      return;
    }

    const taskCwd = activeTask.path;
    refreshGitStatus(taskCwd);

    window.electronAPI.gitWatch({ id: activeTask.id, cwd: taskCwd });
    const unsubscribe = window.electronAPI.onGitFileChanged((id) => {
      if (id === activeTask.id) {
        refreshGitStatus(taskCwd);
      }
    });

    gitPollTimer.current = setInterval(() => {
      refreshGitStatus(taskCwd);
    }, GIT_POLL_INTERVAL);

    fileWatcherCleanup.current = () => {
      unsubscribe();
      window.electronAPI.gitUnwatch(activeTask.id);
      if (gitPollTimer.current) {
        clearInterval(gitPollTimer.current);
        gitPollTimer.current = null;
      }
    };

    return () => {
      if (fileWatcherCleanup.current) {
        fileWatcherCleanup.current();
        fileWatcherCleanup.current = null;
      }
    };
  }, [activeTask?.id, activeTask?.path]);

  // PR detection (consumed by Topbar)
  useEffect(() => {
    setPrInfo(null);

    const liveBranch = gitStatus?.branch;
    const defaultBranch = activeProject?.baseRef || activeProject?.gitBranch || 'main';
    if (!liveBranch || !activeProject || liveBranch === defaultBranch) return;

    let cancelled = false;
    const remote = activeProject.gitRemote;
    const projectId = activeProject.id;
    const projectPath = activeProject.path;
    const taskPath = activeTask?.path ?? null;

    async function fetchPr() {
      try {
        let pr: PullRequestInfo | null = null;
        if (remote && isAdoRemote(remote)) {
          const resp = await window.electronAPI.adoGetPrForBranch(liveBranch!, remote, projectId);
          if (!cancelled && resp.success) pr = resp.data ?? null;
        } else {
          const cwd = taskPath || projectPath;
          const resp = await window.electronAPI.githubGetPrForBranch(cwd, liveBranch!);
          if (!cancelled && resp.success) pr = resp.data ?? null;
        }
        if (!cancelled) setPrInfo(pr);
      } catch {
        if (!cancelled) setPrInfo(null);
      }
    }

    fetchPr();
    const interval = setInterval(fetchPr, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTask?.id, activeTask?.path, activeProject, gitStatus?.branch]);

  const cycleTask = useCallback(
    (direction: 1 | -1) => {
      if (activeProjectTasks.length === 0) return;
      const currentIdx = activeProjectTasks.findIndex((t) => t.id === activeTaskId);
      const nextIdx =
        (currentIdx + direction + activeProjectTasks.length) % activeProjectTasks.length;
      setActiveTaskId(activeProjectTasks[nextIdx].id);
    },
    [activeProjectTasks, activeTaskId],
  );

  const cycleRotation = useCallback(
    (direction: 1 | -1) => {
      if (rotationTasks.length === 0) return;
      const currentIdx = rotationTasks.findIndex((t) => t.id === activeTaskId);
      const nextIdx = (currentIdx + direction + rotationTasks.length) % rotationTasks.length;
      const nextTask = rotationTasks[nextIdx];
      setActiveProjectId(nextTask.projectId);
      setActiveTaskId(nextTask.id);
    },
    [rotationTasks, activeTaskId],
  );

  const removeFromRotation = useCallback((taskId: string) => {
    setRotationExclusions((prev) => {
      const next = new Set(prev);
      next.add(taskId);
      return next;
    });
  }, []);

  const handleReorderRotation = useCallback((reordered: Task[]) => {
    setRotationOrder(reordered.map((t) => t.id));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Tab / Ctrl+Shift+Tab — cycle rotation (works even when terminal is focused)
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        cycleRotation(e.shiftKey ? -1 : 1);
        return;
      }

      // Skip global shortcuts when typing in text inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Tasks
      if (keybindings.newTask && matchesBinding(e, keybindings.newTask)) {
        e.preventDefault();
        if (activeProjectId) {
          setTaskModalProjectId(activeProjectId);
          setShowTaskModal(true);
        }
      }
      if (keybindings.nextTask && matchesBinding(e, keybindings.nextTask)) {
        e.preventDefault();
        cycleTask(1);
      }
      if (keybindings.prevTask && matchesBinding(e, keybindings.prevTask)) {
        e.preventDefault();
        cycleTask(-1);
      }
      // Git
      if (keybindings.stageAll && matchesBinding(e, keybindings.stageAll)) {
        e.preventDefault();
        handleStageAll();
      }
      if (keybindings.unstageAll && matchesBinding(e, keybindings.unstageAll)) {
        e.preventDefault();
        handleUnstageAll();
      }
      if (keybindings.commitGraph && matchesBinding(e, keybindings.commitGraph)) {
        e.preventDefault();
        setShowCommitGraph((v) => !v);
      }
      // Navigation
      if (keybindings.openSettings && matchesBinding(e, keybindings.openSettings)) {
        e.preventDefault();
        setShowSettings((v) => !v);
      }
      if (keybindings.openFolder && matchesBinding(e, keybindings.openFolder)) {
        e.preventDefault();
        setCloneStatus({ loading: false, error: null });
        setShowAddProjectModal(true);
      }
      if (keybindings.closeDiff && matchesBinding(e, keybindings.closeDiff)) {
        if (remoteControlModalPtyId) {
          e.preventDefault();
          setRemoteControlModalPtyId(null);
        } else if (deleteTaskTarget) {
          e.preventDefault();
          setDeleteTaskTarget(null);
        } else if (deleteProjectTarget) {
          e.preventDefault();
          setDeleteProjectTarget(null);
        } else if (diffFile) {
          e.preventDefault();
          setDiffFile(null);
        } else if (showCommitGraph) {
          e.preventDefault();
          setShowCommitGraph(false);
        } else if (showSkillsBrowser) {
          e.preventDefault();
          setShowSkillsBrowser(false);
        } else if (showSettings) {
          e.preventDefault();
          setShowSettings(false);
        } else if (showTaskModal && !isCreatingTask) {
          e.preventDefault();
          setShowTaskModal(false);
        } else if (showAddProjectModal) {
          e.preventDefault();
          setShowAddProjectModal(false);
        }
      }
      // Cmd+Shift+1..9 to jump to project by index
      if (e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey) {
        const digit = e.code >= 'Digit1' && e.code <= 'Digit9' ? parseInt(e.code[5], 10) : 0;
        if (digit > 0 && digit <= projects.length) {
          e.preventDefault();
          const projectId = projects[digit - 1].id;
          setActiveProjectId(projectId);
          const tasks = (tasksByProject[projectId] || []).filter((t) => !t.archivedAt);
          if (tasks.length > 0) setActiveTaskId(tasks[0].id);
        }
      }
      // Cmd+1..9 to jump to task by index
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const digit = e.key >= '1' && e.key <= '9' ? parseInt(e.key, 10) : 0;
        if (digit > 0 && digit <= activeProjectTasks.length) {
          e.preventDefault();
          setActiveTaskId(activeProjectTasks[digit - 1].id);
        }
      }
      if (keybindings.focusTerminal && matchesBinding(e, keybindings.focusTerminal)) {
        e.preventDefault();
        const term = document.querySelector(
          '.terminal-container .xterm-helper-textarea',
        ) as HTMLTextAreaElement | null;
        term?.focus();
      }
      if (keybindings.toggleShellDrawer && matchesBinding(e, keybindings.toggleShellDrawer)) {
        e.preventDefault();
        toggleShellDrawer();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activeProjectTasks,
    activeTaskId,
    activeProjectId,
    projects,
    tasksByProject,
    remoteControlModalPtyId,
    deleteTaskTarget,
    deleteProjectTarget,
    diffFile,
    showCommitGraph,
    showSkillsBrowser,
    showSettings,
    showTaskModal,
    showAddProjectModal,
    keybindings,
    cycleTask,
    cycleRotation,
  ]);

  const toggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    setSidebarAnimating(true);
    if (sidebarCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [sidebarCollapsed]);

  const toggleChangesPanel = useCallback(() => {
    const panel = changesPanelRef.current;
    if (!panel) return;
    setChangesAnimating(true);
    if (changesPanelCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [changesPanelCollapsed]);

  const toggleShellDrawer = useCallback(() => {
    const panel = shellDrawerPanelRef.current;
    if (!panel) return;
    setShellDrawerAnimating(true);
    if (shellDrawerCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [shellDrawerCollapsed]);

  // While a side-car TUI is the active drawer tab, smoothly size the right
  // panel (the drawer lives inside it) to hug the TUI's pinned canvas — clack
  // can't reflow, so the panel fits the canvas, not the reverse. Restore the
  // user's width when the TUI finishes / closes / is cancelled.
  const changesSizeBeforeTui = useRef<number | null>(null);
  const handleTuiPanelActive = useCallback((active: boolean, canvasPx?: number) => {
    const panel = changesPanelRef.current;
    if (!panel) return;
    if (active) {
      // canvasPx may arrive 0/undefined on the first frame; ignore until a
      // real measurement lands so we don't snap to a bogus width.
      if (!canvasPx || changesSizeBeforeTui.current !== null) return;
      const targetPct = Math.max(
        TUI_PANEL_MIN_PCT,
        Math.min(
          TUI_PANEL_MAX_PCT,
          (((canvasPx + TUI_PANEL_CHROME_PX) * TUI_PANEL_WIDTH_SCALE) / window.innerWidth) * 100,
        ),
      );
      changesSizeBeforeTui.current = panel.getSize();
      setChangesAnimating(true);
      panel.resize(targetPct);
      setTimeout(() => setChangesAnimating(false), 200);
    } else {
      const prev = changesSizeBeforeTui.current;
      changesSizeBeforeTui.current = null;
      if (prev === null) return;
      setChangesAnimating(true);
      panel.resize(prev);
      setTimeout(() => setChangesAnimating(false), 200);
    }
  }, []);

  // ── Data Loading (projectsStore actions) ─────────────────

  const loadProjects = useProjects((s) => s.loadProjects);
  const loadTasksForProject = useProjects((s) => s.loadTasks);
  const handleReorderProjects = useProjects((s) => s.reorderProjects);
  const handleReorderTasks = useProjects((s) => s.reorderTasks);
  const handleReorderTasksCommit = useProjects((s) => s.commitTaskReorder);
  const handleArchiveTask = useProjects((s) => s.archiveTask);
  const handleRestoreTask = useProjects((s) => s.restoreTask);
  const handleCloseTask = useProjects((s) => s.closeTask);
  // Data-mutating UI flows live in uiStore (own their modal state).
  const handleOpenFolder = useUi((s) => s.openFolder);
  const handleCloneRepo = useUi((s) => s.cloneRepo);
  const handleDeleteProjectConfirm = useUi((s) => s.confirmDeleteProject);
  const handleDeleteTaskConfirm = useUi((s) => s.confirmDeleteTask);

  async function refreshGitStatus(cwd: string) {
    setGitLoading(true);
    try {
      const resp = await window.electronAPI.gitGetStatus(cwd);
      if (resp.success && resp.data) {
        setGitStatus(resp.data);
      }
    } catch {
      // Ignore
    } finally {
      setGitLoading(false);
    }
  }

  // ── Handlers ─────────────────────────────────────────────

  function handleDeleteProject(id: string) {
    const project = projects.find((p) => p.id === id);
    if (project) setDeleteProjectTarget(project);
  }

  function handleSelectTask(projectId: string, taskId: string) {
    setActiveProjectId(projectId);
    setActiveTaskId(taskId);
    setRotationExclusions((prev) => {
      if (!prev.has(taskId)) return prev;
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }

  function handleNewTask(projectId: string) {
    setActiveProjectId(projectId);
    setTaskModalProjectId(projectId);
    setShowTaskModal(true);
  }

  function handleCreateTask(options: CreateTaskOptions): Promise<boolean> {
    // Modal-selected project (App-owned) takes precedence over the active one.
    return useProjects
      .getState()
      .createTask(options, taskModalProjectId || activeProjectId || undefined);
  }

  function handleDeleteTask(id: string) {
    // Find task across all projects
    for (const tasks of Object.values(tasksByProject)) {
      const found = tasks.find((t) => t.id === id);
      if (found) {
        setDeleteTaskTarget(found);
        return;
      }
    }
  }

  function handleTaskSettings(id: string) {
    for (const tasks of Object.values(tasksByProject)) {
      const found = tasks.find((t) => t.id === id);
      if (found) {
        setTaskSettingsTarget(found);
        return;
      }
    }
  }

  async function persistTaskUpdate(task: Task, patch: Partial<Task>): Promise<Task | null> {
    const updated = await useProjects.getState().updateTask(task, patch);
    // Keep the (App-owned) task-settings modal target in sync with the save.
    if (updated) setTaskSettingsTarget((prev) => (prev?.id === updated.id ? updated : prev));
    return updated;
  }

  // ── Git Handlers ─────────────────────────────────────────

  async function handleStageFiles(filePaths: string[]) {
    if (!activeTask || filePaths.length === 0) return;
    await window.electronAPI.gitStageFiles({ cwd: activeTask.path, filePaths });
    refreshGitStatus(activeTask.path);
  }

  async function handleUnstageFiles(filePaths: string[]) {
    if (!activeTask || filePaths.length === 0) return;
    await window.electronAPI.gitUnstageFiles({ cwd: activeTask.path, filePaths });
    refreshGitStatus(activeTask.path);
  }

  async function handleStageAll() {
    if (!activeTask) return;
    await window.electronAPI.gitStageAll(activeTask.path);
    refreshGitStatus(activeTask.path);
  }

  async function handleUnstageAll() {
    if (!activeTask) return;
    await window.electronAPI.gitUnstageAll(activeTask.path);
    refreshGitStatus(activeTask.path);
  }

  async function handleCommit(message: string, options: { allowEmpty?: boolean } = {}) {
    if (!activeTask) return;
    const res = await window.electronAPI.gitCommit({
      cwd: activeTask.path,
      message,
      allowEmpty: options.allowEmpty,
    });
    if (!res.success) throw new Error(res.error || 'Commit failed');
    refreshGitStatus(activeTask.path);
  }

  async function handlePush() {
    if (!activeTask) return;
    const res = await window.electronAPI.gitPush(activeTask.path);
    if (!res.success) throw new Error(res.error || 'Push failed');
    refreshGitStatus(activeTask.path);
  }

  async function handleDiscardFiles(filePaths: string[]) {
    if (!activeTask || filePaths.length === 0) return;
    await window.electronAPI.gitDiscardFiles({ cwd: activeTask.path, filePaths });
    refreshGitStatus(activeTask.path);
  }

  async function handleAddToGitignore(filePath: string) {
    if (!activeTask) return;
    const res = await window.electronAPI.gitignoreAdd({ cwd: activeTask.path, filePath });
    if (!res.success) {
      console.error('[gitignore] add failed', res.error);
    }
    refreshGitStatus(activeTask.path);
  }

  function handleViewDiff(filePath: string, staged: boolean) {
    if (!activeTask) return;
    // Monaco loads HEAD/index + working copy itself via files:readForEdit;
    // App.tsx just opens the modal with the file identity.
    setDiffFile({ cwd: activeTask.path, filePath, staged });
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <PanelGroup direction="horizontal" className="flex-1">
        <Panel
          id="sidebar"
          order={1}
          ref={sidebarPanelRef}
          className={sidebarAnimating ? 'panel-transition' : ''}
          defaultSize={sidebarCollapsed ? 3 : 18}
          minSize={12}
          maxSize={28}
          collapsible
          collapsedSize={3}
          style={{
            overflow: 'visible',
            position: 'relative',
            zIndex: 1,
            minWidth: 0,
            background: terminalBg,
          }}
          onCollapse={() => {
            setSidebarCollapsed(true);
            setTimeout(() => setSidebarAnimating(false), 200);
          }}
          onExpand={() => {
            setSidebarCollapsed(false);
            setTimeout(() => setSidebarAnimating(false), 200);
          }}
        >
          <LeftSidebar
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={(id) => {
              setActiveProjectId(id);
              setActiveTaskId(null);
            }}
            onOpenFolder={() => {
              setCloneStatus({ loading: false, error: null });
              setShowAddProjectModal(true);
            }}
            onDeleteProject={handleDeleteProject}
            onProjectSettings={(id) => {
              const p = projects.find((proj) => proj.id === id);
              if (p) setProjectSettingsTarget(p);
            }}
            tasksByProject={tasksByProject}
            activeTaskId={activeTaskId}
            onSelectTask={handleSelectTask}
            onNewTask={handleNewTask}
            onDeleteTask={handleDeleteTask}
            onArchiveTask={handleArchiveTask}
            onRestoreTask={handleRestoreTask}
            onCloseTask={handleCloseTask}
            onTaskSettings={handleTaskSettings}
            onOpenSettings={() => {
              setSettingsInitialTab(undefined);
              setShowSettings(true);
            }}
            onShowCommitGraph={(projectId) => {
              setActiveProjectId(projectId);
              setShowCommitGraph(true);
            }}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebar}
            taskActivity={taskActivity}
            unseenTaskIds={unseenTaskIds}
            remoteControlStates={remoteControlStates}
            contextUsage={showContextUsageOnTaskCards ? contextUsage : EMPTY_CONTEXT_USAGE}
            onReorderProjects={handleReorderProjects}
            onReorderTasks={handleReorderTasks}
            onReorderTasksCommit={handleReorderTasksCommit}
            rotationTasks={rotationTasks}
            onReorderRotation={handleReorderRotation}
            onRemoveFromRotation={removeFromRotation}
            onToggleActiveTasksSection={() => setShowActiveTasksSection(!showActiveTasksSection)}
            onOpenSkillsBrowser={() => setShowSkillsBrowser(true)}
            projectTokenStats={projectTokenStats}
          />
        </Panel>
        <PanelResizeHandle
          disabled={sidebarCollapsed}
          className="resize-handle-quiet w-[1px] bg-border/40"
        />

        <Panel
          id="main"
          order={2}
          className={sidebarAnimating || changesAnimating ? 'panel-transition' : ''}
          minSize={35}
        >
          <ShellDrawerWrapper
            enabled={shellDrawerPosition === 'main'}
            taskId={activeTask?.id ?? null}
            cwd={activeTask?.path ?? null}
            collapsed={shellDrawerCollapsed}
            label={activeTask?.useWorktree ? 'Worktree' : 'Terminal'}
            panelRef={shellDrawerPanelRef}
            animating={shellDrawerAnimating}
            onAnimate={() => setShellDrawerAnimating(true)}
            onCollapse={() => {
              setShellDrawerCollapsed(true);
              setTimeout(() => setShellDrawerAnimating(false), 200);
            }}
            onExpand={() => {
              setShellDrawerCollapsed(false);
              setTimeout(() => setShellDrawerAnimating(false), 200);
            }}
          >
            <MainContent
              activeTask={activeTask}
              activeProject={activeProject}
              tasks={activeProjectTasks}
              taskActivity={taskActivity}
              gitStatus={gitStatus}
              prInfo={prInfo}
              remoteControlState={activeTask ? (remoteControlStates[activeTask.id] ?? null) : null}
              isMac={window.electronAPI.getPlatform() === 'darwin'}
              terminalBg={terminalBg}
              sidebarCollapsed={sidebarCollapsed}
              changesPanelCollapsed={changesPanelCollapsed}
              onToggleSidebar={toggleSidebar}
              onToggleChangesPanel={toggleChangesPanel}
              onSelectTask={setActiveTaskId}
              onEnableRemoteControl={() => activeTask && setRemoteControlModalPtyId(activeTask.id)}
              onOpenIde={() => activeTask && openInIde(activeTask.path)}
              onNewTask={() => activeProjectId && handleNewTask(activeProjectId)}
              onProjectSettings={() => {
                if (activeProject) setProjectSettingsTarget(activeProject);
              }}
              onShowCommitGraph={() => {
                if (activeProjectId) {
                  setActiveProjectId(activeProjectId);
                  setShowCommitGraph(true);
                }
              }}
              onDeleteProject={() => {
                if (activeProject) handleDeleteProject(activeProject.id);
              }}
              archivedTasks={
                activeProjectId
                  ? (tasksByProject[activeProjectId] || []).filter((t) => t.archivedAt)
                  : []
              }
              onDeleteTask={handleDeleteTask}
              onArchiveTask={handleArchiveTask}
              onRestoreTask={handleRestoreTask}
            />
          </ShellDrawerWrapper>
        </Panel>

        {activeTask && (
          <>
            <PanelResizeHandle
              disabled={changesPanelCollapsed}
              className="resize-handle-floating w-[1px] bg-transparent"
            />
            <Panel
              id="changes"
              order={3}
              ref={changesPanelRef}
              className={changesAnimating ? 'panel-transition' : ''}
              style={
                changesPanelCollapsed
                  ? { background: terminalBg }
                  : { background: terminalBg, padding: '24px 24px 24px 0' }
              }
              defaultSize={changesPanelCollapsed ? 0.5 : 22}
              minSize={12}
              maxSize={40}
              collapsible
              collapsedSize={0.5}
              onCollapse={() => {
                setChangesPanelCollapsed(true);
                setTimeout(() => setChangesAnimating(false), 200);
              }}
              onExpand={() => {
                setChangesPanelCollapsed(false);
                setTimeout(() => setChangesAnimating(false), 200);
              }}
            >
              <div
                className={
                  changesPanelCollapsed
                    ? 'h-full flex flex-col overflow-hidden'
                    : 'right-inspector-shell h-full flex flex-col overflow-hidden rounded-[14px]'
                }
              >
                <ShellDrawerWrapper
                  enabled={shellDrawerPosition === 'right' && !changesPanelCollapsed}
                  taskId={activeTask?.id ?? null}
                  cwd={activeTask?.path ?? null}
                  collapsed={shellDrawerCollapsed}
                  panelRef={shellDrawerPanelRef}
                  animating={shellDrawerAnimating}
                  onTuiActiveChange={handleTuiPanelActive}
                  onAnimate={() => setShellDrawerAnimating(true)}
                  onCollapse={() => {
                    setShellDrawerCollapsed(true);
                    setTimeout(() => setShellDrawerAnimating(false), 200);
                  }}
                  onExpand={() => {
                    setShellDrawerCollapsed(false);
                    setTimeout(() => setShellDrawerAnimating(false), 200);
                  }}
                >
                  {!changesPanelCollapsed && (
                    <PortsDrawerWrapper
                      taskId={activeTask?.id ?? null}
                      collapsed={portsDrawerCollapsed}
                      onCollapse={() => {
                        setPortsDrawerCollapsed(true);
                      }}
                      onExpand={() => {
                        setPortsDrawerCollapsed(false);
                      }}
                    >
                      <RightInspector
                        activeTask={activeTask}
                        gitStatus={gitStatus}
                        gitLoading={gitLoading}
                        rateLimits={showRateLimits && latestRateLimits ? latestRateLimits : {}}
                        contextUsage={
                          showUsageInline && activeTask ? contextUsage[activeTask.id] : undefined
                        }
                        onViewDiff={handleViewDiff}
                        onStageFiles={handleStageFiles}
                        onUnstageFiles={handleUnstageFiles}
                        onStageAll={handleStageAll}
                        onUnstageAll={handleUnstageAll}
                        onDiscardFiles={handleDiscardFiles}
                        onAddToGitignore={handleAddToGitignore}
                        onCommit={handleCommit}
                        onPush={handlePush}
                        onCommitFinished={() => activeTask && refreshGitStatus(activeTask.path)}
                        onShowCommitGraph={() => setShowCommitGraph(true)}
                        onOpenEditor={() => {
                          if (!activeTask) return;
                          const files = gitStatus?.files ?? [];
                          if (files.length > 0) {
                            // Prefer the first unstaged file; otherwise first staged.
                            const target = files.find((f) => !f.staged) ?? files[0];
                            setDiffFile({
                              cwd: activeTask.path,
                              filePath: target.path,
                              staged: target.staged,
                            });
                          } else {
                            // No working changes — open at the latest commit.
                            // The 'HEAD' sentinel resolves to the real sha once
                            // the editor loads its commit list.
                            setDiffFile({
                              cwd: activeTask.path,
                              filePath: '',
                              staged: false,
                              initialView: { kind: 'commit', hash: 'HEAD' },
                            });
                          }
                        }}
                        collapsed={changesPanelCollapsed}
                        onToggleCollapse={toggleChangesPanel}
                      />
                    </PortsDrawerWrapper>
                  )}
                </ShellDrawerWrapper>
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>

      {showAddProjectModal && (
        <AddProjectModal
          onClose={() => setShowAddProjectModal(false)}
          onOpenFolder={handleOpenFolder}
          onCloneRepo={handleCloneRepo}
          cloneStatus={cloneStatus}
        />
      )}

      {showTaskModal &&
        (() => {
          const modalProjectId = taskModalProjectId || activeProjectId;
          const modalProject = projects.find((p) => p.id === modalProjectId);
          const modalTasks = modalProjectId ? (tasksByProject[modalProjectId] ?? []) : [];
          const existingNonWorktreeTask =
            modalTasks.find((t) => !t.useWorktree && !t.archivedAt) ?? null;
          return (
            <TaskModal
              projectPath={modalProject?.path ?? ''}
              projectId={modalProjectId || undefined}
              isGitRepo={modalProject?.isGitRepo ?? false}
              gitRemote={modalProject?.gitRemote ?? null}
              existingNonWorktreeTask={
                existingNonWorktreeTask
                  ? { id: existingNonWorktreeTask.id, name: existingNonWorktreeTask.name }
                  : null
              }
              ghAvailable={ghAvailable}
              adoConfigured={modalProjectId ? (adoConfiguredById[modalProjectId] ?? false) : false}
              initialBranches={modalProjectId ? branchesByProject[modalProjectId] : undefined}
              onClose={() => setShowTaskModal(false)}
              onCreate={handleCreateTask}
              onGitInit={() => {
                if (modalProject) {
                  window.electronAPI.detectGit(modalProject.path).then(async (gitResp) => {
                    const gitInfo = gitResp.success ? gitResp.data : null;
                    await window.electronAPI.saveProject({
                      ...modalProject,
                      isGitRepo: gitInfo?.isGitRepo ?? true,
                      gitRemote: gitInfo?.remote ?? null,
                      gitBranch: gitInfo?.branch ?? null,
                    });
                    loadProjects();
                  });
                }
              }}
            />
          );
        })()}

      {adoSetup && (
        <AdoSetupModal
          projectId={adoSetup.projectId}
          organizationUrl={adoSetup.organizationUrl}
          project={adoSetup.project}
          onClose={() => setAdoSetup(null)}
        />
      )}

      {taskSettingsTarget && (
        <TaskSettingsModal
          task={taskSettingsTarget}
          hasActiveSession={!!taskActivity[taskSettingsTarget.id]?.state}
          onClose={() => setTaskSettingsTarget(null)}
          onRename={async (id, newName) => {
            if (!taskSettingsTarget || taskSettingsTarget.id !== id) return;
            await persistTaskUpdate(taskSettingsTarget, { name: newName });
          }}
          onPermissionModeChange={async (id, mode) => {
            if (!taskSettingsTarget || taskSettingsTarget.id !== id) return;
            await persistTaskUpdate(taskSettingsTarget, { permissionMode: mode });
          }}
        />
      )}

      {projectSettingsTarget && (
        <ProjectSettingsModal
          project={projectSettingsTarget}
          onClose={() => setProjectSettingsTarget(null)}
          onRename={async (id, newName) => {
            const proj = projects.find((p) => p.id === id);
            if (!proj) return;
            await window.electronAPI.saveProject({ ...proj, name: newName });
            await loadProjects();
            setProjectSettingsTarget((prev) =>
              prev?.id === id ? { ...prev, name: newName } : prev,
            );
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          initialTab={settingsInitialTab}
          globalTokenStats={globalTokenStats}
          activeProjectPath={activeProject?.path}
          availableIDEs={availableIDEs}
          rtkStatus={rtkStatus}
          onRtkEnabledChange={(enabled) => {
            // Optimistic update only applies to the installed arm — the type
            // forbids `enabled` on { installed: false }.
            setRtkStatus((prev) => (prev?.installed ? { ...prev, enabled } : prev));
            window.electronAPI.rtkSetEnabled(enabled).then((resp) => {
              if (!resp.success) {
                toast.error(resp.error ?? 'Failed to toggle RTK');
                window.electronAPI.rtkGetStatus().then((s) => {
                  if (s.success && s.data) setRtkStatus(s.data);
                  else console.error('[rtk:getStatus after setEnabled failure]', s.error);
                });
                return;
              }
              if (resp.data?.warning) {
                toast.warning(resp.data.warning);
              }
            });
          }}
          onRtkDownload={() => {
            setRtkDownloadProgress({ phase: 'downloading', percent: 0 });
            window.electronAPI.rtkDownload().then((resp) => {
              if (!resp.success) {
                setRtkDownloadProgress({
                  phase: 'error',
                  error: resp.error ?? 'download failed',
                });
                return;
              }
              if (resp.data?.warning) {
                toast.warning(resp.data.warning);
              }
            });
          }}
          rtkDownloadProgress={rtkDownloadProgress}
          latestRateLimits={latestRateLimits}
          onClose={() => setShowSettings(false)}
        />
      )}

      {deleteTaskTarget && (
        <DeleteTaskModal
          task={deleteTaskTarget}
          onClose={() => setDeleteTaskTarget(null)}
          onConfirm={handleDeleteTaskConfirm}
        />
      )}

      {deleteProjectTarget && (
        <DeleteProjectModal
          project={deleteProjectTarget}
          tasks={tasksByProject[deleteProjectTarget.id] ?? []}
          onClose={() => setDeleteProjectTarget(null)}
          onConfirm={handleDeleteProjectConfirm}
        />
      )}

      {remoteControlModalPtyId && (
        <RemoteControlModal
          ptyId={remoteControlModalPtyId}
          state={remoteControlStates[remoteControlModalPtyId] ?? null}
          onClose={() => setRemoteControlModalPtyId(null)}
        />
      )}

      {showCommitGraph && activeProject && (
        <CommitGraphModal
          projectPath={activeProject.path}
          projectName={activeProject.name}
          gitRemote={activeProject.gitRemote}
          taskBranches={
            new Map(
              (tasksByProject[activeProject.id] || [])
                .filter((t) => !t.archivedAt && t.branch)
                .map((t) => [t.branch, { id: t.id, name: t.name, useWorktree: t.useWorktree }]),
            )
          }
          onClose={() => setShowCommitGraph(false)}
          onSelectTask={(taskId) => {
            setActiveTaskId(taskId);
            setShowCommitGraph(false);
          }}
        />
      )}

      {showSkillsBrowser && (
        <SkillsBrowserModal
          projects={skillsModalProjects}
          activeProjectId={activeProjectId ?? undefined}
          activeTasks={skillsModalActiveTasks}
          currentTaskId={activeTaskId ?? undefined}
          onClose={() => setShowSkillsBrowser(false)}
        />
      )}

      {diffFile && (
        <Suspense fallback={null}>
          <DiffEditor
            cwd={diffFile.cwd}
            initialFilePath={diffFile.filePath}
            initialStaged={diffFile.staged}
            initialView={diffFile.initialView}
            gitStatus={gitStatus}
            activeTaskId={activeTaskId}
            terminalTheme={resolvedTerminalTheme}
            isDark={theme === 'dark'}
            onClose={() => {
              setDiffFile(null);
              // Refocus the active task's Claude Code TUI so the user can
              // keep typing without an extra click. RAF defers past React's
              // commit so the modal's DOM is gone before xterm grabs focus.
              const id = activeTaskId;
              if (id) requestAnimationFrame(() => sessionRegistry.get(id)?.focus());
            }}
          />
        </Suspense>
      )}

      <ToastContainer updateNotificationsEnabled={updateNotificationsEnabled} />
    </div>
  );
}
