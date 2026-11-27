import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlError, createRegistry, type Registry } from '../../registry';
import { fakeLookups, makeProject, makeTask } from '../../__tests__/fixtures';
import { registerShowCapabilities } from '../show';

// A worktree, the task's scratchpad beside it, and a folder that is neither.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-show-')));
const worktree = path.join(root, 'wt');
const scratchpad = path.join(root, 'jobs', 'tmp');
const elsewhere = path.join(root, 'elsewhere');
for (const dir of [path.join(worktree, 'docs'), scratchpad, elsewhere]) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync(path.join(worktree, 'docs', 'plan.md'), '# Plan');
fs.writeFileSync(
  path.join(worktree, 'app.ts'),
  // 30 lines, the last one ended.
  Array.from({ length: 30 }, (_, i) => `const l${i + 1} = ${i + 1};\n`).join(''),
);
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
  show: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  deps = {
    getTask: (id) => tasks.find((t) => t.id === id),
    outsideRoots: vi.fn(async () => [scratchpad]),
    show: vi.fn(() => true),
  };
  registry = createRegistry(fakeLookups([makeProject({ id: 'pA' })], tasks));
  registerShowCapabilities(registry, deps as never);
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

describe('show', () => {
  it("shows a worktree file in the calling task's editor, named repo-relative", async () => {
    const result = await registry.call(asTask('me'), 'show', {
      path: path.join(worktree, 'docs', 'plan.md'),
    });
    expect(result).toEqual({ path: 'docs/plan.md' });
    expect(deps.show).toHaveBeenCalledWith({
      taskId: 'me',
      path: 'docs/plan.md',
      lines: null,
      source: false,
    });
  });

  it('takes a path relative to the worktree', async () => {
    await registry.call(asTask('me'), 'show', { path: 'docs/plan.md' });
    expect(deps.show).toHaveBeenCalledWith(expect.objectContaining({ path: 'docs/plan.md' }));
  });

  it('points at a line or a range, and can ask for the source', async () => {
    expect(await registry.call(asTask('me'), 'show', { path: 'app.ts', lines: '10-20' })).toEqual({
      path: 'app.ts',
      lines: { start: 10, end: 20 },
    });
    await registry.call(asTask('me'), 'show', { path: 'app.ts', lines: '30' });
    expect(deps.show).toHaveBeenLastCalledWith(
      expect.objectContaining({ lines: { start: 30, end: 30 } }),
    );
    await registry.call(asTask('me'), 'show', { path: 'docs/plan.md', source: true });
    expect(deps.show).toHaveBeenLastCalledWith(expect.objectContaining({ source: true }));
  });

  it('refuses lines that are not a line or a range, or past the end of the file', async () => {
    for (const lines of ['0', '20-10', '1,2', 'ten', '-3']) {
      expect(await status(registry.call(asTask('me'), 'show', { path: 'app.ts', lines }))).toBe(
        400,
      );
    }
    expect(
      await status(registry.call(asTask('me'), 'show', { path: 'app.ts', lines: '31-40' })),
    ).toBe(400);
    expect(await status(registry.call(asTask('me'), 'show', { path: 'app.ts', lines: '31' }))).toBe(
      400,
    );
    expect(deps.show).not.toHaveBeenCalled();
  });

  it('shows a scratchpad file by its absolute path, as the editor opens one', async () => {
    const file = path.join(scratchpad, 'report.html');
    expect(await registry.call(asTask('me'), 'show', { path: file })).toEqual({ path: file });
    expect(deps.outsideRoots).toHaveBeenCalledWith(worktree);
  });

  it('refuses a file outside the worktree and its outside folders', async () => {
    for (const file of [
      path.join(elsewhere, 'secret.md'),
      path.join(worktree, '..', 'elsewhere', 'secret.md'),
      '/etc/hosts',
    ]) {
      expect(await status(registry.call(asTask('me'), 'show', { path: file }))).toBe(403);
    }
    expect(deps.show).not.toHaveBeenCalled();
  });

  it('refuses a link in an outside folder that leads out of it', async () => {
    const link = path.join(scratchpad, 'link.md');
    expect(await status(registry.call(asTask('me'), 'show', { path: link }))).toBe(403);
  });

  it('wants a file that is there, and not a folder', async () => {
    expect(await status(registry.call(asTask('me'), 'show', { path: 'docs/gone.md' }))).toBe(404);
    expect(await status(registry.call(asTask('me'), 'show', { path: 'docs' }))).toBe(400);
  });

  it('validates its input', async () => {
    expect(await status(registry.call(asTask('me'), 'show', {}))).toBe(400);
    expect(await status(registry.call(asTask('me'), 'show', { path: '' }))).toBe(400);
    expect(await status(registry.call(asTask('me'), 'show', { path: 3 }))).toBe(400);
  });

  it('is scoped: a task shows in itself and the tasks it made, never another', async () => {
    expect(
      await status(registry.call(asTask('me'), 'show', { path: 'docs/plan.md', taskId: 'child' })),
    ).toBe(200);
    expect(
      await status(
        registry.call(asTask('me'), 'show', { path: 'docs/plan.md', taskId: 'sibling' }),
      ),
    ).toBe(404);
    expect(await status(registry.call(orch, 'show', { path: 'docs/plan.md' }))).toBe(400);
  });

  it('refuses an archived task, and says so when Dash has no window', async () => {
    expect(await status(registry.call(asTask('me'), 'show', { path: 'x.md', taskId: 'old' }))).toBe(
      409,
    );
    deps.show.mockReturnValue(false);
    expect(await status(registry.call(asTask('me'), 'show', { path: 'docs/plan.md' }))).toBe(409);
  });
});
