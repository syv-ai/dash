import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { createRegistry, defineCapability, type Registry } from '../registry';
import { registerProjectCapabilities } from '../capabilities/projects';
import { registerTaskCapabilities } from '../capabilities/tasks';
import { registerServiceCapabilities } from '../capabilities/services';
import { registerReviewCapabilities } from '../capabilities/review';
import { commandLine, findProject, resolveArgv, resultText, usageText } from '../cli';
import { ControlServer } from '../server';
import { initTokens, setOrchestratorFile } from '../tokens';
import { controlPaths } from '../paths';
import { dashctlScript } from '../launcher';
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

  it('prints every command when run bare', () => {
    const r = resolve([]);
    expect(r.kind).toBe('usage');
    const text = (r as { text: string }).text;
    expect(text).toContain(
      'dashctl tasks create <name> --project <project> (prompt on stdin) [options]',
    );
    expect(text).toContain('dashctl review drafts-update <id> [options]');
    expect(text.split('\n').length).toBe(2 + commands.length * 2 + 2);
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

  it('asks for stdin once, then reads it without its last newline', () => {
    const argv = ['tasks', 'create', 'Fix it', '--project', 'holi'];
    expect(resolve(argv)).toEqual({ kind: 'stdin' });
    expect(resolve(argv, 'Make the test pass\nplease\n')).toEqual({
      kind: 'call',
      name: 'tasks.create',
      input: { name: 'Fix it', projectId: 'pB', prompt: 'Make the test pass\nplease' },
    });
    // Optional: nothing on stdin creates a task with no prompt.
    expect(resolve(argv, '')).toMatchObject({ input: { name: 'Fix it', projectId: 'pB' } });
    // A flag wins, and stdin isn't asked for.
    expect(resolve([...argv, '--prompt', 'hi'])).toMatchObject({ input: { prompt: 'hi' } });
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
    registry = createRegistry(fakeLookups(projects, [makeTask({ id: 't1', projectId: 'pA' })]));
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

  const run = (args: string[], input?: string) => {
    const env = { ...process.env };
    delete env.DASH_CALLER;
    delete env.DASH_TOKEN;
    // Async: the server answering it runs in this process.
    return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(script, args, { env });
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
    expect(bare.status).toBe(2);
    expect(bare.stderr).toContain('dashctl notes write <title> (body on stdin) [options]');
    const refused = await run(['notes', 'fail']);
    expect(refused).toMatchObject({ status: 1, stdout: '' });
    expect(refused.stderr).toContain('dashctl notes fail: nope');
  });

  it.runIf(hasCurl)('says when Dash is not running', async () => {
    await server.stop();
    const r = await run(['notes', 'fail']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Dash is not running');
  });
});
