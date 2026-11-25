import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  Suspense,
  lazy,
} from 'react';
import { TUI_FEATURE_IDS } from '@shared/tuiProtocol';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  panelEaseMs,
  type PanelImperativeHandle,
} from './components/ui/Resizable';
import { LeftSidebar } from './components/leftSidebar/LeftSidebar';
import { MainContent } from './components/MainContent';
import { openInIde } from './lib/openInIde';
import {
  handOffWidth,
  loadInspectorWidths,
  saveInspectorWidth,
  widthOnExpandedToggle,
  widthOnShow,
} from './lib/inspectorWidths';
import { headerModelName } from './lib/modelName';
import { RightInspector, type SidebarMotion } from './components/rightInspector/RightInspector';
import { whenFramesSettle } from './lib/framesSettled';
import { cn } from './lib/cn';
const DiffEditorModal = lazy(() => import('./components/diffEditor/DiffEditorModal'));
import { useSetup } from './stores/setupStore';
import { CommitGraphModal } from './components/CommitGraph/CommitGraphModal';
import { MemoryModal } from './components/memory/MemoryModal';
import { TaskModal } from './components/task/TaskModal';
import { NewProjectWizard } from './components/newProject/NewProjectWizard';
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
import { ToastContainer } from './components/ui/Toast';
import { toast } from 'sonner';
import { getBillionToastContent } from './utils/billionToast';
import { useStatusLine } from './hooks/useStatusLine';
import { useThresholdAlerts } from './hooks/useThresholdAlerts';
import type { Task, WorktreeMigrationProject, WorktreeMigrationResult } from '../shared/types';
import type { CreateTaskOptions, TaskModalDefaults } from './components/task/TaskModal';
import { matchesBinding } from './keybindings';
import { sessionRegistry } from './terminal/SessionRegistry';
import { resolveTheme } from './terminal/terminalThemes';
import { resolveTerminalFontValue } from './terminal/terminalFonts';
import { setWebglHeldLimit } from './terminal/WebglLifecycle';
import { useSettings } from './stores/settingsStore';
import { useUi } from './stores/uiStore';
import { useGit } from './stores/gitStore';
import { useEditors } from './stores/editorsStore';
import { mayCloseEditor } from './components/diffEditor/closeGuard';
import { ConfirmHost } from './components/ui/ConfirmHost';
import { useRuntime } from './stores/runtimeStore';
import { useAppBootstrap } from './hooks/useAppBootstrap';
import { useShallow } from 'zustand/react/shallow';
import {
  useProjects,
  selectActiveProject,
  selectActiveTask,
  selectTaskById,
  selectActiveProjectTasks,
  selectTaskByPath,
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
/** The shell group's panels; the task sidebar mounts only with an active task. */
const SHELL_PANELS = ['sidebar', 'main'];
const SHELL_PANELS_TASK = ['sidebar', 'main', 'changes'];
const isMac = window.electronAPI.getPlatform() === 'darwin';
/** How long expanding waits for an editor opening for the first time to
 *  mount before it eases anyway (it then fades in when it arrives). */
const EDITOR_MOUNT_WAIT_MS = 300;
/** The most the sidebar's ease waits for its new layout's long frames. */
const SIDEBAR_SETTLE_CAP_MS = 250;

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
  const memoryProjectId = useUi((s) => s.memoryProjectId);
  const setMemoryProjectId = useUi((s) => s.setMemoryProjectId);
  const memoryProject = projects.find((p) => p.id === memoryProjectId) ?? null;
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
  // Sync ultracode toggle to main process (applied as a spawn arg on new sessions)
  useEffect(() => {
    window.electronAPI.setUltracode?.(ultracode);
  }, [ultracode]);
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
    const vars: Record<string, string> = { ...customClaudeEnvVars };
    if (effortLevel !== 'auto') vars.CLAUDE_CODE_EFFORT_LEVEL = effortLevel;
    window.electronAPI.setClaudeEnvVars?.(vars);
  }, [effortLevel, customClaudeEnvVars]);

  // Activity + remote-control state (runtimeStore; both fed by its init() subscriptions).
  const taskActivity = useRuntime((s) => s.taskActivity);
  const remoteControlStates = useRuntime((s) => s.remoteControlStates);
  const remoteControlModalPtyId = useUi((s) => s.remoteControlModalPtyId);
  const setRemoteControlModalPtyId = useUi((s) => s.setRemoteControlModalPtyId);

  // Status line data (context + cost + rate limits) — derived contextUsage & latestRateLimits
  const { statusLineData, contextUsage, latestRateLimits, burns } = useStatusLine();

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
      toast.success(title, { description, duration: 8000 });
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
  // of sight while narrow); a folder that is no task's worktree (Claude's
  // memory) has its editor in the modal.
  const inlineEditor = activeTask ? (editors[activeTask.path] ?? null) : null;
  const modalEditor = useMemo(
    () =>
      Object.values(editors).find((e) => !selectTaskByPath({ tasksByProject }, e.target.cwd)) ??
      null,
    [editors, tasksByProject],
  );
  const expanded = !!inlineEditor && !inlineEditor.hidden;

  // Close `cwd`'s editor (asking about unsaved edits) and hand the keyboard
  // back to the task's Claude Code TUI. RAF defers past React's commit so the
  // editor is gone before xterm grabs focus. Not while the memory modal is
  // still up: typing would reach Claude unseen.
  const closeEditorOf = useCallback((cwd: string) => {
    void mayCloseEditor(cwd).then((ok) => {
      if (!ok) return;
      useEditors.getState().close(cwd);
      const id = useProjects.getState().activeTaskId;
      if (id && !useUi.getState().memoryProjectId) {
        requestAnimationFrame(() => sessionRegistry.get(id)?.focus());
      }
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
        } else if (modalEditor) {
          e.preventDefault();
          closeEditorOf(modalEditor.target.cwd);
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
    modalEditor,
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
  const toggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    const inspector = changesPanelRef.current;
    const handOff = inspectorExpandedRef.current && !!inspector && !inspector.isCollapsed();
    const leftBefore = panel.getSize().asPercentage;
    const inspectorBefore = inspector?.getSize().asPercentage ?? 0;
    setSidebarAnimating(true);
    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
    if (!handOff || !inspector) return;
    setChangesAnimating(true);
    inspector.resize(
      `${handOffWidth({
        inspector: inspectorBefore,
        leftBefore,
        leftAfter: panel.getSize().asPercentage,
        min: TUI_PANEL_MIN_PCT,
        max: INSPECTOR_MAX_PCT,
      })}%`,
    );
    setTimeout(() => setChangesAnimating(false), panelEaseMs());
  }, [setChangesAnimating, setSidebarAnimating]);

  // A task's editor stays its own while another task is active: switching
  // back finds it as it was (narrow or expanded, tabs, unsaved edits),
  // restoring its tabs rather than opening again the file it opened on.
  const editorTaskPathRef = useRef(activeTask?.path);
  useEffect(() => {
    const prev = editorTaskPathRef.current;
    editorTaskPathRef.current = activeTask?.path;
    if (prev && prev !== activeTask?.path) useEditors.getState().park(prev);
  }, [activeTask?.path]);

  // Collapsing hides the task sidebar without closing the editor: it stays
  // mounted out of sight (tabs, panes, unsaved edits) and expanding brings
  // it back at the width it left. Collapsing takes the keyboard from it
  // back to the task's Claude Code TUI. `expandedAtCollapseRef`: whether the
  // width the panel comes back at is the expanded one (set however it
  // collapsed).
  const expandedAtCollapseRef = useRef(false);
  // The task sidebar's least width (px), which its view tabs report.
  const [inspectorMinPx, setInspectorMinPx] = useState<number>();
  // The width before a side-car TUI sized the panel to hug it (below).
  const changesSizeBeforeTui = useRef<number | null>(null);
  const inspectorBodyRef = useRef<HTMLDivElement>(null);
  const toggleInspector = useCallback(() => {
    const panel = changesPanelRef.current;
    if (!panel) return;
    setChangesAnimating(true);
    if (panel.isCollapsed()) {
      panel.expand();
      return;
    }
    // The TUI's hugging width isn't a width the user chose.
    if (changesSizeBeforeTui.current === null) {
      saveInspectorWidth(
        inspectorExpandedRef.current ? 'expanded' : 'narrow',
        panel.getSize().asPercentage,
      );
    }
    const hadFocus = inspectorBodyRef.current?.contains(document.activeElement) ?? false;
    panel.collapse();
    const id = useProjects.getState().activeTaskId;
    if (hadFocus && id) requestAnimationFrame(() => sessionRegistry.get(id)?.focus());
  }, [setChangesAnimating]);

  // Expanding eases the task sidebar to its expanded width, going narrow back
  // to its narrow one, each remembered. One panel, resized: swapping panels
  // re-registers them, and the width jumps.
  //
  // The motion is planned so nothing arrives mid-ease (D177): the sidebar
  // takes its expanded layout first (split, the editor mounted but clear),
  // held at the expanded width and clipped by the panel, so its content
  // slides with the panel's edge instead of reflowing every frame. The ease
  // then starts, and the editor fades in over it (out, going narrow). Going
  // narrow, the split holds until the ease ends. An editor opening for the
  // first time is waited for (up to EDITOR_MOUNT_WAIT_MS), so Monaco's
  // start-up lands before the ease, not in it.
  useEffect(() => {
    inspectorExpandedRef.current = expanded;
  }, [expanded]);
  const [sidebarMotion, setSidebarMotion] = useState<SidebarMotion | null>(null);
  const editorMounted = useRef(false);
  const onEditorMounted = useRef<(() => void) | null>(null);
  const handleEditorMounted = useCallback((mounted: boolean) => {
    editorMounted.current = mounted;
    if (mounted) onEditorMounted.current?.();
  }, []);
  const prevExpandedRef = useRef(expanded);
  // A layout effect: the held layout must land with the render that
  // expands, or the editor shows for a frame before it clears.
  useLayoutEffect(() => {
    if (prevExpandedRef.current === expanded) return;
    prevExpandedRef.current = expanded;
    const panel = changesPanelRef.current;
    if (!panel) return;
    const collapsed = panel.isCollapsed();
    if (!collapsed) {
      saveInspectorWidth(expanded ? 'narrow' : 'expanded', panel.getSize().asPercentage);
    }
    const width = widthOnExpandedToggle({
      expanded,
      collapsed,
      widths: loadInspectorWidths(),
    });
    if (width === null) {
      setSidebarMotion(null);
      return;
    }
    const groupPx =
      inspectorBodyRef.current?.closest('[data-slot="resizable-panel-group"]')?.clientWidth ??
      window.innerWidth;
    // The expanded width: where expanding goes, where narrowing comes from.
    const heldPx = Math.round(Math.max(panel.getSize().inPixels, (groupPx * width) / 100));
    const to = expanded ? 'expanded' : 'narrow';
    setSidebarMotion({ width: heldPx, to, phase: 'held' });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelSettle = () => {};
    const ease = () => {
      setChangesAnimating(true);
      panel.resize(`${width}%`);
      setSidebarMotion({ width: heldPx, to, phase: 'easing' });
      timer = setTimeout(() => {
        setChangesAnimating(false);
        setSidebarMotion(null);
      }, panelEaseMs());
    };
    // The ease starts once the held layout has painted and the long frames
    // that lay it out (and mount the editor) are over, from a task of its
    // own (D112): a transition's clock starts at the frame its style change
    // lands in, and an ease-out covers half its distance in its first third.
    const settleThenEase = () => {
      cancelSettle = whenFramesSettle(ease, SIDEBAR_SETTLE_CAP_MS);
    };
    if (!expanded || editorMounted.current) settleThenEase();
    else {
      onEditorMounted.current = () => {
        onEditorMounted.current = null;
        clearTimeout(timer);
        settleThenEase();
      };
      timer = setTimeout(() => onEditorMounted.current?.(), EDITOR_MOUNT_WAIT_MS);
    }
    return () => {
      onEditorMounted.current = null;
      cancelSettle();
      clearTimeout(timer);
    };
  }, [expanded, setChangesAnimating]);
  const narrowEditor = useCallback(() => {
    if (activeTask) useEditors.getState().hide(activeTask.path);
  }, [activeTask]);

  // A Setup tab request shows the drawer: a collapsed task sidebar hides
  // it, so open the sidebar. Once per request: a later collapse must not
  // reopen it.
  const setupTabRequest = useSetup((s) => s.setupTabRequest);
  const handledSetupSeqRef = useRef(0);
  useEffect(() => {
    if (!setupTabRequest || handledSetupSeqRef.current === setupTabRequest.seq) return;
    handledSetupSeqRef.current = setupTabRequest.seq;
    if (changesPanelCollapsed) toggleInspector();
  }, [setupTabRequest, changesPanelCollapsed, toggleInspector]);

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
  // taskDefaults + default worktree scripts already applied (prefill only).
  const [taskModalDefaults, setTaskModalDefaults] = useState<TaskModalDefaults | null>(null);
  const [taskModalDefaultScripts, setTaskModalDefaultScripts] = useState<{
    setup: string;
    teardown: string;
  } | null>(null);

  async function handleNewTask(projectId: string) {
    setActiveProjectId(projectId);
    setTaskModalProjectId(projectId);
    // Read from the store (not a closure) so a freshly-created project resolves.
    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    let defaults: TaskModalDefaults | null = null;
    let scripts: { setup: string; teardown: string } | null = null;
    if (project) {
      const resp = await window.electronAPI.readWorkspaceConfig(project.path);
      const config = resp.success ? resp.data : null;
      defaults = config?.taskDefaults ?? null;
      scripts = {
        setup: (config?.setup ?? []).join('\n'),
        teardown: (config?.teardown ?? []).join('\n'),
      };
    }
    setTaskModalDefaults(defaults);
    setTaskModalDefaultScripts(scripts);
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

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
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
          defaultSize={startedCollapsed.sidebar ? '3%' : '18%'}
          minSize="12%"
          maxSize="28%"
          collapsible
          collapsedSize="3%"
          onCollapse={() => {
            setSidebarCollapsed(true);
            setTimeout(() => setSidebarAnimating(false), panelEaseMs());
          }}
          onExpand={() => {
            setSidebarCollapsed(false);
            setTimeout(() => setSidebarAnimating(false), panelEaseMs());
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
            collapsed={sidebarCollapsed}
            unseenTaskIds={unseenTaskIds}
            onReorderProjects={handleReorderProjects}
            onReorderTasks={handleReorderTasks}
            onReorderTasksCommit={(projectId, reordered) => {
              void handleReorderTasksCommit(projectId, reordered);
            }}
          />
        </ResizablePanel>
        <ResizableHandle disabled={sidebarCollapsed} />

        <ResizablePanel
          id="main"
          animate={sidebarAnimating || changesAnimating}
          minSize={MAIN_MIN_PX}
        >
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
        </ResizablePanel>

        {activeTask && (
          <>
            <ResizableHandle disabled={changesPanelCollapsed} />
            <ResizablePanel
              id="changes"
              panelRef={changesPanelRef}
              animate={changesAnimating}
              defaultSize={startedCollapsed.inspector ? '0%' : '26%'}
              // Never narrower than its view tabs' labels, once measured.
              minSize={inspectorMinPx ?? `${TUI_PANEL_MIN_PCT}%`}
              maxSize={`${INSPECTOR_MAX_PCT}%`}
              collapsible
              collapsedSize="0%"
              onCollapse={() => {
                expandedAtCollapseRef.current = inspectorExpandedRef.current;
                setChangesPanelCollapsed(true);
                setTimeout(() => setChangesAnimating(false), panelEaseMs());
              }}
              onExpand={() => {
                setChangesPanelCollapsed(false);
                setTimeout(() => setChangesAnimating(false), panelEaseMs());
                // The panel comes back at the width it collapsed from, unless
                // it went narrow or expanded meanwhile, or the layout was
                // saved expanded (Dash quit with the editor shown).
                const panel = changesPanelRef.current;
                if (!panel) return;
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
              {/* Collapsed, it stays mounted out of sight (the editor's tabs
                  and unsaved edits, the terminals) and out of reach of the
                  keyboard; Monaco and xterm re-lay out once shown. */}
              {/* Held at the expanded width while it eases (`sidebarMotion`),
                  clipped here (the panel itself would scroll). */}
              <div className="h-full overflow-hidden">
                <div
                  ref={inspectorBodyRef}
                  className={cn(
                    changesPanelCollapsed ? 'hidden' : 'h-full',
                    sidebarMotion && 'w-(--held-width)',
                  )}
                  style={
                    sidebarMotion
                      ? ({ '--held-width': `${sidebarMotion.width}px` } as React.CSSProperties)
                      : undefined
                  }
                >
                  <RightInspector
                    key={activeTask.id}
                    task={activeTask}
                    modelName={headerModelName(
                      statusLineData[activeTask.id]?.model,
                      activeTask.model,
                    )}
                    rateLimits={latestRateLimits}
                    burns={burns}
                    contextUsage={contextUsage[activeTask.id]}
                    diff={inlineEditor?.target ?? null}
                    expanded={expanded}
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
                  />
                </div>
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {showAddProjectModal && (
        <NewProjectWizard
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
              defaultScripts={taskModalDefaultScripts}
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
          hasActiveSession={!!taskActivity[taskSettingsTarget.id]?.state}
          onClose={() => setTaskSettingsTarget(null)}
          onRename={(id, newName) => {
            if (!taskSettingsTarget || taskSettingsTarget.id !== id) return;
            void persistTaskUpdate(taskSettingsTarget, { name: newName });
          }}
          onPermissionModeChange={(id, mode) => {
            if (!taskSettingsTarget || taskSettingsTarget.id !== id) return;
            void persistTaskUpdate(taskSettingsTarget, { permissionMode: mode });
          }}
          onModelChange={(id, model) => {
            if (!taskSettingsTarget || taskSettingsTarget.id !== id) return;
            void persistTaskUpdate(taskSettingsTarget, { model });
          }}
          onDashAccessChange={(id, enabled, restart) => {
            if (taskSettingsTarget?.id !== id) return;
            void useProjects
              .getState()
              .setDashAccess(taskSettingsTarget, enabled, restart)
              .then((updated) => {
                if (updated) setTaskSettingsTarget((prev) => (prev?.id === id ? updated : prev));
              });
          }}
          onScriptsChange={(id, setupScript, teardownScript) => {
            void (async () => {
              const resp = await window.electronAPI.setTaskScripts({
                id,
                setupScript: setupScript.trim() ? setupScript : null,
                teardownScript: teardownScript.trim() ? teardownScript : null,
              });
              if (resp.success && resp.data) {
                setTaskSettingsTarget((prev) => (prev?.id === id ? resp.data! : prev));
                if (taskSettingsTarget) await loadTasksForProject(taskSettingsTarget.projectId);
              }
            })();
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
          elevated={!!modalEditor}
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

      {memoryProject && (
        <MemoryModal project={memoryProject} onClose={() => setMemoryProjectId(null)} />
      )}

      {modalEditor && (
        <Suspense fallback={null}>
          <DiffEditorModal
            cwd={modalEditor.target.cwd}
            initialFilePath={modalEditor.target.filePath}
            initialView={modalEditor.target.initialView}
            activeTaskId={activeTaskId}
            projectId={activeTask?.projectId ?? activeProjectId}
            terminalTheme={resolvedTerminalTheme}
            isDark={theme === 'dark'}
            onClose={() => closeEditorOf(modalEditor.target.cwd)}
          />
        </Suspense>
      )}

      {/* After every other modal, so a confirm shows over the one that asked. */}
      <ConfirmHost />
      <ToastContainer />
    </div>
  );
}
