import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ControlError, createRegistry, defineCapability } from '../registry';
import { fakeLookups, makeProject, makeTask } from './fixtures';

const pA = makeProject({ id: 'pA' });
const pB = makeProject({ id: 'pB' });
const me = makeTask({ id: 'me', projectId: 'pA', dashAccess: true });
const child = makeTask({ id: 'child', projectId: 'pA', parentTaskId: 'me' });
const sibling = makeTask({ id: 'sibling', projectId: 'pA' });
const noAccess = makeTask({ id: 'noaccess', projectId: 'pA' });
const tasks = [me, child, sibling, noAccess];

const orch = { kind: 'orchestrator' } as const;
const asTask = (taskId: string) => ({ kind: 'task', taskId }) as const;

function setup() {
  const registry = createRegistry(fakeLookups([pA, pB], tasks));
  const getHandler = vi.fn(async (_ctx, input: { taskId: string }) => ({ got: input.taskId }));
  registry.register(
    defineCapability({
      name: 'tasks.get',
      summary: 'Get a task',
      input: z.object({ taskId: z.string() }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      handler: getHandler,
    }),
  );
  const orchOnly = vi.fn(async () => 'ok');
  registry.register(
    defineCapability({
      name: 'projects.list',
      summary: 'List projects',
      input: z.object({}),
      callers: ['orchestrator'],
      readOnly: true,
      handler: async (ctx) => {
        await orchOnly();
        return [...ctx.scope.visibleProjectIds];
      },
    }),
  );
  const svcHandler = vi.fn(async (_ctx, input: { taskId?: string }) => input.taskId);
  registry.register(
    defineCapability({
      name: 'services.list',
      summary: 'List services',
      input: z.object({ taskId: z.string().optional() }),
      callers: ['orchestrator', 'task'],
      readOnly: true,
      target: { taskId: 'taskId' },
      defaultTargetToSelf: true,
      handler: svcHandler,
    }),
  );
  const archiveHandler = vi.fn(async () => ({}));
  registry.register(
    defineCapability({
      name: 'tasks.archive',
      summary: 'Archive a task',
      input: z.object({ taskId: z.string() }),
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { taskId: 'taskId' },
      allowSelf: false,
      handler: archiveHandler,
    }),
  );
  const createHandler = vi.fn(async () => ({}));
  registry.register(
    defineCapability({
      name: 'tasks.create',
      summary: 'Create a task',
      input: z.object({ projectId: z.string(), name: z.string().min(1) }),
      callers: ['orchestrator', 'task'],
      readOnly: false,
      target: { projectId: 'projectId' },
      handler: createHandler,
    }),
  );
  return { registry, getHandler, orchOnly, svcHandler, archiveHandler, createHandler };
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    if (err instanceof ControlError) return err.status;
    throw err;
  }
}

describe('registry.readOnlyNames', () => {
  it('lists the capabilities that declare readOnly', () => {
    const { registry } = setup();
    expect(registry.readOnlyNames().sort()).toEqual([
      'projects.list',
      'services.list',
      'tasks.get',
    ]);
  });
});

describe('registry.call', () => {
  it('refuses a caller kind the capability does not allow with 403', async () => {
    const { registry, orchOnly } = setup();
    expect(await status(registry.call(asTask('me'), 'projects.list', {}))).toBe(403);
    expect(orchOnly).not.toHaveBeenCalled();
  });

  it('404s an unknown capability', async () => {
    const { registry } = setup();
    expect(await status(registry.call(orch, 'nope.nope', {}))).toBe(404);
  });

  it('rejects bad input with 400 and does not call the handler', async () => {
    const { registry, getHandler } = setup();
    expect(await status(registry.call(orch, 'tasks.get', { taskId: 5 }))).toBe(400);
    expect(getHandler).not.toHaveBeenCalled();
  });

  it('404s an out-of-scope taskId without calling the handler', async () => {
    const { registry, getHandler } = setup();
    expect(await status(registry.call(asTask('me'), 'tasks.get', { taskId: 'sibling' }))).toBe(404);
    expect(await status(registry.call(orch, 'tasks.get', { taskId: 'ghost' }))).toBe(404);
    expect(getHandler).not.toHaveBeenCalled();
  });

  it('runs the handler for an in-scope target', async () => {
    const { registry } = setup();
    expect(await registry.call(asTask('me'), 'tasks.get', { taskId: 'child' })).toEqual({
      got: 'child',
    });
    expect(await registry.call(orch, 'tasks.get', { taskId: 'sibling' })).toEqual({
      got: 'sibling',
    });
  });

  it('refuses everything for a task without dash access', async () => {
    const { registry, getHandler } = setup();
    await expect(
      registry.call(asTask('noaccess'), 'tasks.get', { taskId: 'noaccess' }),
    ).rejects.toMatchObject({ status: 403, message: 'dash access is off for this task' });
    expect(() => registry.listFor(asTask('noaccess'))).toThrow('dash access is off for this task');
    expect(getHandler).not.toHaveBeenCalled();
  });

  it('fills a missing taskId with the calling task when defaultTargetToSelf is set', async () => {
    const { registry, svcHandler } = setup();
    expect(await registry.call(asTask('me'), 'services.list', {})).toBe('me');
    expect(svcHandler).toHaveBeenCalledTimes(1);
    // The orchestrator has no self to default to.
    expect(await status(registry.call(orch, 'services.list', {}))).toBe(400);
  });

  it('refuses a task targeting itself when allowSelf is false', async () => {
    const { registry, archiveHandler } = setup();
    expect(await status(registry.call(asTask('me'), 'tasks.archive', { taskId: 'me' }))).toBe(403);
    expect(archiveHandler).not.toHaveBeenCalled();
    await registry.call(asTask('me'), 'tasks.archive', { taskId: 'child' });
    expect(archiveHandler).toHaveBeenCalledTimes(1);
  });

  it('checks a projectId target against the scope', async () => {
    const { registry, createHandler } = setup();
    const bad = { projectId: 'pB', name: 'x' };
    expect(await status(registry.call(asTask('me'), 'tasks.create', bad))).toBe(404);
    expect(createHandler).not.toHaveBeenCalled();
    await registry.call(asTask('me'), 'tasks.create', { projectId: 'pA', name: 'x' });
    await registry.call(orch, 'tasks.create', bad);
    expect(createHandler).toHaveBeenCalledTimes(2);
  });

  it('treats an absent optional projectId as untargeted', async () => {
    const registry = createRegistry(fakeLookups([pA, pB], tasks));
    const handler = vi.fn(async (_ctx, input: { projectId?: string }) => input.projectId ?? null);
    registry.register(
      defineCapability({
        name: 'tasks.list',
        summary: 'List tasks',
        input: z.object({ projectId: z.string().optional() }),
        callers: ['orchestrator', 'task'],
        readOnly: true,
        target: { projectId: 'projectId' },
        handler,
      }),
    );
    expect(await registry.call(asTask('me'), 'tasks.list', {})).toBeNull();
    expect(await status(registry.call(asTask('me'), 'tasks.list', { projectId: 'pB' }))).toBe(404);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('hands untargeted handlers the scope view', async () => {
    const { registry } = setup();
    expect(await registry.call(orch, 'projects.list', {})).toEqual(['pA', 'pB']);
  });

  it('maps a ControlError from the handler to its status and anything else to 500', async () => {
    const registry = createRegistry(fakeLookups([pA], tasks));
    registry.register(
      defineCapability({
        name: 'a',
        summary: 'a',
        input: z.object({}),
        callers: ['orchestrator'],
        readOnly: false,
        handler: async () => {
          throw new ControlError(409, 'busy');
        },
      }),
    );
    registry.register(
      defineCapability({
        name: 'b',
        summary: 'b',
        input: z.object({}),
        callers: ['orchestrator'],
        readOnly: false,
        handler: async () => {
          throw new Error('boom');
        },
      }),
    );
    await expect(registry.call(orch, 'a', {})).rejects.toMatchObject({ status: 409 });
    await expect(registry.call(orch, 'b', {})).rejects.toMatchObject({
      status: 500,
      message: 'boom',
    });
  });
});

describe('registry.listFor', () => {
  it('lists only capabilities the caller kind may use, with JSON schemas', () => {
    const { registry } = setup();
    const forTask = registry.listFor(asTask('me')).map((c) => c.name);
    expect(forTask).not.toContain('projects.list');
    expect(forTask).toContain('tasks.get');
    const get = registry.listFor(orch).find((c) => c.name === 'tasks.get')!;
    expect(get.summary).toBe('Get a task');
    expect(get.inputSchema).toMatchObject({
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
    });
  });
});
