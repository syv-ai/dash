import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Project } from '../../../../shared/types';
import { ControlError, createRegistry, type Registry } from '../../registry';
import { resolveArgv } from '../../cli';
import { fakeLookups, makeProject, makeTask } from '../../__tests__/fixtures';
import { registerProjectCapabilities, type ProjectCapabilityDeps } from '../projects';

const orch = { kind: 'orchestrator' } as const;

let tmp: string;
let projects: Project[];
let registry: Registry;
let deps: ProjectCapabilityDeps & {
  addProject: ReturnType<typeof vi.fn>;
  mainCheckout: ReturnType<typeof vi.fn>;
};

const dir = (...parts: string[]) => {
  const p = path.join(tmp, ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
};

async function refusal(promise: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ControlError) return { status: err.status, message: err.message };
    throw err;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-projects-add-')));
  projects = [
    makeProject({ id: 'pA', name: 'Dash', path: dir('dash') }),
    makeProject({ id: 'pOld', name: 'old', path: dir('old'), archivedAt: '2026-01-02T00:00:00Z' }),
  ];
  deps = {
    getProjects: () => projects,
    taskDefaults: () => undefined,
    detectGit: vi.fn(async () => ({
      isGitRepo: true,
      remote: 'git@github.com:o/r.git',
      branch: 'main',
    })),
    mainCheckout: vi.fn(() => null),
    addProject: vi.fn((input) => {
      const project = makeProject({ ...input, id: 'pNew' });
      projects.push(project);
      return project;
    }),
  };
  registry = createRegistry(
    fakeLookups(projects, [makeTask({ id: 'me', projectId: 'pA', dashAccess: true })]),
  );
  registerProjectCapabilities(registry, deps);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('projects.add', () => {
  it('adds a folder named after itself, with its git', async () => {
    const folder = dir('holi');
    const result = await registry.call(orch, 'projects.add', { path: folder });
    expect(deps.addProject).toHaveBeenCalledWith({
      name: 'holi',
      path: folder,
      isGitRepo: true,
      gitRemote: 'git@github.com:o/r.git',
      gitBranch: 'main',
    });
    expect(result).toEqual({
      project: {
        id: 'pNew',
        name: 'holi',
        path: folder,
        defaultBaseRef: null,
        dashAccessDefault: false,
      },
      added: true,
    });
    // It is a project now, so a second add finds it.
    expect(await registry.call(orch, 'projects.add', { path: folder })).toMatchObject({
      project: { id: 'pNew' },
      added: false,
    });
    expect(deps.addProject).toHaveBeenCalledTimes(1);
  });

  it('returns a folder that already is a project, through a symlink too', async () => {
    fs.symlinkSync(path.join(tmp, 'dash'), path.join(tmp, 'link'));
    for (const p of [
      path.join(tmp, 'dash'),
      path.join(tmp, 'dash') + '/',
      path.join(tmp, 'link'),
    ]) {
      expect(await registry.call(orch, 'projects.add', { path: p })).toEqual({
        project: expect.objectContaining({ id: 'pA', name: 'Dash' }),
        added: false,
      });
    }
    expect(deps.addProject).not.toHaveBeenCalled();
  });

  it('refuses a folder inside a project, or a worktree of one', async () => {
    const inside = await refusal(registry.call(orch, 'projects.add', { path: dir('dash', 'src') }));
    expect(inside).toEqual({
      status: 409,
      message: expect.stringContaining('inside the project "Dash" (pA)'),
    });

    const tree = dir('trees', 'fix');
    deps.mainCheckout.mockImplementation((d: string) =>
      d === tree ? path.join(tmp, 'dash') : null,
    );
    const worktree = await refusal(registry.call(orch, 'projects.add', { path: tree }));
    expect(worktree).toEqual({
      status: 409,
      message: expect.stringContaining('a worktree of the project "Dash" (pA)'),
    });
    expect(deps.addProject).not.toHaveBeenCalled();
  });

  it('refuses an archived project', async () => {
    const r = await refusal(registry.call(orch, 'projects.add', { path: path.join(tmp, 'old') }));
    expect(r).toEqual({ status: 409, message: expect.stringContaining('archived project "old"') });
  });

  it('refuses a path that is not a folder, or not absolute', async () => {
    fs.writeFileSync(path.join(tmp, 'file'), 'x');
    for (const p of [path.join(tmp, 'file'), path.join(tmp, 'missing'), 'relative/dir']) {
      expect((await refusal(registry.call(orch, 'projects.add', { path: p }))).status).toBe(400);
    }
    expect(deps.addProject).not.toHaveBeenCalled();
  });

  it('is for orchestrator callers only', async () => {
    const r = await refusal(
      registry.call({ kind: 'task', taskId: 'me' }, 'projects.add', { path: dir('holi') }),
    );
    expect(r.status).toBe(403);
  });

  it("takes the path relative to dashctl's working directory", () => {
    const commands = registry.listFor(orch);
    expect(
      resolveArgv(['projects', 'add', '../holi'], commands, null, projects, '/repos/dash'),
    ).toEqual({
      kind: 'call',
      name: 'projects.add',
      input: { path: '/repos/holi' },
    });
    expect(
      resolveArgv(['projects', 'add', '~/code/x'], commands, null, projects, '/'),
    ).toMatchObject({
      input: { path: path.join(os.homedir(), 'code/x') },
    });
  });
});
