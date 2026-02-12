import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { LeftSidebar } from './components/LeftSidebar';
import { MainContent } from './components/MainContent';
import { FileChangesPanel } from './components/FileChangesPanel';
import { DiffViewer } from './components/DiffViewer';
import { TaskModal } from './components/TaskModal';
import { AddProjectModal } from './components/AddProjectModal';
import { SettingsModal } from './components/SettingsModal';
import type { Project, Task, GitStatus, DiffResult } from '../shared/types';
import { loadKeybindings, saveKeybindings, matchesBinding } from './keybindings';
import type { KeyBindingMap } from './keybindings';
import { sessionRegistry } from './terminal/SessionRegistry';
import { playNotificationSound } from './sounds';
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
  const [taskModalProjectId, setTaskModalProjectId] = useState<string | null>(null);
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [cloneStatus, setCloneStatus] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  });
  const [showSettings, setShowSettings] = useState(false);
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
  // Sync desktop notification settings to main process
  useEffect(() => {
    window.electronAPI.setDesktopNotification?.({
      enabled: desktopNotification,
    });
  }, [desktopNotification]);

  // Activity state — keys are PTY IDs that have active sessions
  const [taskActivity, setTaskActivity] = useState<Record<string, 'busy' | 'idle'>>({});

  const notificationSoundRef = useRef(notificationSound);
  useEffect(() => {
    notificationSoundRef.current = notificationSound;
  }, [notificationSound]);

  // Git state
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });
  const [changesPanelCollapsed, setChangesPanelCollapsed] = useState(() => {
    return localStorage.getItem('changesPanelCollapsed') === 'true';
  });

  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const changesPanelRef = useRef<ImperativePanelHandle>(null);
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
    const prevActivity: Record<string, 'busy' | 'idle'> = {};
    // Track PTYs that have been idle at least once, so we skip the initial
    // busy→idle transition that fires when a direct-spawn PTY first registers.
    const hasBeenIdle = new Set<string>();

    const unsubscribe = window.electronAPI.onPtyActivity((newActivity) => {
      // Detect any busy→idle transition (only for PTYs that completed a full work cycle)
      for (const [id, state] of Object.entries(newActivity)) {
        if (prevActivity[id] === 'busy' && state === 'idle' && hasBeenIdle.has(id)) {
          playNotificationSound(notificationSoundRef.current);
          break; // one sound per update, even if multiple tasks transition
        }
      }
      // Mark PTYs that have reached idle (so the *next* busy→idle triggers)
      for (const [id, state] of Object.entries(newActivity)) {
        if (state === 'idle') hasBeenIdle.add(id);
      }
      // Clean up removed PTYs
      for (const id of hasBeenIdle) {
        if (!(id in newActivity)) hasBeenIdle.delete(id);
      }
      // Update previous state (shallow copy)
      Object.keys(prevActivity).forEach((k) => delete prevActivity[k]);
      Object.assign(prevActivity, newActivity);

      setTaskActivity(newActivity);
    });

    window.electronAPI.ptyGetAllActivity().then((resp) => {
      if (resp.success && resp.data) {
        Object.assign(prevActivity, resp.data);
        for (const [id, state] of Object.entries(resp.data)) {
          if (state === 'idle') hasBeenIdle.add(id);
        }
        setTaskActivity(resp.data);
      }
    });

    return unsubscribe;
  }, []);

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
    sessionRegistry.setAllThemes(theme === 'dark');
  }, [theme]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
        if (showDiff) {
          e.preventDefault();
          setShowDiff(false);
          setDiffResult(null);
        } else if (showSettings) {
          e.preventDefault();
          setShowSettings(false);
        } else if (showTaskModal) {
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
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activeProjectTasks,
    activeTaskId,
    activeProjectId,
    projects,
    tasksByProject,
    showDiff,
    showSettings,
    showTaskModal,
    showAddProjectModal,
    keybindings,
  ]);

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

  const toggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (sidebarCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [sidebarCollapsed]);

  const toggleChangesPanel = useCallback(() => {
    const panel = changesPanelRef.current;
    if (!panel) return;
    if (changesPanelCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, [changesPanelCollapsed]);

  // ── Data Loading ─────────────────────────────────────────

  async function loadProjects() {
    const resp = await window.electronAPI.getProjects();
    if (resp.success && resp.data) {
      setProjects(resp.data);
      if (resp.data.length > 0) {
        // Only default to first project if no valid selection exists
        setActiveProjectId((prev) => {
          if (prev && resp.data!.some((p) => p.id === prev)) return prev;
          return resp.data![0].id;
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

  async function handleOpenFolder() {
    setShowAddProjectModal(false);
    const resp = await window.electronAPI.showOpenDialog();
    if (resp.success && resp.data && resp.data.length > 0) {
      const folderPath = resp.data[0];
      const name = folderPath.split('/').pop() || 'Untitled';

      const gitResp = await window.electronAPI.detectGit(folderPath);
      const gitInfo = gitResp.success ? gitResp.data : null;

      const saveResp = await window.electronAPI.saveProject({
        name,
        path: folderPath,
        gitRemote: gitInfo?.remote ?? null,
        gitBranch: gitInfo?.branch ?? null,
      });

      if (saveResp.success && saveResp.data) {
        await loadProjects();
        setActiveProjectId(saveResp.data.id);
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
        gitRemote: gitInfo?.remote ?? null,
        gitBranch: gitInfo?.branch ?? null,
      });

      if (saveResp.success && saveResp.data) {
        await loadProjects();
        setActiveProjectId(saveResp.data.id);
      }

      setCloneStatus({ loading: false, error: null });
      setShowAddProjectModal(false);
    } catch (err) {
      setCloneStatus({ loading: false, error: String(err) });
    }
  }

  async function handleDeleteProject(id: string) {
    await window.electronAPI.deleteProject(id);
    if (activeProjectId === id) {
      setActiveProjectId(null);
      setActiveTaskId(null);
    }
    setTasksByProject((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await loadProjects();
  }

  function handleSelectTask(projectId: string, taskId: string) {
    setActiveProjectId(projectId);
    setActiveTaskId(taskId);
  }

  function handleNewTask(projectId: string) {
    setActiveProjectId(projectId);
    setTaskModalProjectId(projectId);
    setShowTaskModal(true);
  }

  async function handleCreateTask(
    name: string,
    useWorktree: boolean,
    autoApprove: boolean,
    baseRef?: string,
  ) {
    const targetProjectId = taskModalProjectId || activeProjectId;
    const targetProject = projects.find((p) => p.id === targetProjectId);
    if (!targetProject) return;

    let worktreeInfo: { branch: string; path: string } | null = null;

    if (useWorktree) {
      const claimResp = await window.electronAPI.worktreeClaimReserve({
        projectId: targetProject.id,
        taskName: name,
        baseRef,
      });

      if (claimResp.success && claimResp.data) {
        worktreeInfo = { branch: claimResp.data.branch, path: claimResp.data.path };
      } else {
        const createResp = await window.electronAPI.worktreeCreate({
          projectPath: targetProject.path,
          taskName: name,
          baseRef,
          projectId: targetProject.id,
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
    });

    if (saveResp.success && saveResp.data) {
      await window.electronAPI.getOrCreateDefaultConversation(saveResp.data.id);
      await loadTasksForProject(targetProject.id);
      setActiveProjectId(targetProject.id);
      setActiveTaskId(saveResp.data.id);

      window.electronAPI.worktreeEnsureReserve({
        projectId: targetProject.id,
        projectPath: targetProject.path,
      });
    }
  }

  async function handleDeleteTask(id: string) {
    // Find task across all projects
    let task: Task | undefined;
    let taskProjectId: string | undefined;
    for (const [projectId, tasks] of Object.entries(tasksByProject)) {
      const found = tasks.find((t) => t.id === id);
      if (found) {
        task = found;
        taskProjectId = projectId;
        break;
      }
    }

    if (task && task.useWorktree && taskProjectId) {
      const project = projects.find((p) => p.id === taskProjectId);
      if (project) {
        await window.electronAPI.worktreeRemove({
          projectPath: project.path,
          worktreePath: task.path,
          branch: task.branch,
        });
      }
    }

    await window.electronAPI.deleteTask(id);
    if (activeTaskId === id) {
      setActiveTaskId(null);
    }
    if (taskProjectId) {
      await loadTasksForProject(taskProjectId);
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
      <div
        className="titlebar-drag h-[38px] flex-shrink-0 border-b border-border/40"
        style={{ background: 'hsl(var(--surface-1))' }}
      />

      <PanelGroup direction="horizontal" className="flex-1">
        <Panel
          ref={sidebarPanelRef}
          defaultSize={sidebarCollapsed ? 3 : 18}
          minSize={12}
          maxSize={28}
          collapsible
          collapsedSize={3}
          onCollapse={() => {
            setSidebarCollapsed(true);
            localStorage.setItem('sidebarCollapsed', 'true');
          }}
          onExpand={() => {
            setSidebarCollapsed(false);
            localStorage.setItem('sidebarCollapsed', 'false');
          }}
        >
          <LeftSidebar
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={setActiveProjectId}
            onOpenFolder={() => {
              setCloneStatus({ loading: false, error: null });
              setShowAddProjectModal(true);
            }}
            onDeleteProject={handleDeleteProject}
            tasksByProject={tasksByProject}
            activeTaskId={activeTaskId}
            onSelectTask={handleSelectTask}
            onNewTask={handleNewTask}
            onDeleteTask={handleDeleteTask}
            onArchiveTask={handleArchiveTask}
            onOpenSettings={() => setShowSettings(true)}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebar}
            taskActivity={taskActivity}
          />
        </Panel>
        <PanelResizeHandle disabled={sidebarCollapsed} className="w-[1px] bg-border/40" />

        <Panel minSize={35}>
          <MainContent
            activeTask={activeTask}
            activeProject={activeProject}
            sidebarCollapsed={sidebarCollapsed}
            tasks={activeProjectTasks}
            activeTaskId={activeTaskId}
            taskActivity={taskActivity}
            onSelectTask={setActiveTaskId}
          />
        </Panel>

        {activeTask && (
          <>
            <PanelResizeHandle disabled={changesPanelCollapsed} className="w-[1px] bg-border/40" />
            <Panel
              ref={changesPanelRef}
              defaultSize={changesPanelCollapsed ? 3 : 22}
              minSize={12}
              maxSize={40}
              collapsible
              collapsedSize={3}
              onCollapse={() => {
                setChangesPanelCollapsed(true);
                localStorage.setItem('changesPanelCollapsed', 'true');
              }}
              onExpand={() => {
                setChangesPanelCollapsed(false);
                localStorage.setItem('changesPanelCollapsed', 'false');
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
              />
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
          onClose={() => setShowTaskModal(false)}
          onCreate={handleCreateTask}
        />
      )}

      {showSettings && (
        <SettingsModal
          theme={theme}
          onThemeChange={(t) => {
            setTheme(t);
            localStorage.setItem('theme', t);
            sessionRegistry.setAllThemes(t === 'dark');
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
          keybindings={keybindings}
          onKeybindingsChange={(b) => {
            setKeybindings(b);
            saveKeybindings(b);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showDiff && (
        <DiffViewer
          diff={diffResult}
          loading={diffLoading}
          onClose={() => {
            setShowDiff(false);
            setDiffResult(null);
          }}
        />
      )}
    </div>
  );
}
