import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import {
  defineAddon,
  type Addon,
  type AddonContext,
  type SurfaceRef,
  type TaskInfo,
} from '@shared/addon-api';
import { buildDrawer } from './drawer';
import { detectPortsNeed, type HeuristicResult } from './PortsHeuristic';
import { buildPortsSetupPrompt } from './PortsSetupPrompt';
import { PortLivenessService } from './PortLivenessService';
import { portsOnboardingRelevant } from './relevance';
import { ServiceRunner } from './ServiceRunner';
import { next, type Setup, type SetupEvent } from './setup';
import type { TaskPort } from './types';
import { WorkspacePortsRuntime, type PortsStore } from './WorkspacePortsRuntime';

/** What the add-on needs from the machine; faked in tests. */
export interface PortsDeps {
  detectPortsNeed(worktreePath: string): Pick<HeuristicResult, 'signals' | 'guesses'>;
  /** `.dash/ports.json` exists in the worktree. */
  isConfigured(worktreePath: string): boolean;
  lsofPids(port: number): Promise<number[]>;
  killPid(pid: number): void;
  now(): number;
}

const realDeps: PortsDeps = {
  detectPortsNeed,
  isConfigured: (p) => !portsOnboardingRelevant(p),
  lsofPids,
  killPid: (pid) => {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone or not permitted */
    }
  },
  now: () => Date.now(),
};

/** How often waiting setup tasks are checked against the 30-minute limit. */
const TICK_MS = 60_000;

/**
 * Port management: gives each worktree task its own host ports from
 * `.dash/ports.json`, injects them as env vars into the task's sessions, and
 * runs the declared services as drawer terminals. Setup is offered in the
 * drawer ("Start setup"), which creates a port-setup task where Claude writes
 * the config.
 */
export function createPortsAddon(deps: PortsDeps = realDeps): Addon {
  return defineAddon({
    id: 'ports',
    name: 'Ports',
    description:
      'Gives every task its own ports and runs its services, so worktrees never collide.',
    defaultEnabled: true,
    drawerSide: 'right',

    activate(ctx) {
      const store = portsStore(ctx);
      const runtime = new WorkspacePortsRuntime(store);
      const liveness = new PortLivenessService(() => ctx.refresh());
      const runner = new ServiceRunner({
        getTaskPath: (taskId) => ctx.tasks.get(taskId)?.path,
        getPorts: (taskId) => runtime.getPortsForTask(taskId),
        portEnv: (taskId) => {
          const task = ctx.tasks.get(taskId);
          return task ? runtime.getEnvForTask(taskId, task.path) : {};
        },
        runTerminal: (taskId, opts) => ctx.terminals.run(taskId, opts),
        stopTerminal: (taskId, key) => ctx.terminals.stop(taskId, key),
        terminalRunning: (taskId, key) => ctx.terminals.isRunning(taskId, key),
        focusTerminal: (taskId, key) => ctx.terminals.focus(taskId, key),
        exec: (command, cwd) => ctx.shell.exec(command, cwd),
        lsofPids: deps.lsofPids,
        killPid: deps.killPid,
        liveness: (taskId, hostPort) => liveness.getStates(taskId)[hostPort] ?? 'unknown',
        notifyChanged: () => ctx.refresh(),
        toast: (message) => ctx.notify.toast({ kind: 'info', title: message }),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      });

      /** taskId → stop watching its `.dash/`. */
      const watches = new Map<string, () => void>();
      const heuristics = new Map<string, Pick<HeuristicResult, 'signals' | 'guesses'>>();
      /** The task whose ports are being probed (the one whose drawer is showing). */
      let probing: { taskId: string; key: string } | null = null;

      const getSetup = (taskId: string) =>
        ctx.storage.get<Setup>({ task: taskId }, 'setup') ?? null;

      const watch = (task: TaskInfo) => {
        if (watches.has(task.id) || !task.useWorktree || task.archived) return;
        watches.set(
          task.id,
          ctx.files.watch(task.id, '.dash', (files) => {
            if (files.length === 0 || files.includes('ports.json')) onConfigChange(task);
          }),
        );
      };

      /** `.dash/ports.json` appeared, changed or vanished: re-allocate and report. */
      const onConfigChange = (task: TaskInfo) => {
        const errors: string[] = [];
        let ports: TaskPort[] = [];
        try {
          ports = runtime.setupTask({ taskId: task.id, worktreePath: task.path }, errors);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
        heuristics.delete(task.path);
        if (errors.length > 0) dispatch(task.id, { type: 'configError', errors });
        else if (deps.isConfigured(task.path)) {
          dispatch(task.id, { type: 'config', count: ports.length });
        }
        ctx.refresh();
      };

      const dispatch = (taskId: string, ev: SetupEvent) => {
        const { setup, effects } = next(getSetup(taskId), ev);
        if (setup) ctx.storage.set({ task: taskId }, 'setup', setup);
        else ctx.storage.delete({ task: taskId }, 'setup');
        for (const effect of effects) {
          if (effect === 'createSetupTask') void createSetupTask(taskId);
          else if (effect === 'restartSessions') ctx.tasks.restartSessions(taskId);
          else if (effect === 'toastAllocated') {
            const task = ctx.tasks.get(taskId);
            ctx.notify.toast({
              kind: 'success',
              title: 'Ports allocated',
              body: `${task?.name ?? 'The setup task'}: restart its sessions from the Ports drawer.`,
            });
          }
        }
        ctx.refresh();
      };

      /** "Start setup": a port-setup worktree task whose agent writes .dash/ports.json. */
      const createSetupTask = async (sourceTaskId: string) => {
        const source = ctx.tasks.get(sourceTaskId);
        if (!source) return;
        try {
          const h = heuristicFor(source);
          const prompt = buildPortsSetupPrompt({
            signals: h.signals,
            guesses: h.guesses.map((g) => `${g.label} (${g.envVar} @ ${g.defaultPort})`),
          });
          const task = await ctx.tasks.create({
            projectId: source.projectId,
            name: 'port-setup',
            initialPrompt: prompt,
          });
          // Create .dash/ up front so the watcher attaches before the agent writes into it.
          fs.mkdirSync(path.join(task.path, '.dash'), { recursive: true });
          dispatch(task.id, { type: 'setupTaskBorn', now: deps.now() });
          watch(task);
          dispatch(sourceTaskId, { type: 'created', setupTaskId: task.id });
          ctx.tasks.activate(task.id);
        } catch (err) {
          dispatch(sourceTaskId, {
            type: 'createFailed',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      };

      const heuristicFor = (task: TaskInfo) => {
        let h = heuristics.get(task.path);
        if (!h) {
          h = deps.detectPortsNeed(task.path);
          heuristics.set(task.path, h);
        }
        return h;
      };

      /** Probe only the shown task's ports; re-arm when its port set changes. */
      const probe = (taskId: string, ports: TaskPort[]) => {
        const key = ports.map((p) => p.hostPort).join(',');
        if (probing?.taskId === taskId && probing.key === key) return;
        if (probing && probing.taskId !== taskId) liveness.unwatchTask(probing.taskId);
        probing = { taskId, key };
        liveness.watchTask(
          taskId,
          ports.map((p) => p.hostPort),
        );
      };

      ctx.session.env(({ path: wtPath, taskId }) =>
        taskId ? runtime.getEnvForTask(taskId, wtPath) : {},
      );

      ctx.on('taskCreated', (task) => {
        if (!task.useWorktree) return;
        runtime.setupTask({ taskId: task.id, worktreePath: task.path });
        watch(task);
      });

      ctx.on('taskDeleted', (task) => {
        runner.forgetTask(task.id);
        liveness.unwatchTask(task.id);
        if (probing?.taskId === task.id) probing = null;
        watches.get(task.id)?.();
        watches.delete(task.id);
      });

      // Setup tasks keep waiting across restarts: re-arm their watchers.
      for (const { scopeId } of ctx.storage.list<Setup>('task', 'setup')) {
        const task = ctx.tasks.get(scopeId);
        if (task) watch(task);
      }

      ctx.setInterval(() => {
        for (const { scopeId, value } of ctx.storage.list<Setup>('task', 'setup')) {
          if (value.kind === 'waiting') dispatch(scopeId, { type: 'tick', now: deps.now() });
        }
      }, TICK_MS);

      const onAction = async (ref: SurfaceRef, actionId: string) => {
        const task = ref.taskId ? ctx.tasks.get(ref.taskId) : undefined;
        if (!task) return;
        const [verb, label] = splitAction(actionId);
        const port = label
          ? runtime.getPortsForTask(task.id).find((p) => p.label === label)
          : undefined;

        switch (verb) {
          case 'start':
          case 'restart':
          case 'dismiss':
            dispatch(task.id, { type: verb as 'start' | 'restart' | 'dismiss' });
            return;
          case 'open-setup': {
            const s = getSetup(task.id);
            if (s?.kind === 'started') ctx.tasks.activate(s.setupTaskId);
            return;
          }
          case 'refresh':
            onConfigChange(task);
            return;
          case 'run-all':
            await runner.startAll(task.id);
            return;
          case 'stop-all':
            await runner.stopAll(task.id);
            return;
        }
        if (!port) return;
        if (verb === 'open') ctx.shell.openUrl(`http://localhost:${port.hostPort}`);
        else if (verb === 'run') await runner.start(task.id, port);
        else if (verb === 'stop') await runner.stop(task.id, port);
        else if (verb === 'logs') await runner.logs(task.id, port);
        ctx.refresh();
      };

      return {
        drawer(task) {
          if (!task || !task.useWorktree || task.archived) return null;
          watch(task);
          const setup = getSetup(task.id);
          const ports = runtime.getPortsForTask(task.id);
          const configured = deps.isConfigured(task.path);
          if (configured) probe(task.id, ports);
          return buildDrawer({
            configured,
            heuristic: !configured && !setup ? heuristicFor(task) : { signals: [], guesses: [] },
            setup,
            setupTaskName:
              setup?.kind === 'started' ? ctx.tasks.get(setup.setupTaskId)?.name : undefined,
            ports,
            liveness: liveness.getStates(task.id),
            owned: new Set(
              ports.filter((p) => runner.isOwned(task.id, p.label)).map((p) => p.label),
            ),
          });
        },
        onAction,
        dispose() {
          liveness.clearAll();
        },
      };
    },
  });
}

/** `run:web` → ['run', 'web']; `refresh` → ['refresh', undefined]. Labels may contain ':'. */
function splitAction(id: string): [string, string | undefined] {
  const i = id.indexOf(':');
  return i < 0 ? [id, undefined] : [id.slice(0, i), id.slice(i + 1)];
}

/** Ports kept in task-scoped add-on storage. */
function portsStore(ctx: AddonContext): PortsStore {
  return {
    get: (taskId) => ctx.storage.get<TaskPort[]>({ task: taskId }, 'ports') ?? [],
    set: (taskId, ports) => {
      if (ports.length > 0) ctx.storage.set({ task: taskId }, 'ports', ports);
      else ctx.storage.delete({ task: taskId }, 'ports');
    },
    takenHostPorts: (excludeTaskId) => {
      const taken = new Set<number>();
      for (const { scopeId, value } of ctx.storage.list<TaskPort[]>('task', 'ports')) {
        if (scopeId === excludeTaskId) continue;
        // Archived tasks give their ports back.
        const task = ctx.tasks.get(scopeId);
        if (!task || task.archived) continue;
        for (const p of value) taken.add(p.hostPort);
      }
      return taken;
    },
  };
}

/** PIDs listening on a TCP port. Exit 1 = nothing listening; ENOENT = no lsof. */
function lsofPids(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('lsof', ['-ti', `tcp:${port}`], (err, stdout) => {
      if (err) return resolve([]);
      resolve(
        stdout
          .split('\n')
          .map((l) => parseInt(l.trim(), 10))
          .filter((n) => Number.isInteger(n) && n > 0),
      );
    });
  });
}

export default createPortsAddon();
