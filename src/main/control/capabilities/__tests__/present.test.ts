import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlError, createRegistry, type Registry } from '../../registry';
import { fakeLookups, makeProject, makeTask } from '../../__tests__/fixtures';
import { registerPresentCapabilities } from '../present';

// A worktree, the task's scratchpad beside it, and a folder that is neither.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-present-')));
const worktree = path.join(root, 'wt');
const scratchpad = path.join(root, 'jobs', 'tmp');
const elsewhere = path.join(root, 'elsewhere');
for (const dir of [path.join(worktree, 'docs'), scratchpad, elsewhere]) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync(path.join(worktree, 'docs', 'plan.md'), '# Plan');
fs.writeFileSync(path.join(scratchpad, 'report.html'), '<p>hi</p>');
fs.writeFileSync(path.join(elsewhere, 'secret.md'), 'no');
fs.symlinkSync(path.join(elsewhere, 'secret.md'), path.join(scratchpad, 'link.md'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const orch = { kind: 'orchestrator' } as const;
const asTask = (taskId: string) => ({ kind: 'task', taskId }) as const;
const tasks = [
  makeTask({ id: 'me', projectId: 'pA', dashAccess: true, path: worktree }),
  makeTask({ id: 'child', projectId: 'pA', parentTaskId: 'me', path: worktree }),
  makeTask({ id: 'sibling', projectId: 'pA', path: worktree }),
  makeTask({ id: 'old', projectId: 'pA', parentTaskId: 'me', archivedAt: '2026-01-03' }),
];

let registry: Registry;
let deps: {
  getTask: (id: string) => ReturnType<typeof makeTask> | undefined;
  outsideRoots: ReturnType<typeof vi.fn>;
  present: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  deps = {
    getTask: (id) => tasks.find((t) => t.id === id),
    outsideRoots: vi.fn(async () => [scratchpad]),
    present: vi.fn(() => true),
  };
  registry = createRegistry(fakeLookups([makeProject({ id: 'pA' })], tasks));
  registerPresentCapabilities(registry, deps as never);
});

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    if (err instanceof ControlError) return err.status;
    throw err;
  }
}

describe('present', () => {
  it("shows a worktree file in the calling task's editor, named repo-relative", async () => {
    const result = await registry.call(asTask('me'), 'present', {
      path: path.join(worktree, 'docs', 'plan.md'),
    });
    expect(result).toEqual({ path: 'docs/plan.md' });
    expect(deps.present).toHaveBeenCalledWith(tasks[0], 'docs/plan.md');
  });

  it('takes a path relative to the worktree', async () => {
    await registry.call(asTask('me'), 'present', { path: 'docs/plan.md' });
    expect(deps.present).toHaveBeenCalledWith(tasks[0], 'docs/plan.md');
  });

  it('shows a scratchpad file by its absolute path, as the editor opens one', async () => {
    const file = path.join(scratchpad, 'report.html');
    expect(await registry.call(asTask('me'), 'present', { path: file })).toEqual({ path: file });
    expect(deps.outsideRoots).toHaveBeenCalledWith(worktree);
  });

  it('refuses a file outside the worktree and its outside folders', async () => {
    for (const file of [
      path.join(elsewhere, 'secret.md'),
      path.join(worktree, '..', 'elsewhere', 'secret.md'),
      '/etc/hosts',
    ]) {
      expect(await status(registry.call(asTask('me'), 'present', { path: file }))).toBe(403);
    }
    expect(deps.present).not.toHaveBeenCalled();
  });

  it('refuses a link in an outside folder that leads out of it', async () => {
    const link = path.join(scratchpad, 'link.md');
    expect(await status(registry.call(asTask('me'), 'present', { path: link }))).toBe(403);
  });

  it('wants a file that is there, and not a folder', async () => {
    expect(await status(registry.call(asTask('me'), 'present', { path: 'docs/gone.md' }))).toBe(
      404,
    );
    expect(await status(registry.call(asTask('me'), 'present', { path: 'docs' }))).toBe(400);
  });

  it('validates its input', async () => {
    expect(await status(registry.call(asTask('me'), 'present', {}))).toBe(400);
    expect(await status(registry.call(asTask('me'), 'present', { path: '' }))).toBe(400);
    expect(await status(registry.call(asTask('me'), 'present', { path: 3 }))).toBe(400);
  });

  it('is scoped: a task presents in itself and the tasks it made, never another', async () => {
    expect(
      await status(
        registry.call(asTask('me'), 'present', { path: 'docs/plan.md', taskId: 'child' }),
      ),
    ).toBe(200);
    expect(
      await status(
        registry.call(asTask('me'), 'present', { path: 'docs/plan.md', taskId: 'sibling' }),
      ),
    ).toBe(404);
    expect(await status(registry.call(orch, 'present', { path: 'docs/plan.md' }))).toBe(400);
  });

  it('refuses an archived task, and says so when Dash has no window', async () => {
    expect(
      await status(registry.call(asTask('me'), 'present', { path: 'x.md', taskId: 'old' })),
    ).toBe(409);
    deps.present.mockReturnValue(false);
    expect(await status(registry.call(asTask('me'), 'present', { path: 'docs/plan.md' }))).toBe(
      409,
    );
  });
});
