import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { LeftSidebar } from './components/LeftSidebar';
import { MainContent } from './components/MainContent';
import { FileChangesPanel } from './components/FileChangesPanel';
import { ShellDrawerWrapper } from './components/ShellDrawerWrapper';
import { DiffViewer } from './components/DiffViewer';
import { CommitGraphModal } from './components/CommitGraph/CommitGraphModal';
import { TaskModal } from './components/TaskModal';
import { AddProjectModal } from './components/AddProjectModal';
import { DeleteTaskModal } from './components/DeleteTaskModal';
import { DeleteProjectModal, type DeleteProjectOptions } from './components/DeleteProjectModal';
import { RemoteControlModal } from './components/RemoteControlModal';
import { SettingsModal } from './components/SettingsModal';
import { ProjectSettingsModal } from './components/ProjectSettingsModal';
import { AdoSetupModal } from './components/AdoSetupModal';
import { RateLimitsWidget } from './components/RateLimitsWidget';
import { parseAdoRemote } from '../shared/urls';
import { ToastContainer } from './components/Toast';
import { toast } from 'sonner';
import { useStatusLine } from './hooks/useStatusLine';
import { useThresholdAlerts } from './hooks/useThresholdAlerts';
import type {
  Project,
  Task,
  GitStatus,
  DiffResult,
  LinkedGithubIssue,
  LinkedAdoWorkItem,
  RemoteControlState,
  UsageThresholds,
  ActivityInfo,
  PixelAgentsConfig,
  PixelAgentsStatus,
} from '../shared/types';
import type { CreateTaskOptions } from './components/TaskModal';
import { formatTaskContextPrompt } from '../shared/taskContext';
import { loadKeybindings, saveKeybindings, matchesBinding } from './keybindings';
import type { KeyBindingMap } from './keybindings';
import { sessionRegistry } from './terminal/SessionRegistry';
import { playNotificationSound, playPeonSound } from './sounds';
import type { NotificationSound } from './sounds';

const GIT_POLL_INTERVAL = 5000;

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    localStorage.getItem('activeProjectId'),
  );
  const [tasksByProject, setTasksByProject] = useState<Record<string, Task[]>>({});
  const [activeTaskId, setActiveTaskId] = useState<string | null>(() =>
    localStorage.getItem('activeTaskId'),
  );
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [taskModalProjectId, setTaskModalProjectId] = useState<string | null>(null);
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [cloneStatus, setCloneStatus] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  });
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<Task | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<Project | null>(null);
  const [projectSettingsTarget, setProjectSettingsTarget] = useState<Project | null>(null);
  const [adoSetup, setAdoSetup] = useState<{
    projectId: string;
    organizationUrl: string;
    project: string;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
  });
  const [diffContextLines, setDiffContextLines] = useState<number | null>(() => {
    const stored = localStorage.getItem('diffContextLines');
    if (stored === null || stored === 'null') return null; // null = full file
    return parseInt(stored, 10) || 3;
  });
  const [keybindings, setKeybindings] = useState<KeyBindingMap>(loadKeybindings);
  const [notificationSound, setNotificationSound] = useState<NotificationSound>(() => {
    return (localStorage.getItem('notificationSound') as NotificationSound) || 'off';
  });
  const [desktopNotification, setDesktopNotification] = useState(() => {
    return localStorage.getItem('desktopNotification') === 'true';
  });
  const [shellDrawerEnabled, setShellDrawerEnabled] = useState(() => {
    const stored = localStorage.getItem('shellDrawerEnabled');
    return stored === null ? true : stored === 'true';
  });
  const [shellDrawerCollapsed, setShellDrawerCollapsed] = useState(() => {
    return localStorage.getItem('shellDrawerCollapsed') === 'true';
  });
  const [shellDrawerPosition, setShellDrawerPosition] = useState<'left' | 'main' | 'right'>(() => {
    return (localStorage.getItem('shellDrawerPosition') as 'left' | 'main' | 'right') || 'right';
  });
  const [terminalTheme, setTerminalTheme] = useState(() => {
    return localStorage.getItem('terminalTheme') || 'default';
  });
  const [preferredIDE, setPreferredIDE] = useState<'cursor' | 'code' | 'auto'>(() => {
    return (localStorage.getItem('preferredIDE') as 'cursor' | 'code' | 'auto') || 'auto';
  });
  const [commitAttribution, setCommitAttribution] = useState<string | undefined>(() => {
    const stored = localStorage.getItem('commitAttribution');
    if (stored === null) return undefined; // "default" — key absent
    return stored; // '' for "none", or custom text
  });
  const [effortLevel, setEffortLevel] = useState<string>(() => {
    return localStorage.getItem('claudeEffortLevel') || 'auto';
  });
  const [syncShellEnv, setSyncShellEnv] = useState(() => {
    return localStorage.getItem('syncShellEnv') === 'true';
  });
  const [customClaudeEnvVars, setCustomClaudeEnvVars] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('customClaudeEnvVars') || '{}');
    } catch (err) {
      console.error('Failed to parse customClaudeEnvVars from localStorage, resetting:', err);
      localStorage.removeItem('customClaudeEnvVars');
      return {};
    }
  });
  // Pixel Agents state
  const [pixelAgentsConfig, setPixelAgentsConfig] = useState<PixelAgentsConfig | null>(null);
  const [pixelAgentsStatus, setPixelAgentsStatus] = useState<PixelAgentsStatus>({
    running: false,
    offices: {},
  });

  // Load pixel agents config on mount + subscribe to status changes
  useEffect(() => {
    window.electronAPI.pixelAgentsGetConfig().then((resp) => {
      if (resp.success && resp.data) setPixelAgentsConfig(resp.data);
    });
    window.electronAPI.pixelAgentsGetStatus().then((resp) => {
      if (resp.success && resp.data) setPixelAgentsStatus(resp.data);
    });
    return window.electronAPI.onPixelAgentsStatusChanged((status) => {
      setPixelAgentsStatus(status);
    });
  }, []);

  // Sync desktop notification settings to main process
  useEffect(() => {
    window.electronAPI.setDesktopNotification?.({
      enabled: desktopNotification,
    });
  }, [desktopNotification]);
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
  const [remoteControlModalPtyId, setRemoteControlModalPtyId] = useState<string | null>(null);

  // Status line data (context + cost + rate limits) — derived contextUsage & latestRateLimits
  const { statusLineData, contextUsage, latestRateLimits } = useStatusLine();

  // Usage thresholds for popup notifications
  const [usageThresholds, setUsageThresholds] = useState<UsageThresholds>(() => {
    try {
      const stored = localStorage.getItem('usageThresholds');
      return stored
        ? JSON.parse(stored)
        : {
            contextPercentage: 80,
            fiveHourPercentage: null,
            sevenDayPercentage: null,
          };
    } catch (err) {
      console.warn('Failed to parse usageThresholds from localStorage, resetting:', err);
      return {
        contextPercentage: 80,
        fiveHourPercentage: null,
        sevenDayPercentage: null,
      };
    }
  });

  const notificationSoundRef = useRef(notificationSound);
  useEffect(() => {
    notificationSoundRef.current = notificationSound;
  }, [notificationSound]);

  const [unseenTaskIds, setUnseenTaskIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('unseenTaskIds');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const activeTaskIdRef = useRef(activeTaskId);
  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);

  // Persist unseenTaskIds to localStorage
  useEffect(() => {
    localStorage.setItem('unseenTaskIds', JSON.stringify([...unseenTaskIds]));
  }, [unseenTaskIds]);

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

  // Show inline usage bars in sidebar and header
  const [showUsageInline, setShowUsageInline] = useState(
    () => localStorage.getItem('showUsageInline') !== 'false',
  );
  useEffect(() => {
    localStorage.setItem('showUsageInline', String(showUsageInline));
  }, [showUsageInline]);

  // Rotation — tasks the user cycles through with Ctrl+Tab
  const [showActiveTasksSection, setShowActiveTasksSection] = useState(
    () => localStorage.getItem('showActiveTasksSection') !== 'false',
  );
  useEffect(() => {
    localStorage.setItem('showActiveTasksSection', String(showActiveTasksSection));
  }, [showActiveTasksSection]);

  const [rotationExclusions, setRotationExclusions] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('rotationExclusions');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch (err) {
      console.warn('Failed to parse rotationExclusions from localStorage:', err);
      return new Set();
    }
  });

  useEffect(() => {
    localStorage.setItem('rotationExclusions', JSON.stringify([...rotationExclusions]));
  }, [rotationExclusions]);

  // Git state
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showCommitGraph, setShowCommitGraph] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });
  const [changesPanelCollapsed, setChangesPanelCollapsed] = useState(() => {
    return localStorage.getItem('changesPanelCollapsed') === 'true';
  });

  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const changesPanelRef = useRef<ImperativePanelHandle>(null);
  const shellDrawerPanelRef = useRef<ImperativePanelHandle>(null);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  const [changesAnimating, setChangesAnimating] = useState(false);
  const [shellDrawerAnimating, setShellDrawerAnimating] = useState(false);
  const fileWatcherCleanup = useRef<(() => void) | null>(null);
  const gitPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  // Find activeTask across all projects
  const activeTask = (() => {
    for (const tasks of Object.values(tasksByProject)) {
      const found = tasks.find((t) => t.id === activeTaskId);
      if (found) return found;
    }
    return null;
  })();

  // All non-archived tasks for the active project (for cycling)
  const activeProjectTasks = activeProjectId
    ? (tasksByProject[activeProjectId] || []).filter((t) => !t.archivedAt)
    : [];

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
    return tasks;
  }, [tasksByProject, taskActivity, rotationExclusions]);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  // Save all terminal snapshots when app is about to quit
  useEffect(() => {
    return window.electronAPI.onBeforeQuit(() => {
      sessionRegistry.saveAllSnapshots();
    });
  }, []);

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
  useThresholdAlerts(statusLineData, usageThresholds, taskNames);

  // Persist usage thresholds
  useEffect(() => {
    localStorage.setItem('usageThresholds', JSON.stringify(usageThresholds));
  }, [usageThresholds]);

  // Persist selection to localStorage (survives CMD+R reload)
  useEffect(() => {
    if (activeProjectId) localStorage.setItem('activeProjectId', activeProjectId);
    else localStorage.removeItem('activeProjectId');
  }, [activeProjectId]);

  useEffect(() => {
    if (activeTaskId) localStorage.setItem('activeTaskId', activeTaskId);
    else localStorage.removeItem('activeTaskId');
  }, [activeTaskId]);

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

  // Theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
    sessionRegistry.setAllTerminalThemes(terminalTheme, theme === 'dark');
  }, [theme, terminalTheme]);

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
        } else if (showDiff) {
          e.preventDefault();
          setShowDiff(false);
          setDiffResult(null);
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
    showDiff,
    showCommitGraph,
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
    if (!shellDrawerEnabled) return;
    const panel = shellDrawerPanelRef.current;
    if (!panel) return;
    setShellDrawerAnimating(true);
    if (shellDrawerCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [shellDrawerEnabled, shellDrawerCollapsed]);

  // ── Data Loading ─────────────────────────────────────────

  function applyProjectOrder(projectList: Project[]): Project[] {
    try {
      const saved = localStorage.getItem('projectOrder');
      if (!saved) return projectList;
      const order: string[] = JSON.parse(saved);
      const validIds = new Set(projectList.map((p) => p.id));
      const cleanOrder = order.filter((id) => validIds.has(id));
      // Prune stale IDs from storage
      if (cleanOrder.length !== order.length) {
        localStorage.setItem('projectOrder', JSON.stringify(cleanOrder));
      }
      const orderMap = new Map(cleanOrder.map((id, i) => [id, i]));
      return [...projectList].sort((a, b) => {
        const ai = orderMap.get(a.id) ?? Infinity;
        const bi = orderMap.get(b.id) ?? Infinity;
        return ai - bi;
      });
    } catch {
      return projectList;
    }
  }

  function handleReorderProjects(reordered: Project[]) {
    setProjects(reordered);
    // Only persist IDs that still exist, pruning stale entries
    localStorage.setItem('projectOrder', JSON.stringify(reordered.map((p) => p.id)));
  }

  async function loadProjects() {
    const resp = await window.electronAPI.getProjects();
    if (resp.success && resp.data) {
      // On Windows, older projects may have been saved with the full path as the name.
      // Derive the folder name from the path so the sidebar shows short names.
      const projects = resp.data.map((p) => {
        const looksLikePath = p.name.includes('\\') || p.name.includes('/');
        if (looksLikePath) {
          return { ...p, name: p.name.split(/[\\/]/).pop() || p.name };
        }
        return p;
      });
      setProjects(applyProjectOrder(projects));
      if (projects.length > 0) {
        // Only default to first project if no valid selection exists
        setActiveProjectId((prev) => {
          if (prev && projects.some((p) => p.id === prev)) return prev;
          return projects[0].id;
        });
      }
    }
  }

  async function loadTasksForProject(projectId: string) {
    const resp = await window.electronAPI.getTasks(projectId);
    if (resp.success && resp.data) {
      setTasksByProject((prev) => ({ ...prev, [projectId]: resp.data! }));
    }
  }

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

  function promptAdoSetupIfNeeded(projectId: string, remote: string | null) {
    if (!remote) return;
    const adoInfo = parseAdoRemote(remote);
    if (adoInfo) {
      setAdoSetup({
        projectId,
        organizationUrl: adoInfo.organizationUrl,
        project: adoInfo.project,
      });
    }
  }

  async function handleOpenFolder() {
    setShowAddProjectModal(false);
    const resp = await window.electronAPI.showOpenDialog();
    if (resp.success && resp.data && resp.data.length > 0) {
      const folderPath = resp.data[0];
      const name = folderPath.split(/[\\/]/).pop() || 'Untitled';

      const gitResp = await window.electronAPI.detectGit(folderPath);
      const gitInfo = gitResp.success ? gitResp.data : null;

      const saveResp = await window.electronAPI.saveProject({
        name,
        path: folderPath,
        isGitRepo: gitInfo?.isGitRepo ?? false,
        gitRemote: gitInfo?.remote ?? null,
        gitBranch: gitInfo?.branch ?? null,
      });

      if (saveResp.success && saveResp.data) {
        await loadProjects();
        setActiveProjectId(saveResp.data.id);
        promptAdoSetupIfNeeded(saveResp.data.id, gitInfo?.remote ?? null);
      }
    }
  }

  async function handleCloneRepo(url: string) {
    setCloneStatus({ loading: true, error: null });
    try {
      const cloneResp = await window.electronAPI.gitClone({ url });
      if (!cloneResp.success) {
        setCloneStatus({ loading: false, error: cloneResp.error || 'Clone failed' });
        return;
      }

      const { path: clonedPath, name } = cloneResp.data!;

      const gitResp = await window.electronAPI.detectGit(clonedPath);
      const gitInfo = gitResp.success ? gitResp.data : null;

      const saveResp = await window.electronAPI.saveProject({
        name,
        path: clonedPath,
        isGitRepo: gitInfo?.isGitRepo ?? true,
        gitRemote: gitInfo?.remote ?? null,
        gitBranch: gitInfo?.branch ?? null,
      });

      if (saveResp.success && saveResp.data) {
        await loadProjects();
        setActiveProjectId(saveResp.data.id);
        promptAdoSetupIfNeeded(saveResp.data.id, gitInfo?.remote ?? null);
      }

      setCloneStatus({ loading: false, error: null });
      setShowAddProjectModal(false);
    } catch (err) {
      setCloneStatus({ loading: false, error: String(err) });
    }
  }

  function handleDeleteProject(id: string) {
    const project = projects.find((p) => p.id === id);
    if (project) setDeleteProjectTarget(project);
  }

  async function handleDeleteProjectConfirm(options: DeleteProjectOptions) {
    const project = deleteProjectTarget;
    if (!project) return;

    const projectTasks = tasksByProject[project.id] ?? [];

    // Clean up worktrees and branches for each task
    for (const task of projectTasks) {
      if (task.useWorktree) {
        await window.electronAPI.worktreeRemove({
          projectPath: project.path,
          worktreePath: task.path,
          branch: task.branch,
          options: {
            deleteWorktreeDir: options.deleteWorktreeDirs,
            deleteLocalBranch: options.deleteLocalBranches,
            deleteRemoteBranch: options.deleteRemoteBranches && task.branchCreatedByDash,
          },
        });
      }
      sessionRegistry.dispose(`shell:${task.id}`);
      sessionRegistry.disposeByPrefix(`shell:${task.id}:`);
    }

    await window.electronAPI.deleteProject(project.id);
    if (activeProjectId === project.id) {
      setActiveProjectId(null);
      setActiveTaskId(null);
    }
    setTasksByProject((prev) => {
      const next = { ...prev };
      delete next[project.id];
      return next;
    });
    setDeleteProjectTarget(null);
    await loadProjects();
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

  async function handleCreateTask(options: CreateTaskOptions) {
    const { name, useWorktree, autoApprove, baseRef, pushRemote, linkedItems } = options;

    const targetProjectId = taskModalProjectId || activeProjectId;
    const targetProject = projects.find((p) => p.id === targetProjectId);
    if (!targetProject) return;

    setIsCreatingTask(true);
    try {
      let worktreeInfo: { branch: string; path: string } | null = null;

      // Split linked items by provider
      const ghItems =
        linkedItems?.filter((i): i is LinkedGithubIssue => i.provider === 'github') ?? [];
      const adoItems =
        linkedItems?.filter((i): i is LinkedAdoWorkItem => i.provider === 'ado') ?? [];
      const ghIssueNumbers = ghItems.map((i) => i.id);

      if (useWorktree) {
        const claimResp = await window.electronAPI.worktreeClaimReserve({
          projectId: targetProject.id,
          taskName: name,
          baseRef,
          linkedIssueNumbers: ghIssueNumbers.length > 0 ? ghIssueNumbers : undefined,
          pushRemote,
        });

        if (claimResp.success && claimResp.data) {
          worktreeInfo = { branch: claimResp.data.branch, path: claimResp.data.path };
        } else {
          const createResp = await window.electronAPI.worktreeCreate({
            projectPath: targetProject.path,
            taskName: name,
            baseRef,
            projectId: targetProject.id,
            linkedIssueNumbers: ghIssueNumbers.length > 0 ? ghIssueNumbers : undefined,
            pushRemote,
          });
          if (createResp.success && createResp.data) {
            worktreeInfo = { branch: createResp.data.branch, path: createResp.data.path };
          }
        }
      }

      const branch = worktreeInfo?.branch ?? 'main';
      const taskPath = worktreeInfo?.path ?? targetProject.path;

      const saveResp = await window.electronAPI.saveTask({
        projectId: targetProject.id,
        name,
        branch,
        path: taskPath,
        useWorktree,
        autoApprove,
        branchCreatedByDash: useWorktree && !!worktreeInfo,
        linkedItems: linkedItems ?? null,
      });

      if (saveResp.success && saveResp.data) {
        const taskId = saveResp.data.id;

        // Store task context so the SessionStart hook can inject it
        if (linkedItems && linkedItems.length > 0) {
          const prompt = formatTaskContextPrompt(linkedItems);
          if (prompt) {
            await window.electronAPI.ptyWriteTaskContext({
              taskId,
              prompt,
            });

            // Notify the user that linked context will be injected
            const maxVisible = 3;
            const visible = linkedItems.slice(0, maxVisible);
            const overflow = linkedItems.length - maxVisible;
            toast(
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Context injected</span>
                {visible.map((item) => (
                  <a
                    key={`${item.provider}-${item.id}`}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors"
                  >
                    #{item.id}
                  </a>
                ))}
                {overflow > 0 && (
                  <span className="text-[10px] text-muted-foreground">+{overflow} more</span>
                )}
              </div>,
            );
          }
        }

        await window.electronAPI.getOrCreateDefaultConversation(taskId);
        await loadTasksForProject(targetProject.id);
        setActiveProjectId(targetProject.id);
        setActiveTaskId(taskId);

        if (notificationSoundRef.current === 'peon') {
          playPeonSound('what');
        }

        window.electronAPI.worktreeEnsureReserve({
          projectId: targetProject.id,
          projectPath: targetProject.path,
        });

        // Fire-and-forget: post branch comment on each linked GitHub issue
        for (const num of ghIssueNumbers) {
          window.electronAPI
            .githubPostBranchComment(targetProject.path, num, branch)
            .catch(() => toast.error(`Failed to link branch to issue #${num}`));
        }

        // Fire-and-forget: post branch comment on each linked ADO work item
        for (const wi of adoItems) {
          window.electronAPI
            .adoPostBranchComment(wi.id, branch, targetProject.id)
            .catch(() => toast.error(`Failed to link branch to work item #${wi.id}`));
        }
      }
    } finally {
      setIsCreatingTask(false);
    }
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

  async function handleDeleteTaskConfirm(options?: {
    deleteWorktreeDir: boolean;
    deleteLocalBranch: boolean;
    deleteRemoteBranch: boolean;
  }) {
    const task = deleteTaskTarget;
    if (!task) return;

    const taskProjectId = task.projectId;

    try {
      if (task.useWorktree) {
        const project = projects.find((p) => p.id === taskProjectId);
        if (project) {
          await window.electronAPI.worktreeRemove({
            projectPath: project.path,
            worktreePath: task.path,
            branch: task.branch,
            options,
          });
        }
      }

      // Clean up all terminal sessions: Claude main session + shell tabs
      sessionRegistry.dispose(task.id);
      sessionRegistry.dispose(`shell:${task.id}`);
      sessionRegistry.disposeByPrefix(`shell:${task.id}:`);

      // Kill PTY and clear snapshot so a new task in the same cwd starts fresh
      window.electronAPI.ptyKill(task.id);
      window.electronAPI.ptyClearSnapshot(task.id);

      await window.electronAPI.deleteTask(task.id);
      if (activeTaskId === task.id) {
        setActiveTaskId(null);
      }
      await loadTasksForProject(taskProjectId);
    } finally {
      setDeleteTaskTarget(null);
    }
  }

  async function handleArchiveTask(id: string) {
    await window.electronAPI.archiveTask(id);
    // Find which project this task belongs to and reload
    for (const [projectId, tasks] of Object.entries(tasksByProject)) {
      if (tasks.some((t) => t.id === id)) {
        await loadTasksForProject(projectId);
        break;
      }
    }
  }

  async function handleRestoreTask(id: string) {
    await window.electronAPI.restoreTask(id);
    for (const [projectId, tasks] of Object.entries(tasksByProject)) {
      if (tasks.some((t) => t.id === id)) {
        await loadTasksForProject(projectId);
        break;
      }
    }
  }

  // ── Git Handlers ─────────────────────────────────────────

  async function handleStageFile(filePath: string) {
    if (!activeTask) return;
    await window.electronAPI.gitStageFile({ cwd: activeTask.path, filePath });
    refreshGitStatus(activeTask.path);
  }

  async function handleUnstageFile(filePath: string) {
    if (!activeTask) return;
    await window.electronAPI.gitUnstageFile({ cwd: activeTask.path, filePath });
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

  async function handleCommit(message: string) {
    if (!activeTask) return;
    const res = await window.electronAPI.gitCommit({ cwd: activeTask.path, message });
    if (!res.success) throw new Error(res.error || 'Commit failed');
    refreshGitStatus(activeTask.path);
  }

  async function handlePush() {
    if (!activeTask) return;
    const res = await window.electronAPI.gitPush(activeTask.path);
    if (!res.success) throw new Error(res.error || 'Push failed');
    refreshGitStatus(activeTask.path);
  }

  async function handleDiscardFile(filePath: string) {
    if (!activeTask) return;
    await window.electronAPI.gitDiscardFile({ cwd: activeTask.path, filePath });
    refreshGitStatus(activeTask.path);
  }

  async function handleViewDiff(filePath: string, staged: boolean) {
    if (!activeTask) return;
    setShowDiff(true);
    setDiffLoading(true);
    setDiffResult(null);

    try {
      const file = gitStatus?.files.find((f) => f.path === filePath && !f.staged);
      let resp;
      const ctx = diffContextLines ?? undefined;
      if (file?.status === 'untracked') {
        resp = await window.electronAPI.gitGetDiffUntracked({
          cwd: activeTask.path,
          filePath,
          contextLines: ctx,
        });
      } else {
        resp = await window.electronAPI.gitGetDiff({
          cwd: activeTask.path,
          filePath,
          staged,
          contextLines: ctx,
        });
      }
      if (resp.success && resp.data) {
        setDiffResult(resp.data);
      }
    } catch {
      // Ignore
    } finally {
      setDiffLoading(false);
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {window.electronAPI.getPlatform() === 'darwin' && (
        <div
          className="titlebar-drag h-[38px] flex-shrink-0 border-b border-border/40"
          style={{ background: 'hsl(var(--surface-1))' }}
        />
      )}

      <PanelGroup direction="horizontal" className="flex-1">
        <Panel
          ref={sidebarPanelRef}
          className={sidebarAnimating ? 'panel-transition' : ''}
          defaultSize={sidebarCollapsed ? 3 : 18}
          minSize={12}
          maxSize={28}
          collapsible
          collapsedSize={3}
          onCollapse={() => {
            setSidebarCollapsed(true);
            localStorage.setItem('sidebarCollapsed', 'true');
            setTimeout(() => setSidebarAnimating(false), 200);
          }}
          onExpand={() => {
            setSidebarCollapsed(false);
            localStorage.setItem('sidebarCollapsed', 'false');
            setTimeout(() => setSidebarAnimating(false), 200);
          }}
        >
          <ShellDrawerWrapper
            enabled={shellDrawerEnabled && shellDrawerPosition === 'left' && !sidebarCollapsed}
            taskId={activeTask?.id ?? null}
            cwd={activeTask?.path ?? null}
            collapsed={shellDrawerCollapsed}
            label={activeTask?.useWorktree ? 'Worktree' : 'Terminal'}
            panelRef={shellDrawerPanelRef}
            animating={shellDrawerAnimating}
            onAnimate={() => setShellDrawerAnimating(true)}
            onCollapse={() => {
              setShellDrawerCollapsed(true);
              localStorage.setItem('shellDrawerCollapsed', 'true');
              setTimeout(() => setShellDrawerAnimating(false), 200);
            }}
            onExpand={() => {
              setShellDrawerCollapsed(false);
              localStorage.setItem('shellDrawerCollapsed', 'false');
              setTimeout(() => setShellDrawerAnimating(false), 200);
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
              onOpenSettings={() => {
                setSettingsInitialTab(undefined);
                setShowSettings(true);
              }}
              onOpenPixelAgents={() => {
                setSettingsInitialTab('pixel-agents');
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
              contextUsage={showUsageInline ? contextUsage : {}}
              onReorderProjects={handleReorderProjects}
              pixelAgentsConnectedCount={
                Object.values(pixelAgentsStatus.offices).filter(
                  (s) => s === 'connected' || s === 'registered',
                ).length
              }
              rotationTasks={rotationTasks}
              onRemoveFromRotation={removeFromRotation}
              showActiveTasksSection={showActiveTasksSection}
              onToggleActiveTasksSection={() => setShowActiveTasksSection((v) => !v)}
            />
          </ShellDrawerWrapper>
        </Panel>
        <PanelResizeHandle disabled={sidebarCollapsed} className="w-[1px] bg-border/40" />

        <Panel
          className={sidebarAnimating || changesAnimating ? 'panel-transition' : ''}
          minSize={35}
        >
          <ShellDrawerWrapper
            enabled={shellDrawerEnabled && shellDrawerPosition === 'main'}
            taskId={activeTask?.id ?? null}
            cwd={activeTask?.path ?? null}
            collapsed={shellDrawerCollapsed}
            label={activeTask?.useWorktree ? 'Worktree' : 'Terminal'}
            panelRef={shellDrawerPanelRef}
            animating={shellDrawerAnimating}
            onAnimate={() => setShellDrawerAnimating(true)}
            onCollapse={() => {
              setShellDrawerCollapsed(true);
              localStorage.setItem('shellDrawerCollapsed', 'true');
              setTimeout(() => setShellDrawerAnimating(false), 200);
            }}
            onExpand={() => {
              setShellDrawerCollapsed(false);
              localStorage.setItem('shellDrawerCollapsed', 'false');
              setTimeout(() => setShellDrawerAnimating(false), 200);
            }}
          >
            <MainContent
              activeTask={activeTask}
              activeProject={activeProject}
              sidebarCollapsed={sidebarCollapsed}
              tasks={activeProjectTasks}
              activeTaskId={activeTaskId}
              taskActivity={taskActivity}
              unseenTaskIds={unseenTaskIds}
              remoteControlStates={remoteControlStates}
              contextUsage={showUsageInline ? contextUsage : {}}
              onSelectTask={setActiveTaskId}
              onEnableRemoteControl={(taskId) => setRemoteControlModalPtyId(taskId)}
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
              gitStatus={gitStatus}
            />
          </ShellDrawerWrapper>
        </Panel>

        {activeTask && (
          <>
            <PanelResizeHandle disabled={changesPanelCollapsed} className="w-[1px] bg-border/40" />
            <Panel
              ref={changesPanelRef}
              className={changesAnimating ? 'panel-transition' : ''}
              defaultSize={changesPanelCollapsed ? 3 : 22}
              minSize={12}
              maxSize={40}
              collapsible
              collapsedSize={3}
              onCollapse={() => {
                setChangesPanelCollapsed(true);
                localStorage.setItem('changesPanelCollapsed', 'true');
                setTimeout(() => setChangesAnimating(false), 200);
              }}
              onExpand={() => {
                setChangesPanelCollapsed(false);
                localStorage.setItem('changesPanelCollapsed', 'false');
                setTimeout(() => setChangesAnimating(false), 200);
              }}
            >
              <div className="h-full flex flex-col overflow-hidden">
                {!changesPanelCollapsed &&
                  latestRateLimits &&
                  (latestRateLimits.fiveHour || latestRateLimits.sevenDay) && (
                    <RateLimitsWidget rateLimits={latestRateLimits} />
                  )}
                <ShellDrawerWrapper
                  enabled={
                    shellDrawerEnabled && shellDrawerPosition === 'right' && !changesPanelCollapsed
                  }
                  taskId={activeTask?.id ?? null}
                  cwd={activeTask?.path ?? null}
                  collapsed={shellDrawerCollapsed}
                  panelRef={shellDrawerPanelRef}
                  animating={shellDrawerAnimating}
                  onAnimate={() => setShellDrawerAnimating(true)}
                  onCollapse={() => {
                    setShellDrawerCollapsed(true);
                    localStorage.setItem('shellDrawerCollapsed', 'true');
                    setTimeout(() => setShellDrawerAnimating(false), 200);
                  }}
                  onExpand={() => {
                    setShellDrawerCollapsed(false);
                    localStorage.setItem('shellDrawerCollapsed', 'false');
                    setTimeout(() => setShellDrawerAnimating(false), 200);
                  }}
                >
                  <FileChangesPanel
                    gitStatus={gitStatus}
                    loading={gitLoading}
                    onStageFile={handleStageFile}
                    onUnstageFile={handleUnstageFile}
                    onStageAll={handleStageAll}
                    onUnstageAll={handleUnstageAll}
                    onDiscardFile={handleDiscardFile}
                    onViewDiff={handleViewDiff}
                    onCommit={handleCommit}
                    onPush={handlePush}
                    collapsed={changesPanelCollapsed}
                    onToggleCollapse={toggleChangesPanel}
                    onShowCommitGraph={() => setShowCommitGraph(true)}
                  />
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

      {showTaskModal && (
        <TaskModal
          projectPath={
            projects.find((p) => p.id === (taskModalProjectId || activeProjectId))?.path ?? ''
          }
          projectId={taskModalProjectId || activeProjectId || undefined}
          isGitRepo={
            projects.find((p) => p.id === (taskModalProjectId || activeProjectId))?.isGitRepo ??
            false
          }
          gitRemote={
            projects.find((p) => p.id === (taskModalProjectId || activeProjectId))?.gitRemote ??
            null
          }
          onClose={() => setShowTaskModal(false)}
          onCreate={handleCreateTask}
          onGitInit={() => {
            const pid = taskModalProjectId || activeProjectId;
            const proj = projects.find((p) => p.id === pid);
            if (proj) {
              window.electronAPI.detectGit(proj.path).then(async (gitResp) => {
                const gitInfo = gitResp.success ? gitResp.data : null;
                await window.electronAPI.saveProject({
                  ...proj,
                  isGitRepo: gitInfo?.isGitRepo ?? true,
                  gitRemote: gitInfo?.remote ?? null,
                  gitBranch: gitInfo?.branch ?? null,
                });
                loadProjects();
              });
            }
          }}
        />
      )}

      {adoSetup && (
        <AdoSetupModal
          projectId={adoSetup.projectId}
          organizationUrl={adoSetup.organizationUrl}
          project={adoSetup.project}
          onClose={() => setAdoSetup(null)}
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
          onWorktreeSetupScriptChange={async (id, script) => {
            const proj = projects.find((p) => p.id === id);
            if (!proj) return;
            await window.electronAPI.saveProject({ ...proj, worktreeSetupScript: script });
            await loadProjects();
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          initialTab={settingsInitialTab}
          theme={theme}
          onThemeChange={(t) => {
            setTheme(t);
            localStorage.setItem('theme', t);
            sessionRegistry.setAllTerminalThemes(terminalTheme, t === 'dark');
          }}
          showUsageInline={showUsageInline}
          onShowUsageInlineChange={setShowUsageInline}
          showActiveTasksSection={showActiveTasksSection}
          onShowActiveTasksSectionChange={setShowActiveTasksSection}
          shellDrawerEnabled={shellDrawerEnabled}
          onShellDrawerEnabledChange={(v) => {
            setShellDrawerEnabled(v);
            localStorage.setItem('shellDrawerEnabled', String(v));
          }}
          shellDrawerPosition={shellDrawerPosition}
          onShellDrawerPositionChange={(v) => {
            setShellDrawerPosition(v);
            localStorage.setItem('shellDrawerPosition', v);
          }}
          terminalTheme={terminalTheme}
          onTerminalThemeChange={(id) => {
            setTerminalTheme(id);
            localStorage.setItem('terminalTheme', id);
            sessionRegistry.setAllTerminalThemes(id, theme === 'dark');
          }}
          diffContextLines={diffContextLines}
          onDiffContextLinesChange={(v) => {
            setDiffContextLines(v);
            localStorage.setItem('diffContextLines', String(v));
          }}
          notificationSound={notificationSound}
          onNotificationSoundChange={(v) => {
            setNotificationSound(v);
            localStorage.setItem('notificationSound', v);
            if (v !== 'off') playNotificationSound(v);
          }}
          desktopNotification={desktopNotification}
          onDesktopNotificationChange={(v) => {
            setDesktopNotification(v);
            localStorage.setItem('desktopNotification', String(v));
          }}
          activeProjectPath={activeProject?.path}
          preferredIDE={preferredIDE}
          onPreferredIDEChange={(v) => {
            setPreferredIDE(v);
            if (v === 'auto') {
              localStorage.removeItem('preferredIDE');
            } else {
              localStorage.setItem('preferredIDE', v);
            }
          }}
          commitAttribution={commitAttribution}
          onCommitAttributionChange={(v) => {
            setCommitAttribution(v);
            if (v === undefined) {
              localStorage.removeItem('commitAttribution');
            } else {
              localStorage.setItem('commitAttribution', v);
            }
          }}
          effortLevel={effortLevel}
          onEffortLevelChange={(v) => {
            setEffortLevel(v);
            if (v === 'auto') {
              localStorage.removeItem('claudeEffortLevel');
            } else {
              localStorage.setItem('claudeEffortLevel', v);
            }
          }}
          syncShellEnv={syncShellEnv}
          onSyncShellEnvChange={(v) => {
            setSyncShellEnv(v);
            localStorage.setItem('syncShellEnv', String(v));
          }}
          customClaudeEnvVars={customClaudeEnvVars}
          onCustomClaudeEnvVarsChange={(v) => {
            setCustomClaudeEnvVars(v);
            localStorage.setItem('customClaudeEnvVars', JSON.stringify(v));
          }}
          keybindings={keybindings}
          onKeybindingsChange={(b) => {
            setKeybindings(b);
            saveKeybindings(b);
          }}
          pixelAgentsConfig={pixelAgentsConfig}
          onPixelAgentsConfigChange={(config) => {
            setPixelAgentsConfig(config);
            window.electronAPI.pixelAgentsSaveConfig(config);
          }}
          pixelAgentsStatus={pixelAgentsStatus}
          statusLineData={statusLineData}
          taskNames={taskNames}
          latestRateLimits={latestRateLimits}
          usageThresholds={usageThresholds}
          onUsageThresholdsChange={setUsageThresholds}
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

      {showDiff && (
        <DiffViewer
          diff={diffResult}
          loading={diffLoading}
          activeTaskId={activeTaskId}
          onClose={() => {
            setShowDiff(false);
            setDiffResult(null);
          }}
        />
      )}

      <ToastContainer />
    </div>
  );
}
