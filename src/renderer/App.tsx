import React, { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { TUI_FEATURE_IDS } from '@shared/tuiProtocol';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  panelEaseMs,
  EXPAND_EASE_MS,
  type PanelImperativeHandle,
} from './components/ui/Resizable';
import { expandShellDrawer } from './components/terminal/ShellDrawerWrapper';
import { LeftSidebar, LEFT_SIDEBAR_MIN_PX } from './components/leftSidebar/LeftSidebar';
import { MainContent } from './components/MainContent';
import { openInIde } from './lib/openInIde';
import {
  handOffWidth,
  loadInspectorWidths,
  narrowFromList,
  planExpand,
  saveInspectorWidth,
  SIDEBAR_GUTTER_PX,
  widthOnExpandedToggle,
  widthOnShow,
} from './lib/inspectorWidths';
import { headerModelName } from './lib/modelName';
import { RightInspector } from './components/rightInspector/RightInspector';
import { RAIL_PX } from './components/ui/Rail';
import { usePlannedMotion } from './lib/usePlannedMotion';
import type { PanelExtent } from './lib/railCrossing';
import { HeldFrame } from './components/ui/HeldFrame';
import { whenFramesSettle } from './lib/framesSettled';
import { CommitGraphModal } from './components/CommitGraph/CommitGraphModal';
import { TaskModal } from './components/task/TaskModal';
import { NewProjectDialog } from './components/newProject/NewProjectDialog';
import { DeleteTaskModal } from './components/task/DeleteTaskModal';
import { DeleteProjectModal } from './components/project/DeleteProjectModal';
import { TaskFinder } from './components/leftSidebar/TaskFinder';
import { newTaskProjectId } from './components/leftSidebar/taskStates';
import {
  WorktreeMigrationModal,
  isWorktreeMigrationDismissed,
} from './components/project/WorktreeMigrationModal';
import { RemoteControlModal } from './components/RemoteControlModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { ProjectSettingsModal } from './components/project/ProjectSettingsModal';
import { TaskSettingsModal } from './components/task/TaskSettingsModal';
import { OrchestratorAccessPrompt } from './components/settings/OrchestratorAccessPrompt';
import { AdoSetupModal } from './components/vcs/ado/AdoSetupModal';
import { Toaster } from './components/ui/Toaster';
import { ToastSources } from './components/notifications/ToastSources';
import { toast } from './components/ui/toast';
import { getBillionToastContent } from './utils/billionToast';
import { useStatusLine } from './hooks/useStatusLine';
import { useThresholdAlerts } from './hooks/useThresholdAlerts';
import { useSystemHealth } from './hooks/useSystemHealth';
import type { Task, WorktreeMigrationProject, WorktreeMigrationResult } from '../shared/types';
import { defaultEffortFrom } from '../shared/effort';
import type { CreateTaskOptions, TaskModalDefaults } from './components/task/TaskModal';
import { matchesBinding } from './keybindings';
import { sessionRegistry } from './terminal/SessionRegistry';
import { useTerminalHibernation } from './terminal/useTerminalHibernation';
import { resolveTheme } from './terminal/terminalThemes';
import { resolveTerminalFontValue } from './terminal/terminalFonts';
import { setWebglHeldLimit } from './terminal/WebglLifecycle';
import { useSettings } from './stores/settingsStore';
import { useUi } from './stores/uiStore';
import { useGit } from './stores/gitStore';
import { useEditors } from './stores/editorsStore';
import { mayCloseEditor } from './components/diffEditor/closeGuard';
import { ConfirmHost } from './components/ui/ConfirmHost';
import { changeSessionSetting } from './components/task/changeSessionSetting';
import { ClaudeUpdateHost } from './components/claudeUpdate/ClaudeUpdateHost';
import { useRuntime } from './stores/runtimeStore';
import { useAppBootstrap } from './hooks/useAppBootstrap';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { useShallow } from 'zustand/react/shallow';
import {
  useProjects,
  selectActiveProject,
  selectActiveTask,
  selectTaskById,
  selectActiveProjectTasks,
} from './stores/projectsStore';

/** Chrome around the pinned TUI canvas (panel padding + drawer gutter) added
 *  to the measured canvas px so the panel hugs it without clipping. */
const TUI_PANEL_CHROME_PX = 52;
/** Trim the hugged panel width — the canvas has built-in right whitespace, so
 *  the panel can sit narrower than the full canvas without clipping content. */
const TUI_PANEL_WIDTH_SCALE = 0.85;
/** Bounds for the hugged right-panel width (%): the panel's min, and the
 *  widest a narrow sidebar opens at. */
const TUI_PANEL_MIN_PCT = 14;
const TUI_PANEL_MAX_PCT = 40;
/** The task sidebar's widest (expanded): wide enough that the centre can go
 *  down to its own floor, MAIN_MIN_PX, beside a review. */
const INSPECTOR_MAX_PCT = 85;
/** The centre (the agent's terminal) at its narrowest, in px: its header's
 *  name, branch and actions still fit, and the TUI reflows to it. */
const MAIN_MIN_PX = 280;
/** The shell's two resize handles and rounding, in px: what an expanding
 *  task sidebar leaves beside the centre's MAIN_MIN_PX. */
const SHELL_SLACK_PX = 8;
/** The split's list column at its widest share (%), as `RightInspector`
 *  bounds it in normal mode (review mode's 60 is looser). */
const LIST_MAX_PCT = 50;
/** The shell group's panels; the task sidebar mounts only with an active task. */
const SHELL_PANELS = ['sidebar', 'main'];
const SHELL_PANELS_TASK = ['sidebar', 'main', 'changes'];
const isMac = window.electronAPI.getPlatform() === 'darwin';
/** How long expanding waits for an editor opening for the first time to
 *  mount before it eases anyway (it then fades in when it arrives). */
const EDITOR_MOUNT_WAIT_MS = 300;
/** The most a show opening the terminal waits for its held layout to lay
 *  out before it opens the drawer. */
const SHOW_LAYOUT_WAIT_MS = 250;

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
  const finishProjectCreation = useUi((s) => s.finishProjectCreation);
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
  const taskFinderOpen = useUi((s) => s.taskFinderOpen);
  const setTaskFinderOpen = useUi((s) => s.setTaskFinderOpen);
  const setShowSettings = useUi((s) => s.setShowSettings);
  const settingsInitialTab = useUi((s) => s.settingsInitialTab);
  const setSettingsInitialTab = useUi((s) => s.setSettingsInitialTab);
  const theme = useSettings((s) => s.theme);
  const keybindings = useSettings((s) => s.keybindings);
  const desktopNotification = useSettings((s) => s.desktopNotification);
  const autoUpdateEnabled = useSettings((s) => s.autoUpdateEnabled);
  const setAutoUpdateEnabled = useSettings((s) => s.setAutoUpdateEnabled);
  const terminalTheme = useSettings((s) => s.terminalTheme);
  const terminalFontFamily = useSettings((s) => s.terminalFontFamily);
  const webglHeldLimit = useSettings((s) => s.webglHeldLimit);
  const setPreferredIDE = useSettings((s) => s.setPreferredIDE);
  const availableIDEs = useProjects((s) => s.availableIDEs);

  // Store-level live subscriptions + reactive bootstrap (runtime init, token rollups,
  // git watcher/poll, PR detection). React schedules WHEN; the stores own HOW.
  useAppBootstrap();
  useTerminalHibernation();

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
    void window.electronAPI.drawerTabsBulkUpsert(entries).then((resp) => {
      if (!resp.success) return;
      for (const e of entries) {
        localStorage.removeItem(`shellTabs:${e.taskId}`);
        localStorage.removeItem(`shellActiveTab:${e.taskId}`);
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.detectAvailableIDEs().then((res) => {
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
  const ultracode = useSettings((s) => s.ultracode);
  const stopSessionsOnQuit = useSettings((s) => s.stopSessionsOnQuit);
  const orchestratorAccess = useSettings((s) => s.orchestratorAccess);
  const customClaudeEnvVars = useSettings((s) => s.customClaudeEnvVars);

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
    void window.electronAPI.autoUpdateGetEnabled?.().then((res) => {
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
    void window.electronAPI.autoUpdateSetEnabled?.(autoUpdateEnabled);
  }, [autoUpdateEnabled]);
  // Sync commit attribution to main process
  useEffect(() => {
    window.electronAPI.setCommitAttribution?.(commitAttribution);
  }, [commitAttribution]);
  // Sync shell env inheritance to main process
  useEffect(() => {
    window.electronAPI.setSyncShellEnv?.(syncShellEnv);
  }, [syncShellEnv]);
  // Sync the default effort to main: a task with none of its own starts with
  // it (`--effort`, so a task's own can override it).
  useEffect(() => {
    window.electronAPI.setDefaultEffort?.(defaultEffortFrom(effortLevel, ultracode));
  }, [effortLevel, ultracode]);
  // Sync stop-sessions-on-quit to main process (read in the before-quit handler)
  useEffect(() => {
    window.electronAPI.setStopSessionsOnQuit?.(stopSessionsOnQuit);
  }, [stopSessionsOnQuit]);
  // Sync the theme to main: a session started with no pane (the control API)
  // takes its terminal colours from it.
  useEffect(() => {
    window.electronAPI.setIsDark?.(theme === 'dark');
  }, [theme]);
  // Sync orchestrator access to main (gates the control API's orchestrator caller)
  useEffect(() => {
    window.electronAPI.setOrchestratorAccess?.(orchestratorAccess);
  }, [orchestratorAccess]);
  // Sync Claude Code env vars to main process
  useEffect(() => {
    window.electronAPI.setClaudeEnvVars?.({ ...customClaudeEnvVars });
  }, [customClaudeEnvVars]);

  // Activity + remote-control state (runtimeStore; both fed by its init() subscriptions).
  const taskActivity = useRuntime((s) => s.taskActivity);
  const remoteControlStates = useRuntime((s) => s.remoteControlStates);
  const remoteControlModalPtyId = useUi((s) => s.remoteControlModalPtyId);
  const setRemoteControlModalPtyId = useUi((s) => s.setRemoteControlModalPtyId);

  // Status line data (context + cost + rate limits) — derived contextUsage & latestRateLimits
  const { statusLineData, contextUsage, latestRateLimits, paces } = useStatusLine();

  // Usage thresholds for popup notifications
  const usageThresholds = useSettings((s) => s.usageThresholds);

  const unseenTaskIds = useSettings((s) => s.unseenTaskIds);
  const setUnseenTaskIds = useSettings((s) => s.setUnseenTaskIds);

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

  // Token-stats rollups (runtimeStore; live-updated via its init() tokenStats subscription).
  const globalTokenStats = useRuntime((s) => s.globalTokenStats);

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
      toast.success(title, { description });
    }
  }, [globalTokenStats.totalTokens]);

  // Rotation — the live-session tasks Ctrl+Tab walks, minus exclusions.
  const rotationExclusions = useSettings((s) => s.rotationExclusions);

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

  // ── Git state (gitStore) ─────────────────────────────────
  const editors = useEditors((s) => s.byCwd);
  const showCommitGraph = useGit((s) => s.showCommitGraph);
  const setShowCommitGraph = useGit((s) => s.setShowCommitGraph);
  const commitGraphFocusHash = useGit((s) => s.commitGraphFocusHash);
  const setCommitGraphFocusHash = useGit((s) => s.setCommitGraphFocusHash);

  const sidebarCollapsed = useSettings((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettings((s) => s.setSidebarCollapsed);
  const changesPanelCollapsed = useSettings((s) => s.changesPanelCollapsed);
  const setChangesPanelCollapsed = useSettings((s) => s.setChangesPanelCollapsed);

  // Panels take their collapsed state at launch as their default size, and
  // keep it: a changing defaultSize re-registers the panel, which forgets the
  // size to expand back to.
  const [startedCollapsed] = useState(() => {
    const { sidebarCollapsed, changesPanelCollapsed } = useSettings.getState();
    return { sidebar: sidebarCollapsed, inspector: changesPanelCollapsed };
  });
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const changesPanelRef = useRef<PanelImperativeHandle>(null);
  const shellDrawerPanelRef = useRef<PanelImperativeHandle>(null);
  const sidebarAnimating = useUi((s) => s.sidebarAnimating);
  const setSidebarAnimating = useUi((s) => s.setSidebarAnimating);
  const changesAnimating = useUi((s) => s.changesAnimating);
  const setChangesAnimating = useUi((s) => s.setChangesAnimating);
  const setShellDrawerAnimating = useUi((s) => s.setShellDrawerAnimating);
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

  // Each task's editor lives in its sidebar (expanded while shown, kept out
  // of sight while narrow), Claude's own folders for the task included (A10).
  const inlineEditor = activeTask ? (editors[activeTask.path] ?? null) : null;
  const expanded = !!inlineEditor && !inlineEditor.hidden;

  // Close `cwd`'s editor (asking about unsaved edits) and hand the keyboard
  // back to the task's Claude Code TUI. RAF defers past React's commit so the
  // editor is gone before xterm grabs focus. An editor shown in its task's
  // sidebar goes narrow first, through the planned motion (D264), and closes
  // once it has eased (`pendingCloseRef`, settled below), so the panel's
  // edge eases rather than the split dropping at once.
  const pendingCloseRef = useRef<string | null>(null);
  const closeEditorOf = useCallback((cwd: string) => {
    void mayCloseEditor(cwd).then((ok) => {
      if (!ok) return;
      const editors = useEditors.getState();
      const shown =
        editors.byCwd[cwd]?.hidden === false &&
        selectActiveTask(useProjects.getState())?.path === cwd &&
        changesPanelRef.current?.isCollapsed() === false;
      if (shown) {
        pendingCloseRef.current = cwd;
        editors.hide(cwd);
      } else editors.close(cwd);
      const id = useProjects.getState().activeTaskId;
      if (id) requestAnimationFrame(() => sessionRegistry.get(id)?.focus());
    });
  }, []);

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
      void window.electronAPI.wizardActive({ featureId, taskId }).then((resp) => {
        if (resp.success && resp.data) return;
        void window.electronAPI.requestWizard({
          featureId,
          taskId,
          projectId,
          taskName,
          projectName,
          cwd,
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
      void sessionRegistry.restartAllForTask(tid);
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
    const off = window.electronAPI.onPortsTuiMigrated(({ toTaskId, projectId }) => {
      void (async () => {
        await loadTasksForProject(projectId);
        setActiveProjectId(projectId);
        setActiveTaskId(toTaskId);
      })();
    });
    return off;
  }, []);

  // Main changed a project's tasks (created, archived, restored or deleted,
  // possibly by the control API): reload that project's list so tasks nobody
  // opened still show up. Archived projects keep no task list, so skip them.
  useEffect(() => {
    return window.electronAPI.onTasksChanged(({ projectId }) => {
      const { projects, loadTasks } = useProjects.getState();
      if (projects.some((p) => p.id === projectId)) void loadTasks(projectId);
    });
  }, []);

  // Main changed the project list (the control API added a project): reload
  // it. The active project stays as it is.
  useEffect(() => {
    return window.electronAPI.onProjectsChanged(() => {
      void useProjects.getState().loadProjects();
    });
  }, []);

  // Rotation: all tasks with a live session, minus exclusions. A sleeping
  // (`stopped`) session has no orb and isn't active, so it stays out.
  const rotationTasks = React.useMemo(() => {
    const tasks: Task[] = [];
    for (const projectTasks of Object.values(tasksByProject)) {
      for (const task of projectTasks) {
        const activity = taskActivity[task.id];
        if (
          !task.archivedAt &&
          activity !== undefined &&
          activity.state !== 'stopped' &&
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
    void loadProjects();
  }, []);

  // `gh auth status` spawns a subprocess (100-500ms); warm it once so the
  // TaskModal can read the result synchronously instead of mid-mount.
  useEffect(() => {
    void window.electronAPI.githubCheckAvailable().then((r) => {
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
    void window.electronAPI.adoCheckConfigured(id).then((r) => {
      if (r.success) useProjects.getState().setAdoConfigured(id, !!r.data);
    });
    if (activeProjectIsGit && activeProjectPathForFetch) {
      void window.electronAPI.gitListBranches(activeProjectPathForFetch).then((r) => {
        if (r.success && r.data) {
          useProjects.getState().setBranchesForProject(id, r.data);
        }
      });
    }
  }, [activeProjectIdForFetch, activeProjectPathForFetch, activeProjectIsGit]);

  // Focus a task from main (a notification click, or the control API's
  // tasks.open). Select its project too: the task may live in another one.
  useEffect(() => {
    return window.electronAPI.onFocusTask(({ taskId, projectId }) => {
      if (projectId) setActiveProjectId(projectId);
      setActiveTaskId(taskId);
    });
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
  useSystemHealth();

  // Persist usage thresholds

  // (Selection persistence to localStorage is handled by projectsStore's
  // setActiveProject/setActiveTask actions.)

  // Clear stale activeTaskId if it no longer exists in loaded tasks.
  // Wait until all projects have had their tasks loaded to avoid clearing
  // prematurely when tasks load out of order across projects.
  useEffect(() => {
    if (!activeTaskId || projects.length === 0) return;
    if (Object.keys(tasksByProject).length < projects.length) return;
    const current = selectTaskById({ tasksByProject }, activeTaskId);
    if (current && !current.archivedAt) return;
    setActiveTaskId(null);
  }, [tasksByProject, activeTaskId, projects.length]);

  // Load tasks for all projects when projects change
  useEffect(() => {
    for (const project of projects) {
      void loadTasksForProject(project.id);
    }
  }, [projects]);

  // One-time offer to move pre-0.16 worktrees (`<parent>/worktrees/`) under
  // each project's `.claude/worktrees/`. Asked once per launch, after every
  // project's tasks are loaded, unless the user ticked "Don't ask again".
  const [worktreeMigrationPlan, setWorktreeMigrationPlan] = useState<
    WorktreeMigrationProject[] | null
  >(null);
  const migrationCheckedRef = useRef(false);
  useEffect(() => {
    if (migrationCheckedRef.current) return;
    if (projects.length === 0) return;
    if (Object.keys(tasksByProject).length < projects.length) return;
    migrationCheckedRef.current = true;
    if (isWorktreeMigrationDismissed()) return;
    void window.electronAPI.worktreeMigrationPlan().then((resp) => {
      if (resp.success && resp.data && resp.data.length > 0) {
        setWorktreeMigrationPlan(resp.data);
      }
    });
  }, [projects, tasksByProject]);

  const handleWorktreesMigrated = useCallback(async (results: WorktreeMigrationResult[]) => {
    // Main killed the moved tasks' PTYs before `git worktree move`; drop the
    // renderer's cached terminals (they hold the old cwd) so the panes remount
    // against the new path once the reloaded tasks arrive.
    for (const r of results) {
      for (const taskId of [...r.moved, ...r.removed]) {
        await sessionRegistry.dispose(taskId);
        await sessionRegistry.disposeByPrefix(`shell:${taskId}`);
      }
      await useProjects.getState().loadTasks(r.projectId);
    }
  }, []);

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
    toast.error('Multiple tasks share a directory', {
      description: `They may cross-resume each other's Claude sessions. Archive the duplicates: ${summary}`,
      key: 'duplicate-task-dirs',
      lasting: true,
    });
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

  // Lowering the limit releases the least recent off-screen terminals at once.
  useEffect(() => {
    setWebglHeldLimit(webglHeldLimit);
  }, [webglHeldLimit]);

  const cycleTask = useCallback(
    (direction: 1 | -1) => {
      if (activeProjectTasks.length === 0) return;
      const currentIdx = activeProjectTasks.findIndex((t) => t.id === activeTaskId);
      const nextIdx =
        (currentIdx + direction + activeProjectTasks.length) % activeProjectTasks.length;
      setActiveTaskId(activeProjectTasks[nextIdx]!.id);
    },
    [activeProjectTasks, activeTaskId],
  );

  // MRU (most-recently-used) cycling for Ctrl+Tab. mruRef holds rotation task
  // IDs most-recent-first; cyclingRef is the in-flight hold-Tab session. A quick
  // single Ctrl+Tab jumps to the last-viewed task; holding Ctrl and tapping Tab
  // walks further down a frozen snapshot, and releasing Ctrl commits the landing
  // task to the front of the MRU (see commitCycle). This makes single taps
  // toggle the two most-recent while a held walk can reach deeper tasks.
  const mruRef = useRef<string[]>([]);
  const cyclingRef = useRef<{ snapshot: string[]; pointer: number } | null>(null);

  // Keep the MRU fresh on every ordinary task switch (click, Cmd+digit, …), but
  // NOT while a walk is previewing tasks — those reorder only on commit, so the
  // snapshot the walk steps through stays stable under repeated Tab.
  useEffect(() => {
    if (activeTaskId && !cyclingRef.current) {
      mruRef.current = [activeTaskId, ...mruRef.current.filter((id) => id !== activeTaskId)];
    }
  }, [activeTaskId]);

  const cycleRotation = useCallback(
    (direction: 1 | -1) => {
      if (!cyclingRef.current) {
        // Start a session: order the eligible (rotation) tasks by recency. The
        // active task is MRU[0], so the snapshot begins where we already are.
        const eligible = rotationTasks.map((t) => t.id);
        if (eligible.length < 2) return;
        const pos = new Map(mruRef.current.map((id, i) => [id, i]));
        const snapshot = [...eligible].sort(
          (a, b) => (pos.get(a) ?? Infinity) - (pos.get(b) ?? Infinity),
        );
        // Begin at the active task (MRU[0]); if it isn't eligible, start at -1
        // so the first forward step still lands on snapshot[0].
        cyclingRef.current = { snapshot, pointer: snapshot.indexOf(activeTaskId ?? '') };
      }
      const session = cyclingRef.current;
      const n = session.snapshot.length;
      session.pointer = (session.pointer + direction + n) % n;
      const nextTask = rotationTasks.find((t) => t.id === session.snapshot[session.pointer]);
      if (nextTask) {
        setActiveProjectId(nextTask.projectId);
        setActiveTaskId(nextTask.id);
      }
    },
    [rotationTasks, activeTaskId],
  );

  // Commit the in-flight walk: bump the landed task to the front of the MRU so
  // single taps keep toggling the two most-recent. Fires when Ctrl is released
  // (or the window loses focus mid-walk, so a stranded session can't linger).
  const commitCycle = useCallback(() => {
    const session = cyclingRef.current;
    if (!session) return;
    const landed = session.snapshot[session.pointer]!;
    mruRef.current = [landed, ...mruRef.current.filter((id) => id !== landed)];
    cyclingRef.current = null;
  }, []);

  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') commitCycle();
    };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', commitCycle);
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur-sm', commitCycle);
    };
  }, [commitCycle]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Tab / Ctrl+Shift+Tab — MRU walk (works even when terminal is
      // focused). Ignore auto-repeat so holding Tab doesn't spin: one step per
      // physical press, like OS alt-tab. Release of Ctrl commits (see keyup).
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault();
        if (!e.repeat) cycleRotation(e.shiftKey ? -1 : 1);
        return;
      }

      // A component already handled this key (a menu's closing Escape, a
      // Monaco widget): don't also run a global shortcut for it. xterm marks
      // most keys handled, so the terminal is exempt and keeps its ⌘ chords.
      const target = e.target as HTMLElement | null;
      if (e.defaultPrevented && !target?.closest?.('.xterm')) return;

      // Skip global shortcuts when typing in text inputs — except the shell's
      // own ⌘ chords on macOS: ⌘ never types text or reaches the PTY, so
      // they work from the terminal (whose input is a textarea) too.
      const tag = (e.target as HTMLElement)?.tagName;
      const inTextField = tag === 'INPUT' || tag === 'TEXTAREA';
      const shellChord = !inTextField || (isMac && e.metaKey);
      if (shellChord && keybindings.toggleSidebar && matchesBinding(e, keybindings.toggleSidebar)) {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (
        shellChord &&
        keybindings.toggleInspector &&
        matchesBinding(e, keybindings.toggleInspector)
      ) {
        e.preventDefault();
        toggleInspector();
        return;
      }
      if (shellChord && keybindings.findTask && matchesBinding(e, keybindings.findTask)) {
        e.preventDefault();
        setTaskFinderOpen((v) => !v);
        return;
      }
      if (inTextField) return;

      // Tasks
      if (keybindings.newTask && matchesBinding(e, keybindings.newTask)) {
        e.preventDefault();
        const projectId = newTaskProjectId(
          activeProjectId,
          projects,
          Object.values(tasksByProject).flat(),
        );
        if (projectId) void handleNewTask(projectId);
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
        void handleStageAll();
      }
      if (keybindings.unstageAll && matchesBinding(e, keybindings.unstageAll)) {
        e.preventDefault();
        void handleUnstageAll();
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
        } else if (inlineEditor && expanded && !changesPanelRef.current?.isCollapsed()) {
          // Narrow or collapsed, the sidebar keeps the editor out of sight;
          // Escape doesn't close what can't be seen.
          e.preventDefault();
          closeEditorOf(inlineEditor.target.cwd);
        } else if (showCommitGraph) {
          e.preventDefault();
          setShowCommitGraph(false);
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
        const digit = e.code >= 'Digit1' && e.code <= 'Digit9' ? parseInt(e.code[5]!, 10) : 0;
        if (digit > 0 && digit <= projects.length) {
          e.preventDefault();
          const projectId = projects[digit - 1]!.id;
          setActiveProjectId(projectId);
          const tasks = (tasksByProject[projectId] || []).filter((t) => !t.archivedAt);
          if (tasks.length > 0) setActiveTaskId(tasks[0]!.id);
        }
      }
      // Cmd+1..9 to jump to task by index
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const digit = e.key >= '1' && e.key <= '9' ? parseInt(e.key, 10) : 0;
        if (digit > 0 && digit <= activeProjectTasks.length) {
          e.preventDefault();
          setActiveTaskId(activeProjectTasks[digit - 1]!.id);
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
    inlineEditor,
    expanded,
    closeEditorOf,
    showCommitGraph,
    showSettings,
    showTaskModal,
    showAddProjectModal,
    keybindings,
    cycleTask,
    cycleRotation,
  ]);

  // Reads the panels, not the settings, so the keyboard handler's closure
  // can't go stale. With the task sidebar expanded, the room
  // the left sidebar frees goes to the task sidebar and the room it takes
  // comes back from it: the centre keeps its width. Otherwise the centre
  // gives and takes, as the library does.
  const inspectorExpandedRef = useRef(false);
  // While expanding collapsed the left sidebar (D259): the room it freed (%
  // of the shell), given back as the sidebar goes narrow. Null once the user
  // toggles the left sidebar themselves.
  const leftFreedByExpandRef = useRef<number | null>(null);
  // The left sidebar's body: the motion reads its panel's end layout in px
  // from the shell's width (the panel's own px is mid-transition).
  const sidebarBodyRef = useRef<HTMLDivElement>(null);
  const measureLeft = useCallback((): PanelExtent | null => {
    const panel = sidebarPanelRef.current;
    const groupPx = sidebarBodyRef.current?.closest(
      '[data-slot="resizable-panel-group"]',
    )?.clientWidth;
    if (!panel || !groupPx) return null;
    return {
      px: (panel.getSize().asPercentage / 100) * groupPx,
      collapsed: panel.isCollapsed(),
    };
  }, []);
  // The shell's planned motion, for every way its sidebars move (narrow ⇄
  // expanded, closing the editor, hide ⇄ show, ⌘B); `easeNow` is the slower
  // ease while one runs, so no panel's `animate` flag clears mid-ease.
  const {
    motion: sidebarMotion,
    leftHold,
    phase: motionPhase,
    run: runMotion,
    stop: stopMotion,
    easeNow,
  } = usePlannedMotion(measureLeft);
  // ⌘B and the left sidebar's own toggle take the planned motion too (D266):
  // the task sidebar's content isn't held (it keeps its width, or reflows
  // as it takes or gives the room); the left sidebar's content follows the
  // motion's rail rule (`sidebarRail`), held at its width and faded (`leftHold`).
  const toggleSidebar = useCallback(() => {
    if (!sidebarPanelRef.current) return;
    // The user's call now: going narrow leaves the left sidebar as it is.
    leftFreedByExpandRef.current = null;
    runMotion({
      movesLeft: true,
      move: () => {
        const panel = sidebarPanelRef.current;
        if (!panel) return;
        const inspector = changesPanelRef.current;
        const handOff = inspectorExpandedRef.current && !!inspector && !inspector.isCollapsed();
        const leftBefore = panel.getSize().asPercentage;
        const inspectorBefore = inspector?.getSize().asPercentage ?? 0;
        if (panel.isCollapsed()) panel.expand();
        else panel.collapse();
        if (!handOff || !inspector) return;
        inspector.resize(
          `${handOffWidth({
            inspector: inspectorBefore,
            leftBefore,
            leftAfter: panel.getSize().asPercentage,
            min: TUI_PANEL_MIN_PCT,
            max: INSPECTOR_MAX_PCT,
          })}%`,
        );
      },
    });
  }, [runMotion]);

  // A task's editor stays its own while another task is active: switching
  // back finds it as it was (narrow or expanded, tabs, unsaved edits),
  // restoring its tabs rather than opening again the file it opened on.
  const editorTaskPathRef = useRef(activeTask?.path);
  useEffect(() => {
    const prev = editorTaskPathRef.current;
    editorTaskPathRef.current = activeTask?.path;
    if (prev && prev !== activeTask?.path) useEditors.getState().park(prev);
  }, [activeTask?.path]);

  // Collapsing (to its rail) hides the task sidebar without closing the
  // editor: it stays mounted out of sight (tabs, panes, unsaved edits) and
  // expanding brings it back at the width it left. Collapsing takes the
  // keyboard from it back to the task's Claude Code TUI.
  // `expandedAtCollapseRef`: whether the width the panel comes back at is
  // the expanded one (set however it collapsed).
  const expandedAtCollapseRef = useRef(false);
  // The task sidebar's least width (px), which its view tabs report.
  const [inspectorMinPx, setInspectorMinPx] = useState<number>();
  // The left sidebar's (px), likewise: dragged narrower, it snaps to its
  // rail (the panel's own collapse) instead of truncating its tabs (T16).
  // Until its tabs have measured (launched on its rail), its floor: so it
  // opens straight to the width it keeps, which the motion holds it at.
  const [sidebarMinPx, setSidebarMinPx] = useState<number>();
  // The width before a side-car TUI sized the panel to hug it (below).
  const changesSizeBeforeTui = useRef<number | null>(null);
  const inspectorBodyRef = useRef<HTMLDivElement>(null);
  // The width (%) the panel had when the user last hid it: showing goes back
  // to it (the library's own is out of reach, and the motion holds the
  // content at it before the panel opens).
  const shownPctRef = useRef<number | null>(null);
  // Hide ⇄ show is the planned motion too (D264): hiding, the content stays
  // as it is, clipped by the closing panel, until it has closed; showing, it
  // is there at the width the panel opens to before it opens. The editor,
  // expanded, keeps its width and doesn't fade.
  // Showing; `restoreLeft`: the left sidebar comes back in the same ease
  // (the rail's show, narrowing a sidebar whose expanding collapsed it);
  // `withTerminal`: the terminal drawer opens in the held layout, before the
  // ease, so the content the panel opens on is its end layout, and the active
  // terminal takes the keyboard once the motion is over.
  const showInspector = useCallback(
    (restoreLeft: boolean, withTerminal = false) => {
      const panel = changesPanelRef.current;
      if (!panel?.isCollapsed()) return;
      const groupPx =
        inspectorBodyRef.current?.closest('[data-slot="resizable-panel-group"]')?.clientWidth ??
        window.innerWidth;
      const expanded = inspectorExpandedRef.current;
      const widths = loadInspectorWidths();
      const restored = shownPctRef.current ?? (expanded ? widths.expanded : widths.narrow);
      const pct =
        widthOnShow({
          expandedAtCollapse: expandedAtCollapseRef.current,
          expanded,
          restored,
          widths,
          narrowMax: TUI_PANEL_MAX_PCT,
        }) ?? restored;
      runMotion({
        hold: { width: Math.round((groupPx * pct) / 100), to: 'shown' },
        // Once the held layout has laid out: the drawer's group, hidden
        // behind the rail till now, has its height to open in.
        ready: withTerminal
          ? (go) =>
              whenFramesSettle(() => {
                const drawer = shellDrawerPanelRef.current;
                if (drawer?.isCollapsed()) expandShellDrawer(drawer);
                go();
              }, SHOW_LAYOUT_WAIT_MS)
          : undefined,
        movesLeft: restoreLeft,
        // The library clamps the width (its bounds, the centre's least).
        move: () => {
          if (restoreLeft) sidebarPanelRef.current?.expand();
          panel.resize(`${pct}%`);
          return Math.round((groupPx * panel.getSize().asPercentage) / 100);
        },
        // As the `focusTerminal` shortcut does, in the drawer.
        done: withTerminal
          ? () =>
              inspectorBodyRef.current
                ?.querySelector<HTMLElement>('.terminal-drawer .xterm-helper-textarea')
                ?.focus()
          : undefined,
      });
    },
    [runMotion],
  );
  const toggleInspector = useCallback(() => {
    const panel = changesPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      showInspector(false);
      return;
    }
    shownPctRef.current = panel.getSize().asPercentage;
    // The TUI's hugging width isn't a width the user chose.
    if (changesSizeBeforeTui.current === null) {
      saveInspectorWidth(
        inspectorExpandedRef.current ? 'expanded' : 'narrow',
        panel.getSize().asPercentage,
      );
    }
    const hadFocus = inspectorBodyRef.current?.contains(document.activeElement) ?? false;
    runMotion({
      hold: { width: Math.round(panel.getSize().inPixels), to: 'hidden' },
      move: () => panel.collapse(),
    });
    const id = useProjects.getState().activeTaskId;
    if (hadFocus && id) requestAnimationFrame(() => sessionRegistry.get(id)?.focus());
  }, [runMotion, showInspector]);

  // Expanding eases the task sidebar to its expanded width, going narrow back
  // to its narrow one, each remembered. One panel, resized: swapping panels
  // re-registers them, and the width jumps.
  //
  // The motion is planned so nothing arrives mid-ease (D177, D258, D259): the
  // sidebar takes its expanded layout first (split, the editor mounted but
  // clear), held at the expanded width and clipped by the panel, its list
  // exactly as wide as the narrow column was, so the list never moves and
  // only the panel's edge does. Expanding collapses the left sidebar in the
  // same ease, its room going to the editor; going narrow gives it back
  // unless the user has toggled it since. The ease (EXPAND_EASE_MS,
  // `ease-calm`, for every panel and the editor's fade) then starts, and the
  // editor fades in over it (out, going narrow). Going narrow, the split
  // holds until the ease ends, the narrow column taking the list's width. An
  // editor opening for the first time is waited for (up to
  // EDITOR_MOUNT_WAIT_MS), so Monaco's start-up lands before the ease, not
  // in it.
  // A layout effect, ahead of the one below: a show that narrows first
  // (`showInspectorNarrow`) reads it right after that commit.
  useLayoutEffect(() => {
    inspectorExpandedRef.current = expanded;
  }, [expanded]);
  const editorMounted = useRef(false);
  const onEditorMounted = useRef<(() => void) | null>(null);
  const handleEditorMounted = useCallback((mounted: boolean) => {
    editorMounted.current = mounted;
    if (mounted) onEditorMounted.current?.();
  }, []);
  const prevExpandedRef = useRef(expanded);
  // What the sidebar was told last: it keeps its split through the commit
  // that goes narrow, so the list is still there to measure here.
  const [expandedShown, setExpandedShown] = useState(expanded);
  // A layout effect: the held layout must land with the render that
  // expands, or the editor shows for a frame before it clears.
  useLayoutEffect(() => {
    if (prevExpandedRef.current === expanded) return;
    prevExpandedRef.current = expanded;
    setExpandedShown(expanded);
    const panel = changesPanelRef.current;
    const left = sidebarPanelRef.current;
    if (!panel || !left) return;
    const collapsed = panel.isCollapsed();
    const groupPx =
      inspectorBodyRef.current?.closest('[data-slot="resizable-panel-group"]')?.clientWidth ??
      window.innerWidth;
    const widths = loadInspectorWidths();
    // Expanding collapses the left sidebar; going narrow restores it if
    // expanding did.
    const collapseLeft = expanded && !left.isCollapsed();
    const restoreLeft = !expanded && leftFreedByExpandRef.current !== null && left.isCollapsed();
    const freedPct = collapseLeft ? left.getSize().asPercentage - (RAIL_PX / groupPx) * 100 : 0;
    if (!collapsed) {
      // The expanded width is kept without the room the left sidebar lent it.
      saveInspectorWidth(
        expanded ? 'narrow' : 'expanded',
        panel.getSize().asPercentage - (restoreLeft ? (leftFreedByExpandRef.current ?? 0) : 0),
      );
    }
    if (!expanded) leftFreedByExpandRef.current = null;
    let width = widthOnExpandedToggle({ expanded, collapsed, widths });
    let listPct: number | undefined;
    if (width !== null && expanded) {
      // The narrow column's width, which the split's list keeps.
      const listPx = collapsed ? (widths.narrow / 100) * groupPx : panel.getSize().inPixels;
      const leftAfterPx = collapseLeft ? RAIL_PX : left.getSize().inPixels;
      const plan = planExpand({
        groupPx,
        listPx,
        expandedPct: widths.expanded,
        freedPx: (freedPct / 100) * groupPx,
        maxPx: Math.min(
          (INSPECTOR_MAX_PCT / 100) * groupPx,
          groupPx - leftAfterPx - MAIN_MIN_PX - SHELL_SLACK_PX,
        ),
        listMaxPct: LIST_MAX_PCT,
      });
      width = plan.panelPct;
      listPct = plan.listPct;
    } else if (width !== null) {
      // The list panel, which the narrow column keeps.
      const list = inspectorBodyRef.current?.querySelector('[data-panel][id="list"]');
      const listPx = list?.getBoundingClientRect().width;
      if (listPx) {
        width = narrowFromList({ groupPx, listPx, min: TUI_PANEL_MIN_PCT, max: TUI_PANEL_MAX_PCT });
        // The split holds till the ease ends, its list where it was.
        listPct = (listPx / (panel.getSize().inPixels - SIDEBAR_GUTTER_PX)) * 100;
      }
    }
    // The editor closing (`closeEditorOf`) closes once it has gone narrow;
    // expanding again keeps it.
    const settleClose = () => {
      const cwd = pendingCloseRef.current;
      pendingCloseRef.current = null;
      if (cwd && useEditors.getState().byCwd[cwd]?.hidden) useEditors.getState().close(cwd);
    };
    if (expanded) pendingCloseRef.current = null;
    if (width === null) {
      stopMotion();
      settleClose();
      // Narrow behind a collapsed task sidebar: the left sidebar comes back
      // on its own, through the planned motion so its content fades in at
      // its width (`leftHold`).
      if (restoreLeft) runMotion({ movesLeft: true, move: () => left.expand() });
      return;
    }
    const targetWidth = width;
    // The expanded width: where expanding goes, where narrowing comes from.
    const heldPx = Math.round(Math.max(panel.getSize().inPixels, (groupPx * targetWidth) / 100));
    return runMotion({
      hold: { width: heldPx, to: expanded ? 'expanded' : 'narrow', listPct },
      // An editor opening for the first time is waited for, so Monaco's
      // start-up lands before the ease, not in it.
      ready:
        expanded && !editorMounted.current
          ? (go) => {
              const timer = setTimeout(() => onEditorMounted.current?.(), EDITOR_MOUNT_WAIT_MS);
              onEditorMounted.current = () => {
                onEditorMounted.current = null;
                clearTimeout(timer);
                go();
              };
              return () => {
                onEditorMounted.current = null;
                clearTimeout(timer);
              };
            }
          : undefined,
      movesLeft: collapseLeft || restoreLeft,
      // Room is freed before it is taken, so the centre's minimum never
      // clamps a panel mid-plan.
      move: () => {
        if (collapseLeft) {
          left.collapse();
          leftFreedByExpandRef.current = freedPct;
        }
        panel.resize(`${targetWidth}%`);
        if (restoreLeft) left.expand();
      },
      done: settleClose,
    });
  }, [expanded, runMotion, stopMotion]);
  const narrowEditor = useCallback(() => {
    if (activeTask) useEditors.getState().hide(activeTask.path);
  }, [activeTask]);
  // The rail's clicks show the sidebar narrow. Hidden expanded, it goes
  // narrow behind the rail first (committed at once, so the show plans from
  // the narrow width and layout), then shows; the left sidebar, if
  // expanding collapsed it, comes back in the show's ease, not on its own.
  const showInspectorNarrow = useCallback(
    ({ terminal }: { terminal: boolean }) => {
      if (!changesPanelRef.current?.isCollapsed()) return;
      const wasExpanded = inspectorExpandedRef.current;
      const restoreLeft =
        wasExpanded &&
        leftFreedByExpandRef.current !== null &&
        !!sidebarPanelRef.current?.isCollapsed();
      if (wasExpanded) {
        // Restored below, by the show.
        leftFreedByExpandRef.current = null;
        flushSync(narrowEditor);
      }
      showInspector(restoreLeft, terminal);
    },
    [narrowEditor, showInspector],
  );

  // Reads the panel, not the setting, so the keyboard handler's closure can't go stale.
  const toggleShellDrawer = useCallback(() => {
    const panel = shellDrawerPanelRef.current;
    if (!panel) return;
    setShellDrawerAnimating(true);
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, [setShellDrawerAnimating]);

  // While a side-car TUI is the active drawer tab, smoothly size the right
  // panel (the drawer lives inside it) to hug the TUI's pinned canvas — clack
  // can't reflow, so the panel fits the canvas, not the reverse. Restore the
  // user's width when the TUI finishes / closes / is cancelled. The drawer
  // stays mounted while the sidebar is collapsed: that never expands it.
  const handleTuiPanelActive = useCallback((active: boolean, canvasPx?: number) => {
    const panel = changesPanelRef.current;
    if (!panel) return;
    if (active) {
      // canvasPx may arrive 0/undefined on the first frame; ignore until a
      // real measurement lands so we don't snap to a bogus width.
      if (!canvasPx || changesSizeBeforeTui.current !== null) return;
      if (panel.isCollapsed()) return;
      const targetPct = Math.max(
        TUI_PANEL_MIN_PCT,
        Math.min(
          TUI_PANEL_MAX_PCT,
          (((canvasPx + TUI_PANEL_CHROME_PX) * TUI_PANEL_WIDTH_SCALE) / window.innerWidth) * 100,
        ),
      );
      changesSizeBeforeTui.current = panel.getSize().asPercentage;
      setChangesAnimating(true);
      panel.resize(`${targetPct}%`);
      setTimeout(() => setChangesAnimating(false), panelEaseMs());
    } else {
      const prev = changesSizeBeforeTui.current;
      changesSizeBeforeTui.current = null;
      if (prev === null || panel.isCollapsed()) return;
      setChangesAnimating(true);
      panel.resize(`${prev}%`);
      setTimeout(() => setChangesAnimating(false), panelEaseMs());
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
  const handleDeleteProjectConfirm = useUi((s) => s.confirmDeleteProject);
  const handleDeleteTaskConfirm = useUi((s) => s.confirmDeleteTask);

  // Git actions live in gitStore (they resolve the active task themselves).
  // Stable, so the commit run's success effect fires once.
  const refreshActiveGitStatus = useCallback(() => {
    const task = selectActiveTask(useProjects.getState());
    if (task) void useGit.getState().refreshGitStatus(task.path);
  }, []);
  // Kept as App aliases because the stage-all / unstage-all keybindings call them.
  const handleStageAll = useGit((s) => s.stageAll);
  const handleUnstageAll = useGit((s) => s.unstageAll);

  // ── Handlers ─────────────────────────────────────────────

  // An archived project's tasks aren't in tasksByProject; the delete dialog
  // still needs them to offer worktree and branch cleanup.
  const [archivedDeleteTasks, setArchivedDeleteTasks] = useState<Task[]>([]);

  function handleDeleteProject(id: string) {
    const { projects: listed, archivedProjects } = useProjects.getState();
    const project = listed.find((p) => p.id === id);
    if (project) {
      setDeleteProjectTarget(project);
      return;
    }
    const archived = archivedProjects.find((p) => p.id === id);
    if (!archived) return;
    void window.electronAPI.getTasks(id).then((resp) => {
      setArchivedDeleteTasks(resp.success && resp.data ? resp.data : []);
      setDeleteProjectTarget(archived);
    });
  }

  function handleSelectTask(projectId: string, taskId: string) {
    useProjects.getState().selectTask(projectId, taskId);
  }

  // Loaded before the modal mounts so its fields render with the project's
  // taskDefaults already applied (prefill only).
  const [taskModalDefaults, setTaskModalDefaults] = useState<TaskModalDefaults | null>(null);

  async function handleNewTask(projectId: string) {
    setActiveProjectId(projectId);
    setTaskModalProjectId(projectId);
    // Read from the store (not a closure) so a freshly-created project resolves.
    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    let defaults: TaskModalDefaults | null = null;
    if (project) {
      const resp = await window.electronAPI.readWorkspaceConfig(project.path);
      defaults = resp.success ? (resp.data?.taskDefaults ?? null) : null;
    }
    setTaskModalDefaults(defaults);
    setShowTaskModal(true);
  }

  function handleCreateTask(options: CreateTaskOptions): Promise<boolean> {
    // Modal-selected project (App-owned) takes precedence over the active one.
    return useProjects
      .getState()
      .createTask(options, taskModalProjectId || activeProjectId || undefined);
  }

  function handleDeleteTask(id: string) {
    const found = selectTaskById({ tasksByProject }, id);
    if (found) setDeleteTaskTarget(found);
  }

  function handleTaskSettings(id: string) {
    const found = selectTaskById({ tasksByProject }, id);
    if (found) setTaskSettingsTarget(found);
  }

  async function persistTaskUpdate(task: Task, patch: Partial<Task>): Promise<Task | null> {
    const updated = await useProjects.getState().updateTask(task, patch);
    // Keep the (App-owned) task-settings modal target in sync with the save.
    if (updated) setTaskSettingsTarget((prev) => (prev?.id === updated.id ? updated : prev));
    return updated;
  }

  // ── Git Handlers ─────────────────────────────────────────

  function handleViewDiff(filePath: string, staged: boolean) {
    if (!activeTask) return;
    // Monaco loads HEAD/index + working copy itself via files:readForEdit;
    // App.tsx just opens the modal with the file identity. Pin the working view
    // explicitly so clicking a specific file always shows its working diff
    // rather than restoring the editor's last (possibly commit/branch) view.
    useEditors.getState().open({
      cwd: activeTask.path,
      filePath,
      initialView: { kind: 'working', ref: staged ? 'index' : 'HEAD' },
    });
  }

  // The left sidebar shows its collapsed rail once its panel is there: while
  // the task sidebar's motion collapses or restores it (D259), it keeps its
  // full content through the ease, so collapsing switches after it and
  // restoring before it, not on the ease's first frame.
  const sidebarRail = sidebarCollapsed && !(motionPhase === 'easing' && sidebarAnimating);
  // The task sidebar shows its rail once it has closed and until it opens.
  const taskRailed = changesPanelCollapsed && !sidebarMotion;

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      // The task sidebar's narrow ⇄ expanded ease, for every panel it moves.
      style={
        motionPhase
          ? ({
              '--panel-ease': `${panelEaseMs(EXPAND_EASE_MS)}ms`,
              '--panel-curve': 'var(--ease-calm)',
            } as React.CSSProperties)
          : undefined
      }
    >
      <ResizablePanelGroup
        orientation="horizontal"
        className="flex-1"
        autoSaveId="shell"
        panelIds={activeTask ? SHELL_PANELS_TASK : SHELL_PANELS}
      >
        <ResizablePanel
          id="sidebar"
          panelRef={sidebarPanelRef}
          animate={sidebarAnimating}
          defaultSize={startedCollapsed.sidebar ? RAIL_PX : '18%'}
          minSize={sidebarMinPx ?? LEFT_SIDEBAR_MIN_PX}
          maxSize="28%"
          collapsible
          collapsedSize={RAIL_PX}
          dragOpen
          onCollapse={() => {
            setSidebarCollapsed(true);
            setTimeout(() => setSidebarAnimating(false), easeNow());
          }}
          onExpand={() => {
            setSidebarCollapsed(false);
            setTimeout(() => setSidebarAnimating(false), easeNow());
          }}
        >
          {/* Crossing between its rail and its content in an ease, held at
              its open width and faded (`leftHold`). */}
          <HeldFrame held={leftHold} railed={sidebarRail} bodyRef={sidebarBodyRef}>
            <ErrorBoundary area="The sidebar">
              <LeftSidebar
                projects={projects}
                activeProjectId={activeProjectId}
                onSelectProject={(id) => {
                  setActiveProjectId(id);
                  setActiveTaskId(null);
                }}
                onOpenFolder={() => {
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
                onNewTask={(id) => void handleNewTask(id)}
                onDeleteTask={handleDeleteTask}
                onArchiveTask={(id) => {
                  void handleArchiveTask(id);
                }}
                onRestoreTask={(id) => {
                  void handleRestoreTask(id);
                }}
                onCloseTask={(id) => void handleCloseTask(id)}
                onTaskSettings={handleTaskSettings}
                onOpenSettings={() => {
                  setSettingsInitialTab(undefined);
                  setShowSettings(true);
                }}
                onShowCommitGraph={(projectId) => {
                  setActiveProjectId(projectId);
                  setShowCommitGraph(true);
                }}
                collapsed={sidebarRail}
                unseenTaskIds={unseenTaskIds}
                onReorderProjects={handleReorderProjects}
                onReorderTasks={handleReorderTasks}
                onReorderTasksCommit={(projectId, reordered) => {
                  void handleReorderTasksCommit(projectId, reordered);
                }}
                contextUsage={contextUsage}
                onMinWidth={setSidebarMinPx}
              />
            </ErrorBoundary>
          </HeldFrame>
        </ResizablePanel>
        <ResizableHandle />

        <ResizablePanel
          id="main"
          animate={sidebarAnimating || changesAnimating}
          minSize={MAIN_MIN_PX}
        >
          <ErrorBoundary area="This view" resetKey={activeTask?.id ?? activeProjectId}>
            <MainContent
              activeTask={activeTask}
              activeProject={activeProject}
              tasks={activeProjectTasks}
              terminalBg={terminalBg}
              sidebarCollapsed={sidebarCollapsed}
              inspectorCollapsed={changesPanelCollapsed}
              onToggleSidebar={toggleSidebar}
              onToggleInspector={toggleInspector}
              onSelectTask={setActiveTaskId}
              onEnableRemoteControl={() => activeTask && setRemoteControlModalPtyId(activeTask.id)}
              modelName={
                activeTask
                  ? headerModelName(statusLineData[activeTask.id]?.model, activeTask.model)
                  : null
              }
              onOpenIde={() => {
                if (activeTask) void openInIde(activeTask.path);
              }}
              onNewTask={() => {
                if (activeProjectId) void handleNewTask(activeProjectId);
              }}
              onProjectSettings={() => {
                if (activeProject) setProjectSettingsTarget(activeProject);
              }}
              onShowCommitGraph={() => setShowCommitGraph(true)}
              onDeleteProject={() => {
                if (activeProject) handleDeleteProject(activeProject.id);
              }}
              archivedTasks={
                activeProjectId
                  ? (tasksByProject[activeProjectId] || []).filter((t) => t.archivedAt)
                  : []
              }
              onCloseTask={(id) => void handleCloseTask(id)}
              onTaskSettings={handleTaskSettings}
              onDeleteTask={handleDeleteTask}
              onArchiveTask={(id) => {
                void handleArchiveTask(id);
              }}
              onRestoreTask={(id) => {
                void handleRestoreTask(id);
              }}
            />
          </ErrorBoundary>
        </ResizablePanel>

        {activeTask && (
          <>
            <ResizableHandle />
            <ResizablePanel
              id="changes"
              panelRef={changesPanelRef}
              animate={changesAnimating}
              defaultSize={startedCollapsed.inspector ? RAIL_PX : '26%'}
              // Never narrower than its view tabs' labels, once measured.
              minSize={inspectorMinPx ?? `${TUI_PANEL_MIN_PCT}%`}
              maxSize={`${INSPECTOR_MAX_PCT}%`}
              collapsible
              collapsedSize={RAIL_PX}
              dragOpen
              onCollapse={() => {
                expandedAtCollapseRef.current = inspectorExpandedRef.current;
                setChangesPanelCollapsed(true);
                setTimeout(() => setChangesAnimating(false), easeNow());
              }}
              onExpand={({ dragged }) => {
                setChangesPanelCollapsed(false);
                setTimeout(() => setChangesAnimating(false), easeNow());
                // The panel comes back at the width it collapsed from, unless
                // it went narrow or expanded meanwhile, or the layout was
                // saved expanded (Dash quit with the editor shown). Dragged
                // out of its rail, it keeps the width the drag left it.
                const panel = changesPanelRef.current;
                if (!panel || dragged) return;
                const width = widthOnShow({
                  expandedAtCollapse: expandedAtCollapseRef.current,
                  expanded: inspectorExpandedRef.current,
                  restored: panel.getSize().asPercentage,
                  widths: loadInspectorWidths(),
                  narrowMax: TUI_PANEL_MAX_PCT,
                });
                if (width !== null) panel.resize(`${width}%`);
              }}
            >
              {/* Collapsed, it shows its rail once it has closed and until it
                  opens (`railed`), the rest mounted out of sight; Monaco and
                  xterm re-lay out once shown. */}
              {/* Held at its width while it eases (`sidebarMotion`), clipped
                  here (the panel itself would scroll); its content doesn't
                  fade (D264), its rail fades in as it comes. */}
              <HeldFrame
                held={sidebarMotion && { width: sidebarMotion.width }}
                railed={taskRailed}
                bodyRef={inspectorBodyRef}
              >
                <ErrorBoundary key={activeTask.id} area="The task sidebar">
                  <RightInspector
                    task={activeTask}
                    modelName={headerModelName(
                      statusLineData[activeTask.id]?.model,
                      activeTask.model,
                    )}
                    rateLimits={latestRateLimits}
                    paces={paces}
                    contextUsage={contextUsage[activeTask.id]}
                    diff={inlineEditor?.target ?? null}
                    expanded={expanded || expandedShown}
                    motion={sidebarMotion}
                    onEditorMounted={handleEditorMounted}
                    terminalTheme={resolvedTerminalTheme}
                    isDark={theme === 'dark'}
                    onViewDiff={handleViewDiff}
                    onOpenEditor={() => {
                      useEditors.getState().open({ cwd: activeTask.path, filePath: '' });
                    }}
                    onNarrow={narrowEditor}
                    onCloseDiff={() => closeEditorOf(activeTask.path)}
                    onCommitFinished={refreshActiveGitStatus}
                    shellDrawerRef={shellDrawerPanelRef}
                    onTuiActiveChange={handleTuiPanelActive}
                    onTaskSettings={() => handleTaskSettings(activeTask.id)}
                    onMinWidth={setInspectorMinPx}
                    railed={taskRailed}
                    onShow={showInspectorNarrow}
                  />
                </ErrorBoundary>
              </HeldFrame>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {showAddProjectModal && (
        <NewProjectDialog
          onClose={() => setShowAddProjectModal(false)}
          onCreated={(projectId) => void finishProjectCreation(projectId)}
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
              taskDefaults={taskModalDefaults}
              onClose={() => setShowTaskModal(false)}
              onCreate={handleCreateTask}
              onGitInit={() => {
                if (modalProject) {
                  void window.electronAPI.detectGit(modalProject.path).then(async (gitResp) => {
                    const gitInfo = gitResp.success ? gitResp.data : null;
                    await window.electronAPI.saveProject({
                      ...modalProject,
                      isGitRepo: gitInfo?.isGitRepo ?? true,
                      gitRemote: gitInfo?.remote ?? null,
                      gitBranch: gitInfo?.branch ?? null,
                    });
                    await loadProjects();
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

      <OrchestratorAccessPrompt />

      {taskSettingsTarget && (
        <TaskSettingsModal
          task={taskSettingsTarget}
          liveModel={headerModelName(
            statusLineData[taskSettingsTarget.id]?.model,
            taskSettingsTarget.model,
          )}
          onClose={() => setTaskSettingsTarget(null)}
          onRename={(id, newName) => {
            if (!taskSettingsTarget || taskSettingsTarget.id !== id) return;
            void persistTaskUpdate(taskSettingsTarget, { name: newName });
          }}
          onSessionSettingChange={(change) => {
            const id = taskSettingsTarget.id;
            void changeSessionSetting(taskSettingsTarget, change).then((updated) => {
              if (updated) setTaskSettingsTarget((prev) => (prev?.id === id ? updated : prev));
            });
          }}
        />
      )}

      {projectSettingsTarget && (
        <ProjectSettingsModal
          project={projectSettingsTarget}
          onClose={() => setProjectSettingsTarget(null)}
          onRename={(id, newName) => {
            const proj = projects.find((p) => p.id === id);
            if (!proj) return;
            void (async () => {
              await window.electronAPI.saveProject({ ...proj, name: newName });
              await loadProjects();
              setProjectSettingsTarget((prev) =>
                prev?.id === id ? { ...prev, name: newName } : prev,
              );
            })();
          }}
        />
      )}

      {taskFinderOpen && (
        <TaskFinder onSelectTask={handleSelectTask} onClose={() => setTaskFinderOpen(false)} />
      )}

      {showSettings && (
        <SettingsModal
          initialTab={settingsInitialTab}
          activeProjectPath={activeProject?.path}
          availableIDEs={availableIDEs}
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

      {worktreeMigrationPlan && (
        <WorktreeMigrationModal
          plan={worktreeMigrationPlan}
          onClose={() => setWorktreeMigrationPlan(null)}
          onMigrated={handleWorktreesMigrated}
        />
      )}

      {deleteProjectTarget && (
        <DeleteProjectModal
          project={deleteProjectTarget}
          tasks={tasksByProject[deleteProjectTarget.id] ?? archivedDeleteTasks}
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
          focusHash={commitGraphFocusHash}
          onClose={() => {
            setShowCommitGraph(false);
            setCommitGraphFocusHash(null);
          }}
          onSelectTask={(taskId) => {
            setActiveTaskId(taskId);
            setShowCommitGraph(false);
            setCommitGraphFocusHash(null);
          }}
        />
      )}

      {/* After every other modal, so a confirm shows over the one that asked. */}
      <ConfirmHost />
      <ClaudeUpdateHost />
      <Toaster />
      <ToastSources />
    </div>
  );
}
