import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PanelGroup, Panel, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { LeftSidebar } from './components/LeftSidebar';
import { MainContent } from './components/MainContent';
import { FileChangesPanel } from './components/FileChangesPanel';
import { DiffViewer } from './components/DiffViewer';
import { TaskModal } from './components/TaskModal';
import { SettingsModal } from './components/SettingsModal';
import type { Project, Task, GitStatus, DiffResult } from '../shared/types';
import { loadKeybindings, saveKeybindings, matchesBinding } from './keybindings';
import type { KeyBindingMap } from './keybindings';

const GIT_POLL_INTERVAL = 5000;

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [tasksByProject, setTasksByProject] = useState<Record<string, Task[]>>({});
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskModalProjectId, setTaskModalProjectId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [diffContextLines, setDiffContextLines] = useState<number | null>(() => {
    const stored = localStorage.getItem('diffContextLines');
    if (stored === null || stored === 'null') return null; // null = full file
    return parseInt(stored, 10) || 3;
  });
  const [keybindings, setKeybindings] = useState<KeyBindingMap>(loadKeybindings);

  // Git state
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });

  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
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
        handleOpenFolder();
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
        }
      }
      if (keybindings.focusTerminal && matchesBinding(e, keybindings.focusTerminal)) {
        e.preventDefault();
        const term = document.querySelector('.terminal-container .xterm-helper-textarea') as HTMLTextAreaElement | null;
        term?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeProjectTasks, activeTaskId, activeProjectId, showDiff, showSettings, showTaskModal, keybindings]);

  const cycleTask = useCallback(
    (direction: 1 | -1) => {
      if (activeProjectTasks.length === 0) return;
      const currentIdx = activeProjectTasks.findIndex((t) => t.id === activeTaskId);
      const nextIdx = (currentIdx + direction + activeProjectTasks.length) % activeProjectTasks.length;
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

  // ── Data Loading ─────────────────────────────────────────

  async function loadProjects() {
    const resp = await window.electronAPI.getProjects();
    if (resp.success && resp.data) {
      setProjects(resp.data);
      if (resp.data.length > 0 && !activeProjectId) {
        setActiveProjectId(resp.data[0].id);
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

  async function handleCreateTask(name: string, useWorktree: boolean, autoApprove: boolean) {
    const targetProjectId = taskModalProjectId || activeProjectId;
    const targetProject = projects.find((p) => p.id === targetProjectId);
    if (!targetProject) return;

    let worktreeInfo: { branch: string; path: string } | null = null;

    if (useWorktree) {
      const claimResp = await window.electronAPI.worktreeClaimReserve({
        projectId: targetProject.id,
        taskName: name,
      });

      if (claimResp.success && claimResp.data) {
        worktreeInfo = { branch: claimResp.data.branch, path: claimResp.data.path };
      } else {
        const createResp = await window.electronAPI.worktreeCreate({
          projectPath: targetProject.path,
          taskName: name,
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
      <div className="titlebar-drag h-[38px] flex-shrink-0 border-b border-border/40" style={{ background: 'hsl(var(--surface-1))' }} />

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
            onOpenFolder={handleOpenFolder}
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
          />
        </Panel>
        <PanelResizeHandle disabled={sidebarCollapsed} className="w-[1px] bg-border/40" />

        <Panel minSize={35}>
          <MainContent activeTask={activeTask} activeProject={activeProject} />
        </Panel>

        {activeTask && (
          <>
            <PanelResizeHandle className="w-[1px] bg-border/40" />
            <Panel defaultSize={22} minSize={15} maxSize={40}>
              <FileChangesPanel
                gitStatus={gitStatus}
                loading={gitLoading}
                onStageFile={handleStageFile}
                onUnstageFile={handleUnstageFile}
                onStageAll={handleStageAll}
                onUnstageAll={handleUnstageAll}
                onDiscardFile={handleDiscardFile}
                onViewDiff={handleViewDiff}
              />
            </Panel>
          </>
        )}
      </PanelGroup>

      {showTaskModal && (
        <TaskModal
          onClose={() => setShowTaskModal(false)}
          onCreate={handleCreateTask}
        />
      )}

      {showSettings && (
        <SettingsModal
          theme={theme}
          onThemeChange={setTheme}
          diffContextLines={diffContextLines}
          onDiffContextLinesChange={(v) => {
            setDiffContextLines(v);
            localStorage.setItem('diffContextLines', String(v));
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
