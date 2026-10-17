import { z } from 'zod';
import type { Caller, CallerKind } from './callers';
import { scopeFor, type ScopeLookups, type ScopeView } from './scope';
import { FolderOccupiedError } from '../services/FolderOccupiedError';

/** An error with the HTTP status the control server should answer with. */
export class ControlError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ControlError';
  }
}

export interface CapabilityContext {
  caller: Caller;
  scope: ScopeView;
}

export interface Capability<I extends z.ZodType> {
  /** 'tasks.create' → MCP tool 'tasks_create' (naming.ts) */
  name: string;
  /** One line; becomes the tool description. */
  summary: string;
  /** No side effects: an in-task agent may call it without a permission prompt (mcpConfig.ts). */
  readOnly: boolean;
  input: I;
  callers: CallerKind[];
  /** Which input field names a task or project; the registry checks scope on it before the handler. */
  target?: { taskId: keyof z.infer<I> } | { projectId: keyof z.infer<I> };
  /** Task callers only: fill a missing target taskId with the caller's own id. */
  defaultTargetToSelf?: boolean;
  /** false → a task caller may not target itself (archive/delete/restart). Default true. */
  allowSelf?: boolean;
  handler(ctx: CapabilityContext, input: z.infer<I>): Promise<unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCapability = Capability<any>;

export interface CapabilityListing {
  name: string;
  summary: string;
  inputSchema: unknown;
}

/** Identity helper that infers `I` so `target` and `handler` are typed against the schema. */
export function defineCapability<I extends z.ZodType>(cap: Capability<I>): Capability<I> {
  return cap;
}

export interface Registry {
  register(cap: AnyCapability): void;
  listFor(caller: Caller): CapabilityListing[];
  call(caller: Caller, name: string, rawInput: unknown): Promise<unknown>;
  /** Names of the capabilities that declare `readOnly`. */
  readOnlyNames(): string[];
}

function scopeOrThrow(caller: Caller, deps: ScopeLookups): ScopeView {
  const scope = scopeFor(caller, deps);
  if (!scope.ok) throw new ControlError(403, scope.reason);
  return scope.view;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The capability registry. Lookups are injected so tests can pass fakes; the
 * app's instance (index.ts) uses DatabaseService.
 */
export function createRegistry(deps: ScopeLookups): Registry {
  const caps = new Map<string, AnyCapability>();

  return {
    register(cap) {
      if (caps.has(cap.name)) throw new Error(`capability ${cap.name} registered twice`);
      caps.set(cap.name, cap);
    },

    listFor(caller) {
      scopeOrThrow(caller, deps);
      return [...caps.values()]
        .filter((cap) => cap.callers.includes(caller.kind))
        .map((cap) => ({
          name: cap.name,
          summary: cap.summary,
          inputSchema: z.toJSONSchema(cap.input, { io: 'input', unrepresentable: 'any' }),
        }));
    },

    readOnlyNames() {
      return [...caps.values()].filter((cap) => cap.readOnly).map((cap) => cap.name);
    },

    /**
     * Checks, in order: the caller's scope exists (a task without Dash access
     * is refused outright), the capability exists and allows this caller kind,
     * the input parses, the target exists and is in scope (404 either way, so
     * existence doesn't leak), `allowSelf`, then the handler.
     */
    async call(caller, name, rawInput) {
      const scope = scopeOrThrow(caller, deps);

      const cap = caps.get(name);
      if (!cap) throw new ControlError(404, `unknown capability ${name}`);
      if (!cap.callers.includes(caller.kind)) {
        throw new ControlError(403, `${name} is not available to ${caller.kind} callers`);
      }

      let raw: unknown = rawInput ?? {};
      const taskField =
        cap.target && 'taskId' in cap.target ? String(cap.target.taskId) : undefined;
      const projectField =
        cap.target && 'projectId' in cap.target ? String(cap.target.projectId) : undefined;
      if (
        taskField &&
        cap.defaultTargetToSelf &&
        caller.kind === 'task' &&
        isPlainObject(raw) &&
        raw[taskField] == null
      ) {
        raw = { ...raw, [taskField]: caller.taskId };
      }

      const parsed = cap.input.safeParse(raw);
      if (!parsed.success) {
        throw new ControlError(400, z.prettifyError(parsed.error), parsed.error.issues);
      }
      const input = parsed.data as Record<string, unknown>;

      if (taskField) {
        const taskId = input[taskField];
        if (typeof taskId !== 'string' || !taskId) {
          throw new ControlError(400, `${taskField} is required`);
        }
        const task = deps.getTask(taskId);
        if (!task || !scope.canSeeTask(task)) throw new ControlError(404, 'task not found');
        if (cap.allowSelf === false && caller.kind === 'task' && taskId === caller.taskId) {
          throw new ControlError(403, `a task cannot ${name} itself`);
        }
      } else if (projectField && input[projectField] != null) {
        // An absent optional projectId (tasks.list) leaves the call untargeted:
        // the handler filters through ctx.scope instead.
        const projectId = input[projectField];
        if (typeof projectId !== 'string' || !scope.visibleProjectIds.has(projectId)) {
          throw new ControlError(404, 'project not found');
        }
      }

      try {
        return await cap.handler({ caller, scope }, parsed.data);
      } catch (err) {
        if (err instanceof ControlError) throw err;
        if (err instanceof FolderOccupiedError) throw new ControlError(409, err.message);
        throw new ControlError(500, err instanceof Error ? err.message : String(err));
      }
    },
  };
}
