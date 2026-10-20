import { z } from 'zod';
import type { PortLiveness, Task, TaskPort } from '../../../shared/types';
import type { OpResult } from '../../services/ServiceRunner';
import { ControlError, defineCapability, type Registry } from '../registry';
import { assertNotArchived } from './tasks';

export interface ServiceCapabilityDeps {
  getTask(id: string): Task | undefined;
  getPorts(taskId: string): TaskPort[];
  /** Start, or extend, a lease on liveness probes for the ports (liveness exists
   *  only for watched tasks); it lapses on its own when nobody lists again. */
  watchLiveness(taskId: string, hostPorts: number[]): void;
  getLiveness(taskId: string): Record<number, PortLiveness>;
  runner: {
    findPort(taskId: string, label: string): TaskPort | undefined;
    status(taskId: string): Record<string, { ownedTabId: string | null }>;
    start(taskId: string, port: TaskPort): Promise<OpResult>;
    stop(taskId: string, port: TaskPort): Promise<OpResult>;
    output(taskId: string, label: string, lines: number): Promise<string | null>;
  };
  sleep(ms: number): Promise<void>;
}

/** Long enough for a first liveness probe (200 ms connect timeout) to land. */
const FIRST_PROBE_WAIT_MS = 300;

const TASK_ID_FIELD = z
  .string()
  .optional()
  .describe('The task; an agent inside a task may leave it out for its own');

export function registerServiceCapabilities(registry: Registry, deps: ServiceCapabilityDeps): void {
  /** start/stop act on the task's worktree, so an archived task is refused. */
  const activePortOrThrow = (taskId: string, label: string): TaskPort => {
    const task = deps.getTask(taskId);
    if (task) assertNotArchived(task);
    return portOrThrow(taskId, label);
  };
  const portOrThrow = (taskId: string, label: string): TaskPort => {
    const port = deps.runner.findPort(taskId, label);
    if (!port) {
      throw new ControlError(404, `no service labelled "${label}"; services_list shows the labels`);
    }
    return port;
  };

  registry.register(
    defineCapability({
      name: 'services.list',
      summary:
        "List a task's services from .dash/ports.json: label, env var, port, URL, whether something listens on it (liveness), whether it has a run command, and whether Dash runs it.",
      input: z.object({ taskId: TASK_ID_FIELD }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const taskId = input.taskId!;
        const ports = deps.getPorts(taskId);
        deps.watchLiveness(
          taskId,
          ports.map((p) => p.hostPort),
        );
        let liveness = deps.getLiveness(taskId);
        if (ports.some((p) => (liveness[p.hostPort] ?? 'unknown') === 'unknown')) {
          await deps.sleep(FIRST_PROBE_WAIT_MS);
          liveness = deps.getLiveness(taskId);
        }
        const status = deps.runner.status(taskId);
        return ports.map((p) => ({
          label: p.label,
          envVar: p.envVar,
          hostPort: p.hostPort,
          url: `http://localhost:${p.hostPort}`,
          liveness: liveness[p.hostPort] ?? 'unknown',
          hasRunCommand: !!p.runCommand,
          running: !!status[p.label]?.ownedTabId,
        }));
      },
    }),
  );

  registry.register(
    defineCapability({
      name: 'services.start',
      summary:
        "Start a task's service with its run command, in a Dash terminal tab. Returns ok, or ok: false with the reason.",
      input: z.object({ taskId: TASK_ID_FIELD, label: z.string().describe('From services_list') }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['label'] },
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) =>
        deps.runner.start(input.taskId!, activePortOrThrow(input.taskId!, input.label)),
    }),
  );

  registry.register(
    defineCapability({
      name: 'services.stop',
      summary:
        "Stop a task's service: the one Dash runs, else its stop command, else whatever listens on its port. Returns ok, or ok: false with the reason.",
      input: z.object({ taskId: TASK_ID_FIELD, label: z.string().describe('From services_list') }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['label'] },
      readOnly: false,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) =>
        deps.runner.stop(input.taskId!, activePortOrThrow(input.taskId!, input.label)),
    }),
  );

  registry.register(
    defineCapability({
      name: 'services.output',
      summary:
        "Read the last `lines` lines of a service's output as plain text. Only for a service Dash started (services_start); refused otherwise.",
      input: z.object({
        taskId: TASK_ID_FIELD,
        label: z.string().describe('From services_list'),
        lines: z.number().int().min(1).max(400).default(100),
      }),
      callers: ['orchestrator', 'task'],
      cli: { args: ['label'] },
      readOnly: true,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: async (_ctx, input) => {
        const port = portOrThrow(input.taskId!, input.label);
        const text = await deps.runner.output(input.taskId!, port.label, input.lines);
        if (text === null) throw new ControlError(404, `${port.label} is not running in Dash`);
        return { text };
      },
    }),
  );
}
