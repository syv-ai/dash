import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import * as pty from 'node-pty';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { createRegistry, defineCapability, type Registry } from '../registry';
import { registerProjectCapabilities } from '../capabilities/projects';
import { registerTaskCapabilities } from '../capabilities/tasks';
import { registerServiceCapabilities } from '../capabilities/services';
import { registerReviewCapabilities } from '../capabilities/review';
import { commandLine, findProject, mainCheckout, resolveArgv, resultText, usageText } from '../cli';
import { ControlServer } from '../server';
import { initTokens, setOrchestratorFile } from '../tokens';
import { controlPaths } from '../paths';
import { dashctlScript } from '../dashctl';
import { fakeLookups, makeProject, makeTask } from './fixtures';

const projects = [
  makeProject({ id: 'pA', name: 'Dash', path: '/repos/dash' }),
  makeProject({ id: 'pB', name: 'holi', path: '/repos/holi' }),
];
const orch = { kind: 'orchestrator' } as const;

/** The app's real catalog, as an orchestrator lists it. */
function catalog() {
  const r = createRegistry(fakeLookups(projects, []));
  const none = {} as never;
  registerProjectCapabilities(r, none);
  registerTaskCapabilities(r, none);
  registerServiceCapabilities(r, none);
  registerReviewCapabilities(r, none);
  return r.listFor(orch);
}

describe('dashctl argv', () => {
  const commands = catalog();
  const resolve = (argv: string[], stdin: string | null = null) =>
    resolveArgv(argv, commands, stdin, projects);

  it('prints every command on help, and as a usage error when run bare', () => {
    const r = resolve(['help']);
    expect(r.kind).toBe('help');
    const text = (r as { text: string }).text;
    expect(text).toContain('dashctl tasks create <name> --project <project> [options]');
    expect(text).toContain('dashctl review drafts-create --number <number>');
    expect(text).toContain('(body on stdin)');
    expect(text).toContain('dashctl review drafts-update <id> [options]');
    expect(text.split('\n').length).toBe(2 + commands.length * 2 + 2);
    expect(resolve(['--help'])).toEqual(r);
    expect(resolve([])).toEqual({ kind: 'usage', text });
  });

  it('takes positionals, kebab or camel flags, numbers and booleans', () => {
    expect(resolve(['tasks', 'output', 't1', '--lines', '40'])).toEqual({
      kind: 'call',
      name: 'tasks.output',
      input: { taskId: 't1', lines: 40 },
    });
    expect(resolve(['tasks', 'list', '--include-archived'])).toMatchObject({
      input: { includeArchived: true },
    });
    expect(resolve(['tasks', 'list', '--includeArchived=false'])).toMatchObject({
      input: { includeArchived: false },
    });
    expect(resolve(['review', 'drafts-delete', 'd1', '--task-id', 't1'])).toMatchObject({
      name: 'review.drafts_delete',
      input: { id: 'd1', taskId: 't1' },
    });
  });

  it('finds a project by id, name or path', () => {
    for (const ref of ['pA', 'dash', '/repos/dash/', '/repos/../repos/dash']) {
      expect(resolve(['tasks', 'list', '--project', ref])).toMatchObject({
        input: { projectId: 'pA' },
      });
    }
    expect(findProject(projects, path.join(os.homedir(), 'x'))).toBeUndefined();
    expect(resolve(['tasks', 'list', '--project', 'nope'])).toMatchObject({ kind: 'usage' });
  });

  it("resolves a relative or ~ path against the caller's cwd, not Dash's", () => {
    const home = makeProject({ id: 'pH', name: 'h', path: path.join(os.homedir(), 'code/h') });
    const all = [...projects, home];
    const list = (ref: string, cwd: string | null) =>
      resolveArgv(['tasks', 'list', '--project', ref], commands, null, all, cwd);
    expect(list('.', '/repos/holi')).toMatchObject({ input: { projectId: 'pB' } });
    expect(list('../dash', '/repos/holi')).toMatchObject({ input: { projectId: 'pA' } });
    expect(list('holi', '/repos')).toMatchObject({ input: { projectId: 'pB' } });
    expect(list('~/code/h', '/repos')).toMatchObject({ input: { projectId: 'pH' } });
    expect(list('~/code/h', null)).toMatchObject({ input: { projectId: 'pH' } });
    // No cwd (an old script): a relative path matches nothing.
    expect(list('.', null)).toMatchObject({ kind: 'usage' });
  });

  it('finds a project from a folder inside it, or a worktree of it anywhere', () => {
    const nested = [...projects, makeProject({ id: 'pN', name: 'web', path: '/repos/dash/web' })];
    const noGit = () => null;
    expect(findProject(nested, '/repos/dash/src/main', null, noGit)?.id).toBe('pA');
    // The deepest project wins.
    expect(findProject(nested, '/repos/dash/web/app', null, noGit)?.id).toBe('pN');
    const worktrees = (dir: string) => (dir.startsWith('/trees/') ? '/repos/holi' : null);
    expect(findProject(nested, '/trees/fix-login', null, worktrees)?.id).toBe('pB');
    expect(findProject(nested, '/elsewhere', null, worktrees)).toBeUndefined();
  });

  it("finds a git worktree's main checkout", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-worktree-')));
    try {
      const repo = path.join(tmp, 'repo');
      const git = (...args: string[]) => spawnSync('git', args, { cwd: repo, stdio: 'ignore' });
      fs.mkdirSync(repo);
      git('init', '-q');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');
      git('worktree', 'add', '-q', path.join(tmp, 'tree'));
      fs.mkdirSync(path.join(repo, 'sub'));
      expect(mainCheckout(path.join(tmp, 'tree'))).toBe(repo);
      expect(mainCheckout(path.join(repo, 'sub'))).toBe(repo);
      expect(mainCheckout(tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("points a task, which can't list projects, at its own projectId", () => {
    const forTask = commands.filter((c) => c.name !== 'projects.list');
    const r = resolveArgv(['tasks', 'list', '--project', 'nope'], forTask, null, projects);
    expect((r as { text: string }).text).toContain("dashctl tasks get gives your task's projectId");
  });

  it('refuses a name two projects share', () => {
    const twins = [...projects, makeProject({ id: 'pC', name: 'dash', path: '/other/dash' })];
    const r = resolveArgv(['tasks', 'list', '--project', 'Dash'], commands, null, twins);
    expect(r.kind).toBe('usage');
    expect((r as { text: string }).text).toContain('2 projects are named "Dash"');
    expect(
      resolveArgv(['tasks', 'list', '--project', '/other/dash'], commands, null, twins),
    ).toMatchObject({ input: { projectId: 'pC' } });
  });

  it('reads an optional stdin input only when given as -', () => {
    const argv = ['tasks', 'create', 'Fix it', '--project', 'holi'];
    // Never implicitly: a stdin the agent's shell holds isn't swallowed.
    expect(resolve(argv)).toEqual({
      kind: 'call',
      name: 'tasks.create',
      input: { name: 'Fix it', projectId: 'pB' },
    });
    expect(resolve(argv, 'not mine')).toMatchObject({ input: { name: 'Fix it' } });
    expect(resolve(argv, 'not mine')).not.toMatchObject({ input: { prompt: expect.anything() } });
    // `-`: asked for once, then read without its last newline.
    const dash = [...argv, '--prompt', '-'];
    expect(resolve(dash)).toEqual({ kind: 'stdin' });
    expect(resolve(dash, 'Make the test pass\nplease\n')).toEqual({
      kind: 'call',
      name: 'tasks.create',
      input: { name: 'Fix it', projectId: 'pB', prompt: 'Make the test pass\nplease' },
    });
    expect(resolve([...argv, '--prompt=-'], 'hi\n')).toMatchObject({ input: { prompt: 'hi' } });
    expect(resolve([...argv, '--prompt', 'hi'])).toMatchObject({ input: { prompt: 'hi' } });
  });

  it('reads a required stdin input when not given as a flag', () => {
    const argv = ['review', 'summary-set', '--task-id', 't1', '--number', '3'];
    expect(resolve(argv)).toEqual({ kind: 'stdin' });
    expect(resolve(argv, 'Looks good\n')).toMatchObject({ input: { body: 'Looks good' } });
    expect(resolve([...argv, '--body', 'x'])).toMatchObject({ input: { body: 'x' } });
  });

  it('says what is wrong, with the command line', () => {
    const usage = (argv: string[]) => {
      const r = resolve(argv, '');
      expect(r.kind).toBe('usage');
      return (r as { text: string }).text;
    };
    expect(usage(['tasks', 'get'])).toContain('missing --task-id');
    expect(usage(['tasks', 'get', 'a', 'b'])).toContain('unexpected argument "b"');
    expect(usage(['tasks', 'get', 'a', '--bogus', '1'])).toContain('unknown flag --bogus');
    expect(usage(['tasks', 'output', 'a', '--lines', 'many'])).toContain('takes a number');
    expect(usage(['tasks', 'output', 'a', '--lines'])).toContain('needs a value');
    expect(usage(['tasks', 'nope'])).toContain('dashctl tasks get <task-id>');
    expect(usage(['tasks', 'get'])).toContain('usage: dashctl tasks get <task-id>');
  });

  it("gives a command's flags on --help", () => {
    const r = resolve(['review', 'drafts-create', '--help']);
    expect(r.kind).toBe('help');
    const text = (r as { text: string }).text;
    expect(text).toContain('--kind note|comment');
    expect(text).toContain('(required, or stdin)');
    expect((resolve(['tasks', 'create', '-h']) as { text: string }).text).toContain(
      '(- reads stdin)',
    );
    // Even past a flag it doesn't know.
    expect(resolve(['tasks', 'get', '--bogus', '--help']).kind).toBe('help');
  });

  it("takes --help as a flag's value", () => {
    expect(
      resolve(['tasks', 'create', 'x', '--project', 'holi', '--prompt', '--help']),
    ).toMatchObject({ kind: 'call', input: { prompt: '--help' } });
  });

  it('prints text as is and anything else as compact JSON', () => {
    expect(resultText({ text: 'line 1\nline 2' })).toBe('line 1\nline 2');
    expect(resultText({ ok: true, n: 1 })).toBe('{"ok":true,"n":1}');
    expect(resultText(undefined)).toBe('null');
  });

  it('names commands after their capability', () => {
    expect(commands.map(commandLine).every((l) => /^dashctl [a-z]+ [a-z-]+/.test(l))).toBe(true);
    expect(usageText(commands)).not.toContain('_');
  });
});

describe('the dashctl script', () => {
  let userData: string;
  let server: ControlServer;
  let registry: Registry;
  let script: string;
  const hasCurl = spawnSync('curl', ['--version']).status === 0;

  beforeEach(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dashctl-'));
    initTokens(userData);
    setOrchestratorFile(true);
    // The project the script runs in, by its real path: that's what sh's $PWD is.
    const here = makeProject({ id: 'pT', name: 'here', path: fs.realpathSync(userData) });
    registry = createRegistry(
      fakeLookups([...projects, here], [makeTask({ id: 't1', projectId: 'pA' })]),
    );
    registry.register(
      defineCapability({
        name: 'notes.where',
        summary: 'Say which project.',
        input: z.object({ projectId: z.string() }),
        callers: ['orchestrator'],
        readOnly: true,
        handler: async (_ctx, input) => input,
      }),
    );
    registry.register(
      defineCapability({
        name: 'notes.write',
        summary: 'Write a note.',
        input: z.object({ title: z.string(), body: z.string(), urgent: z.boolean().optional() }),
        callers: ['orchestrator'],
        readOnly: false,
        cli: { args: ['title'], stdin: 'body' },
        handler: async (_ctx, input) => input,
      }),
    );
    registry.register(
      defineCapability({
        name: 'notes.fail',
        summary: 'Always refuses.',
        input: z.object({}),
        callers: ['orchestrator'],
        readOnly: true,
        handler: async () => {
          throw new Error('nope');
        },
      }),
    );
    server = new ControlServer({
      userDataDir: userData,
      registry,
      isOrchestratorAllowed: () => true,
      version: '9.9.9',
    });
    await server.start();
    script = path.join(userData, 'dashctl');
    fs.writeFileSync(script, dashctlScript(controlPaths(userData).dir), { mode: 0o755 });
  });

  afterEach(async () => {
    await server.stop();
    setOrchestratorFile(false);
    fs.rmSync(userData, { recursive: true, force: true });
  });

  const run = (args: string[], input?: string, extraEnv: Record<string, string> = {}) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
    if (!('DASH_CALLER' in extraEnv)) delete env.DASH_CALLER;
    if (!('DASH_TOKEN' in extraEnv)) delete env.DASH_TOKEN;
    delete env.PWD; // so sh sets it to the cwd below
    // Async: the server answering it runs in this process.
    return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(script, args, { env, cwd: userData });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d));
      child.stderr.on('data', (d: Buffer) => (stderr += d));
      child.on('close', (status: number | null) => resolve({ status, stdout, stderr }));
      child.stdin.end(input ?? '');
    });
  };

  it.runIf(hasCurl)('runs a command, with words and stdin as given', async () => {
    const r = await run(
      ['notes', 'write', 'a title with spaces & $signs', '--urgent'],
      'line 1\nline 2\n',
    );
    expect(r).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(r.stdout)).toEqual({
      title: 'a title with spaces & $signs',
      body: 'line 1\nline 2',
      urgent: true,
    });
  });

  it.runIf(hasCurl)('exits 2 on usage, 1 on a refusal, both on stderr', async () => {
    const bare = await run([]);
    expect(bare).toMatchObject({ status: 2, stdout: '' });
    expect(bare.stderr).toContain('dashctl notes write <title> (body on stdin) [options]');
    const refused = await run(['notes', 'fail']);
    expect(refused).toMatchObject({ status: 1, stdout: '' });
    expect(refused.stderr).toContain('dashctl notes fail: nope');
  });

  it.runIf(hasCurl)("prints Dash's version", async () => {
    expect(await run(['version'])).toMatchObject({ status: 0, stdout: '9.9.9\n', stderr: '' });
  });

  it.runIf(hasCurl)('prints help to stdout, exit 0', async () => {
    const help = await run(['help']);
    expect(help).toMatchObject({ status: 0, stderr: '' });
    expect(help.stdout).toContain('dashctl notes write <title> (body on stdin) [options]');
  });

  it.runIf(hasCurl)('resolves a relative --project against where it runs', async () => {
    const r = await run(['notes', 'where', '--project', '.']);
    expect(r).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(r.stdout)).toEqual({ projectId: 'pT' });
  });

  it.runIf(hasCurl)("won't trade a task's empty token for the orchestrator's", async () => {
    const r = await run(['notes', 'fail'], '', { DASH_CALLER: '', DASH_TOKEN: 'x' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('DASH_CALLER and DASH_TOKEN go together');
    expect(r.stderr).not.toContain('nope');
  });

  it.runIf(hasCurl)('says when Dash is not running: no port file, or a stale one', async () => {
    const { port } = controlPaths(userData);
    const stalePort = fs.readFileSync(port, 'utf8');
    await server.stop();
    const missing = await run(['notes', 'fail']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('Dash is not running');
    // Dash crashed: the file is still there, nothing listens on it.
    fs.writeFileSync(port, stalePort);
    const stale = await run(['notes', 'fail']);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('Dash is not running');
  });

  it.runIf(hasCurl)("doesn't wait on a terminal for stdin", async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== 'DASH_CALLER' && k !== 'DASH_TOKEN') env[k] = v;
    }
    const term = pty.spawn(script, ['notes', 'write', 'a title'], { env, cwd: userData });
    let output = '';
    term.onData((d) => (output += d));
    const exitCode = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => term.kill(), 5000);
      term.onExit(({ exitCode: code }) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    // Nothing sent for the body: a usage error, not a hang.
    expect(exitCode).toBe(2);
    expect(output).toContain('missing --body');
  });
});
