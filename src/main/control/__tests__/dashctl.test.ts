import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile, execFileSync, spawn } from 'child_process';
import { z } from 'zod';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeDashctl } from '../dashctl';
import { controlPaths } from '../paths';
import { initTokens, tokenFor, verify } from '../tokens';
import { dashSessionAccess, setReadOnlyCapabilities } from '../taskAccess';
import { ControlServer } from '../server';
import { ControlError, createRegistry, defineCapability, type StreamSink } from '../registry';
import { fakeLookups, makeProject, makeTask } from './fixtures';

let userData: string;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dash control-'));
});
afterEach(() => fs.rmSync(userData, { recursive: true, force: true }));

describe('writeDashctl', () => {
  it('writes an executable dashctl alone in its folder, for a PATH', () => {
    const paths = controlPaths(userData);
    expect(writeDashctl(userData)).toBe(paths.dashctl);
    expect(fs.readdirSync(paths.cliBinDir)).toEqual(['dashctl']);
    expect(fs.statSync(paths.dashctl).mode & 0o777).toBe(0o755);
    expect(fs.readFileSync(paths.dashctl, 'utf8').startsWith('#!/bin/sh\n')).toBe(true);
  });
});

describe('dashSessionAccess', () => {
  it('is nothing without Dash access', () => {
    initTokens(userData);
    expect(dashSessionAccess({ id: 't1', dashAccess: false })).toBeNull();
  });

  it("gives the task's caller and token, and allows the read-only commands", () => {
    initTokens(userData);
    setReadOnlyCapabilities(['tasks.list', 'review.drafts_list']);
    const access = dashSessionAccess({ id: 't1', dashAccess: true })!;
    expect(access.env).toEqual({
      DASH_CALLER: 'task:t1',
      DASH_TOKEN: tokenFor({ kind: 'task', taskId: 't1' }),
    });
    expect(verify(access.env.DASH_TOKEN!, { kind: 'task', taskId: 't1' })).toBe(true);
    const { dashctl } = controlPaths(userData);
    // By name, and by the quoted path the dash skill gives as a fallback.
    expect(access.allow).toEqual([
      'Bash(dashctl tasks list:*)',
      'Bash(dashctl review drafts-list:*)',
      `Bash("${dashctl}" tasks list:*)`,
      `Bash("${dashctl}" review drafts-list:*)`,
    ]);
    expect(access.dashctl).toBe(dashctl);
  });

  it("puts dashctl's folder on PATH through CLAUDE_ENV_FILE, spaces and all", () => {
    initTokens(userData);
    writeDashctl(userData);
    const [hook] = dashSessionAccess({ id: 't1', dashAccess: true })!.sessionStart;
    const envFile = path.join(userData, 'env.sh');
    // A resume runs it again into the same file: one line, not two.
    for (let i = 0; i < 2; i++) {
      execFileSync('sh', ['-c', hook!.command], {
        env: { ...process.env, CLAUDE_ENV_FILE: envFile },
      });
    }
    expect(fs.readFileSync(envFile, 'utf8').trimEnd().split('\n')).toHaveLength(1);
    // What Claude Code does before each Bash command: run the file, then the command.
    const found = execFileSync('sh', ['-c', `. "${envFile}"; command -v dashctl`], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin' },
    });
    expect(found.trim()).toBe(controlPaths(userData).dashctl);
    // No CLAUDE_ENV_FILE: a no-op that still succeeds.
    expect(() =>
      execFileSync('sh', ['-c', hook!.command], { env: { PATH: '/usr/bin:/bin' } }),
    ).not.toThrow();
  });
});

describe('the dashctl script, against a running Dash', () => {
  const taskId = 't1';
  let server: ControlServer;
  let feed: StreamSink | null;
  let endFeed: (err?: Error) => void;

  beforeEach(async () => {
    initTokens(userData);
    const registry = createRegistry(
      fakeLookups(
        [makeProject({ id: 'pA' })],
        [makeTask({ id: taskId, projectId: 'pA', dashAccess: true })],
      ),
    );
    registry.register(
      defineCapability({
        name: 'feed.say',
        summary: 'Say it back',
        input: z.object({ text: z.string(), fail: z.boolean().optional() }),
        callers: ['task'],
        readOnly: true,
        cli: { args: ['text'], stdin: 'text' },
        handler: async (_ctx, input) => {
          if (input.fail) throw new ControlError(409, 'not today');
          return { text: input.text };
        },
      }),
    );
    registry.register(
      defineCapability({
        name: 'feed.follow',
        summary: 'Stream lines until ended',
        input: z.object({}),
        callers: ['task'],
        readOnly: true,
        stream: true,
        handler: async (_ctx, _input, stream) => {
          feed = stream;
          stream.emit({ n: 0 });
          await new Promise<void>(
            (resolve, reject) => (endFeed = (err) => (err ? reject(err) : resolve())),
          );
        },
      }),
    );
    feed = null;
    server = new ControlServer({
      userDataDir: userData,
      registry,
      isOrchestratorAllowed: () => false,
      requestOrchestratorAccess: async () => false,
      version: '0.0.0-test',
      packaged: true,
    });
    await server.start();
    writeDashctl(userData);
  });
  afterEach(() => server.stop());

  const env = () => ({
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    DASH_CONTROL_DIR: controlPaths(userData).dir,
    DASH_CALLER: `task:${taskId}`,
    DASH_TOKEN: tokenFor({ kind: 'task', taskId }),
  });
  const run = (...argv: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(controlPaths(userData).dashctl, argv, { env: env() }, (err, stdout, stderr) =>
        resolve({ code: err ? Number(err.code) : 0, stdout, stderr }),
      );
    });

  it('prints an answer to stdout, usage to stderr (exit 2) and a refusal to stderr (exit 1)', async () => {
    expect(await run('feed', 'say', 'hi')).toEqual({ code: 0, stdout: 'hi\n', stderr: '' });
    expect(await run('feed', 'say', 'hi', '--bogus')).toMatchObject({
      code: 2,
      stdout: '',
      stderr: expect.stringMatching(/^dashctl feed say: unknown flag --bogus/),
    });
    expect(await run('feed', 'say', 'hi', '--fail')).toEqual({
      code: 1,
      stdout: '',
      stderr: 'dashctl feed say: not today\n',
    });
  });

  it('sends stdin when Dash asks for it', async () => {
    const child = spawn(controlPaths(userData).dashctl, ['feed', 'say'], { env: env() });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stdin.end('from stdin\n');
    expect(await new Promise((resolve) => child.on('exit', resolve))).toBe(0);
    expect(stdout).toBe('from stdin\n');
  });

  it("ends Dash's stream when the script is killed", async () => {
    const child = spawn(controlPaths(userData).dashctl, ['feed', 'follow'], { env: env() });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    await vi.waitFor(() => expect(stdout).toBe('{"n":0}\n'));
    let aborted = false;
    feed!.signal.addEventListener('abort', () => (aborted = true));
    const exited = new Promise((resolve) => child.on('exit', resolve));
    child.kill('SIGTERM');
    expect(await exited).toBe(143);
    await vi.waitFor(() => expect(aborted).toBe(true));
  });

  it('prints a stream line by line as it comes, and exits 0 when it ends', async () => {
    const child = spawn(controlPaths(userData).dashctl, ['feed', 'follow'], { env: env() });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    await vi.waitFor(() => expect(stdout).toBe('{"n":0}\n'));
    feed!.emit({ n: 1 });
    await vi.waitFor(() => expect(stdout).toBe('{"n":0}\n{"n":1}\n'));
    endFeed();
    expect(await exited).toBe(0);
    expect(stdout).toBe('{"n":0}\n{"n":1}\n');
  });

  /** Start `feed follow`, wait for its first line; its output and exit as they come. */
  async function follow() {
    const child = spawn(controlPaths(userData).dashctl, ['feed', 'follow'], { env: env() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    await vi.waitFor(() => expect(stdout).toBe('{"n":0}\n'));
    return { exited, out: () => ({ stdout, stderr }) };
  }

  it('exits 1 when a stream ends on an error line', async () => {
    const f = await follow();
    endFeed(new ControlError(403, 'access was turned off'));
    expect(await f.exited).toBe(1);
    expect(f.out().stdout).toBe(
      '{"n":0}\n{"error":"dashctl feed follow: access was turned off"}\n',
    );
  });

  it('exits 1, saying so, when Dash stops mid-stream', async () => {
    const f = await follow();
    await server.stop();
    expect(await f.exited).toBe(1);
    expect(f.out()).toEqual({
      stdout: '{"n":0}\n',
      stderr: 'dashctl: the stream ended: Dash stopped\n',
    });
  });
});

describe('the dashctl script, against an answer cut off', () => {
  it('exits 1 and prints none of it', async () => {
    const net = await import('net');
    const server = net.createServer((socket) => {
      socket.once('data', () => {
        socket.write(
          'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 100\r\n\r\npartial',
        );
        setTimeout(() => socket.destroy(), 50);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const paths = controlPaths(userData);
    writeDashctl(userData);
    fs.writeFileSync(paths.port, String((server.address() as { port: number }).port));
    const res = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) =>
      execFile(
        paths.dashctl,
        ['tasks', 'list'],
        {
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            DASH_CONTROL_DIR: paths.dir,
            DASH_CALLER: 'task:t1',
            DASH_TOKEN: 'x',
          },
        },
        (err, stdout, stderr) => resolve({ code: err ? Number(err.code) : 0, stdout, stderr }),
      ),
    );
    server.close();
    expect(res.code).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toMatch(/^dashctl: the answer was cut off/);
  });
});
