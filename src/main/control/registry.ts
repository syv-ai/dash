import { z } from 'zod';
import type { Caller, CallerKind } from './callers';
import { scopeFor, type ScopeLookups, type ScopeView } from './scope';
import { FolderOccupiedError } from '../services/FolderOccupiedError';
import type { Project } from '../../shared/types';

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
  /** The caller's scope when the call started. */
  scope: ScopeView;
  /**
   * The caller's scope now, for a handler that outlives the moment it was
   * called (a stream): throws a 403 ControlError once the caller's access is
   * gone (the Settings switch, the task's Dash access, the task itself).
   */
  rescope(): ScopeView;
}

/**
 * A `stream` capability's way out: each `emit` is one JSON line, sent at once.
 * The response starts at the first line, so a handler can still refuse with a
 * status (throw a ControlError) before it emits anything.
 */
export interface StreamSink {
  emit(line: unknown): void;
  /** Fires when the client goes away or Dash stops: end the stream and unsubscribe. */
  signal: AbortSignal;
}

export interface Capability<I extends z.ZodType> {
  /** 'tasks.create' → `dashctl tasks create` (cli.ts) */
  name: string;
  /** What it does; its first sentence is its line in `dashctl`'s usage. */
  summary: string;
  /** No side effects: an in-task agent may call it without a permission prompt (taskAccess.ts). */
  readOnly: boolean;
  input: I;
  callers: CallerKind[];
  /**
   * Which input field names a task or project; the registry checks scope on it
   * before the handler. With both, the task is optional: absent, the project
   * is checked when given (and an untargeted call filters through ctx.scope).
   */
  target?:
    | { taskId: keyof z.infer<I> }
    | { projectId: keyof z.infer<I> }
    | { taskId: keyof z.infer<I>; projectId: keyof z.infer<I> };
  /** Task callers only: fill a missing target taskId with the caller's own id. */
  defaultTargetToSelf?: boolean;
  /** false → a task caller may not target itself (archive/delete/restart). Default true. */
  allowSelf?: boolean;
  /** How `dashctl` takes it: which inputs are positional, and which reads stdin. */
  cli?: CliSpec;
  /**
   * Answers with JSON lines through the handler's `stream` (application/x-ndjson,
   * one line per emit) until its promise settles, instead of with its result.
   */
  stream?: boolean;
  /** `stream` is only given to a `stream` capability. */
  handler(ctx: CapabilityContext, input: z.infer<I>, stream: StreamSink): Promise<unknown>;
}

/** A capability's command line (cli.ts): every other input is a `--flag`. */
export interface CliSpec {
  /** Inputs taken in order as positional arguments. */
  args?: string[];
  /** The input read from stdin when it isn't given as a flag (a prompt, a body). */
  stdin?: string;
  /** Inputs that are paths: made absolute against the caller's working directory (and `~`). */
  paths?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCapability = Capability<any>;

export interface CapabilityListing {
  name: string;
  summary: string;
  inputSchema: unknown;
  cli?: CliSpec;
  stream?: true;
}

/** Identity helper that infers `I` so `target` and `handler` are typed against the schema. */
export function defineCapability<I extends z.ZodType>(cap: Capability<I>): Capability<I> {
  return cap;
}

export interface Registry {
  register(cap: AnyCapability): void;
  listFor(caller: Caller): CapabilityListing[];
  /** `stream` is required by a `stream` capability, and ignored by the others. */
  call(caller: Caller, name: string, rawInput: unknown, stream?: StreamSink): Promise<unknown>;
  /** Names of the capabilities that declare `readOnly`. */
  readOnlyNames(): string[];
  /** The projects the caller may see. */
  projectsFor(caller: Caller): Project[];
}

/** What a capability that doesn't stream is handed (and never uses). */
const NO_STREAM: StreamSink = {
  emit() {
    throw new Error('not a stream capability');
  },
  signal: new AbortController().signal,
};

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
          ...(cap.cli ? { cli: cap.cli } : {}),
          ...(cap.stream ? { stream: true as const } : {}),
        }));
    },

    projectsFor(caller) {
      const scope = scopeOrThrow(caller, deps);
      return deps.getProjects().filter((p) => scope.visibleProjectIds.has(p.id));
    },

    readOnlyNames() {
      return [...caps.values()].filter((cap) => cap.readOnly).map((cap) => cap.name);
    },

    /**
     * Checks, in order: the caller's scope exists (a task without Dash access
     * is refused outright), the capability exists and allows this caller kind,
     * the input parses, the target exists and is in scope (404 either way, so
     * existence doesn't leak), `allowSelf`, that a `stream` capability has a
     * stream to answer on, then the handler.
     */
    async call(caller, name, rawInput, stream) {
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

      if (taskField && (input[taskField] != null || !projectField)) {
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

      if (cap.stream && !stream) {
        throw new ControlError(406, `${name} answers with a stream, which this client cannot take`);
      }

      try {
        const rescope = () => scopeOrThrow(caller, deps);
        return await cap.handler({ caller, scope, rescope }, parsed.data, stream ?? NO_STREAM);
      } catch (err) {
        if (err instanceof ControlError) throw err;
        if (err instanceof FolderOccupiedError) throw new ControlError(409, err.message);
        throw new ControlError(500, err instanceof Error ? err.message : String(err));
      }
    },
  };
}
