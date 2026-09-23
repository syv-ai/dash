import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { app, BrowserWindow, clipboard, shell, type WebContents } from 'electron';
import type { TaskInfo } from '@shared/addon-api';
import type { Task } from '@shared/types';
import { slugify } from '@shared/slug';
import { DatabaseService } from '../services/DatabaseService';
import { worktreeService } from '../services/WorktreeService';
import {
  startCommandPty,
  killPty,
  hasPty,
  setInitialPrompt,
  refreshActivePtyHooks,
} from '../services/ptyManager';
import { terminalSnapshotService } from '../services/TerminalSnapshotService';
import { initDrawerTabsService } from '../ipc/drawerTabsIpc';
import { RESERVED_ENV_KEYS } from '../services/claudeEnv';
import { stripHostTerminalEnv } from '../services/hostTerminalEnv';
import type { AddonHost, HostDeps } from './AddonHost';
import type { AddonStore } from './addonStore';
import { watchDirectory } from './fileWatch';

let sender: WebContents | null = null;

/** The window add-on events go to; set at boot and on macOS re-activate. */
export function setAddonsSender(wc: WebContents): void {
  sender = wc;
}

function send(channel: string, payload: unknown): void {
  if (sender && !sender.isDestroyed()) {
    sender.send(channel, payload);
    return;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

export function toTaskInfo(task: Task): TaskInfo {
  return {
    id: task.id,
    projectId: task.projectId,
    name: task.name,
    path: task.path,
    useWorktree: task.useWorktree,
    archived: task.archivedAt != null,
  };
}

/**
 * Drawer tab / PTY id for an add-on terminal; stable per (add-on, task, key).
 * The task id stays the second segment: the renderer reads it from there to
 * check that a service tab's PTY is still alive.
 */
export function terminalTabId(addonId: string, taskId: string, key: string): string {
  return `service:${taskId}:${addonId}:${slugify(key)}`;
}

/** Production implementation of HostDeps over Dash's core services. */
export function createHostDeps(store: AddonStore, getHost: () => AddonHost): HostDeps {
  return {
    store,
    reservedEnvKeys: RESERVED_ENV_KEYS,

    dataDir(addonId) {
      const dir = path.join(app.getPath('userData'), 'addons', addonId);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },

    tasks: {
      get(taskId) {
        const task = DatabaseService.getTask(taskId);
        return task ? toTaskInfo(task) : undefined;
      },
      list() {
        return DatabaseService.getProjects().flatMap((p) =>
          DatabaseService.getTasks(p.id).map(toTaskInfo),
        );
      },
      async create({ projectId, name, initialPrompt }) {
        const project = DatabaseService.getProjects().find((p) => p.id === projectId);
        if (!project) throw new Error(`project ${projectId} not found`);
        const wt = await worktreeService.createWorktree(project.path, name, {
          projectId,
          pushRemote: false,
        });
        const task = DatabaseService.saveTask({
          id: wt.id,
          projectId,
          name,
          branch: wt.branch,
          path: wt.path,
          useWorktree: true,
          branchCreatedByDash: true,
        });
        // Consumed as `claude --bg`'s positional prompt at the first dispatch.
        if (initialPrompt) setInitialPrompt(task.id, initialPrompt);
        const info = toTaskInfo(task);
        getHost().emit('taskCreated', info);
        send('addons:taskCreated', { taskId: task.id, projectId });
        return info;
      },
      activate(taskId) {
        const task = DatabaseService.getTask(taskId);
        if (task) send('addons:activateTask', { taskId, projectId: task.projectId });
      },
      restartSessions(taskId) {
        send('addons:restartTask', taskId);
      },
      async refreshHooks() {
        const { failures } = refreshActivePtyHooks();
        if (failures.length > 0) {
          send('addons:toast', {
            kind: 'warning',
            title: `Couldn't update hooks in ${failures.length} task${failures.length === 1 ? '' : 's'}`,
            body: failures.map((f) => f.error).join('\n'),
          });
        }
      },
    },

    terminals: {
      // Mirrors ServiceRunner.start: the PTY is spawned before the tab is added,
      // so the renderer attaches to a live process, and a re-run reuses the id.
      async run(addonId, taskId, opts) {
        const task = DatabaseService.getTask(taskId);
        if (!task) throw new Error(`task ${taskId} not found`);
        const tabId = terminalTabId(addonId, taskId, opts.key);
        if (hasPty(tabId)) killPty(tabId);
        const tabs = initDrawerTabsService();
        tabs.close(tabId);
        void terminalSnapshotService.deleteSnapshot(tabId);
        const cwd = opts.cwd
          ? path.isAbsolute(opts.cwd)
            ? opts.cwd
            : path.join(task.path, opts.cwd)
          : task.path;
        await startCommandPty({
          id: tabId,
          command: process.env.SHELL || '/bin/sh',
          args: ['-lc', opts.command],
          cwd,
          cols: 120,
          rows: 30,
          env: opts.env ?? {},
          owner: null,
          taskId,
          featureId: addonId,
          kind: 'service',
          onExit: () => opts.onExit?.(),
        });
        tabs.add(taskId, { kind: 'service', label: opts.label, featureId: addonId, id: tabId });
        // reset: the PTY was just (re)spawned under this id; the renderer must
        // re-link a cached session instead of clinging to the dead process.
        send('addons:focusTab', { taskId, tabId, reset: true });
        return { key: opts.key, tabId };
      },
      stop(addonId, taskId, key) {
        const tabId = terminalTabId(addonId, taskId, key);
        if (hasPty(tabId)) killPty(tabId);
      },
      isRunning(addonId, taskId, key) {
        return hasPty(terminalTabId(addonId, taskId, key));
      },
      focus(addonId, taskId, key, opts) {
        send('addons:focusTab', {
          taskId,
          tabId: terminalTabId(addonId, taskId, key),
          reset: opts?.reset ?? false,
        });
      },
    },

    watchDir(taskId, relDir, fn) {
      const task = DatabaseService.getTask(taskId);
      if (!task) return () => {};
      return watchDirectory(path.join(task.path, relDir), fn);
    },

    toast(t) {
      send('addons:toast', t);
    },
    openUrl(url) {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    },
    copy(text) {
      clipboard.writeText(text);
    },
    exec(command, cwd) {
      return new Promise((resolve) => {
        // A login shell sources the user's rc files, so strip the host
        // terminal's identity or it boots that terminal's shell integration.
        const child = spawn(process.env.SHELL || '/bin/sh', ['-lc', command], {
          cwd,
          env: stripHostTerminalEnv(process.env),
        });
        let stderr = '';
        child.stderr.on('data', (c) => {
          stderr = (stderr + String(c)).slice(-400);
        });
        child.on('error', (err) => resolve({ code: 127, stderrTail: String(err.message) }));
        child.on('close', (code) => resolve({ code: code ?? 1, stderrTail: stderr.trim() }));
      });
    },
    emitChanged(addonId) {
      send('addons:changed', { addonId });
    },
    notifyEnvChanged(addonId) {
      send('addons:envChanged', { addonId });
    },
    log: console,
  };
}
