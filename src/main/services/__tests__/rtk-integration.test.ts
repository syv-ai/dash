/**
 * End-to-end integration tests for the RTK PreToolUse hook.
 *
 * These tests confirm two separate things:
 *   A) rtk itself compresses commands (hook-only test, no API key).
 *   B) Dash's full integration works end-to-end — the injected hook fires
 *      during a real `claude -p` session and rtk emits its rewrite directive
 *      (e2e test, costs API tokens, gated on ANTHROPIC_API_KEY).
 *
 * Each describe block auto-skips if its prerequisites are missing, so
 * `pnpm test` is safe to run anywhere.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, execSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, mkdir, access, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Mirror Dash's runtime resolution: prefer the managed binary inside
 * Electron's userData dir (same path RtkService uses), fall back to $PATH.
 * Without this the test skips on machines where rtk was installed via
 * Dash's UI (which never touches $PATH).
 */
function dashManagedRtkPath(): string | null {
  const exe = process.platform === 'win32' ? 'rtk.exe' : 'rtk';
  const candidates =
    process.platform === 'darwin'
      ? [join(homedir(), 'Library', 'Application Support', 'Dash', 'bin', exe)]
      : process.platform === 'linux'
        ? [join(homedir(), '.config', 'Dash', 'bin', exe)]
        : [join(homedir(), 'AppData', 'Roaming', 'Dash', 'bin', exe)];
  return candidates.find(existsSync) ?? null;
}

function findRtk(): string | null {
  const managed = dashManagedRtkPath();
  if (managed) return managed;
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const out = execSync(`${finder} rtk`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return out.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

function onPath(bin: string): boolean {
  try {
    execSync(`${process.platform === 'win32' ? 'where' : 'which'} ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function resolveOnPath(bin: string): Promise<string> {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const { stdout } = await execFileAsync(finder, [bin]);
  const first = stdout.trim().split(/\r?\n/)[0];
  if (!first) throw new Error(`${bin} not found`);
  return first;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Run a binary with stdin piped in; resolve with exit code, stdout, stderr. */
function runWithStdin(
  cmd: string,
  args: string[],
  stdin: string,
  timeoutMs = 10_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Suite A: rtk compression behaviour (no Claude API required)
// ═══════════════════════════════════════════════════════════════════════

const resolvedRtkPath = findRtk();

describe.runIf(!!resolvedRtkPath)('rtk hook output (no API)', () => {
  const rtkPath = resolvedRtkPath!;

  it('rewrites a known-compressible command (git status) via `rtk hook claude`', async () => {
    // rtk's PreToolUse hook reads Claude Code's tool-use JSON on stdin and
    // writes an advice JSON on stdout. `git status` is rtk's headline example
    // (~75% token reduction), so the advice must include a modified command
    // that invokes rtk itself — that's how downstream compression is triggered.
    const input = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git status', description: 'status' },
    });

    const { code, stdout, stderr } = await runWithStdin(rtkPath, ['hook', 'claude'], input);

    expect(stderr).not.toMatch(/panic|unwrap|segfault/i);
    expect(code === 0 || code === 2).toBe(true); // 0=allow(+modify), 2=block; never a crash
    expect(stdout.trim().length).toBeGreaterThan(0);

    // The rewrite directive must reference rtk so the follow-up Bash tool call
    // actually invokes the compression pipeline instead of raw ls.
    const parsed = JSON.parse(stdout) as unknown;
    expect(JSON.stringify(parsed)).toMatch(/\brtk\b/);
  });

  it('returns cleanly on a command rtk does not rewrite (echo)', async () => {
    const input = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo hi', description: 'echo' },
    });
    const { code, stderr } = await runWithStdin(rtkPath, ['hook', 'claude'], input);
    expect(stderr).not.toMatch(/panic|unwrap|segfault/i);
    // 0 = pass-through, 2 = block; anything else would indicate a crash.
    expect([0, 2]).toContain(code);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Suite B: end-to-end with a real `claude -p` session
// ═══════════════════════════════════════════════════════════════════════

const canRunE2E = !!process.env.ANTHROPIC_API_KEY && !!resolvedRtkPath && onPath('claude');

describe.runIf(canRunE2E)('RTK end-to-end with Claude Code', () => {
  const rtkPath = resolvedRtkPath!;
  let claudePath = '';
  let cwd = '';
  let hookOutLog = '';
  let hookInLog = '';

  beforeAll(async () => {
    claudePath = await resolveOnPath('claude');
    cwd = await mkdtemp(join(tmpdir(), 'dash-rtk-e2e-'));
    hookInLog = join(cwd, 'hook-in.log');
    hookOutLog = join(cwd, 'hook-out.log');
  });

  afterAll(async () => {
    if (cwd) await rm(cwd, { recursive: true, force: true });
  });

  it('hook fires, rtk emits a rewrite directive, and the Bash tool completes', async () => {
    const claudeDir = join(cwd, '.claude');
    await mkdir(claudeDir, { recursive: true });

    // Wrap the hook with tee on both sides so we can verify rtk actually
    // processed Claude's tool-use payload. The shape of `hooks[0].hooks[0]`
    // still matches buildPreToolUseHooks() in ptyManager — only the
    // `command` string differs (adding the tee wrappers).
    const q = (s: string): string => (s.includes(' ') ? `"${s}"` : s);
    const hookCommand = `sh -c 'tee -a ${q(hookInLog)} | ${q(rtkPath)} hook claude | tee -a ${q(hookOutLog)}'`;

    const settings = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: hookCommand }] }],
      },
    };
    await writeFile(join(claudeDir, 'settings.local.json'), JSON.stringify(settings, null, 2));

    // `ls -la` is on rtk's rewrite list per its README, so this forces
    // compression rather than pass-through. The echo-to-marker confirms
    // the Bash tool call actually completed after the hook ran.
    const marker = join(cwd, 'marker.txt');
    const prompt =
      `Use the Bash tool to run: ls -la /tmp. ` +
      `Then use the Bash tool again to run: echo done > "${marker}". ` +
      `Finally reply with the single word: done`;

    const { stdout } = await execFileAsync(
      claudePath,
      ['-p', prompt, '--dangerously-skip-permissions'],
      { cwd, timeout: 180_000, env: process.env, maxBuffer: 4 * 1024 * 1024 },
    );

    // 1. The hook was invoked at least once — input log has content.
    expect(await fileExists(hookInLog)).toBe(true);
    const inLog = await readFile(hookInLog, 'utf-8');
    expect(inLog).toMatch(/PreToolUse/);
    expect(inLog).toMatch(/"tool_name":\s*"Bash"/);

    // 2. rtk wrote back a rewrite directive — output log references rtk,
    //    proving it intended to compress the command.
    expect(await fileExists(hookOutLog)).toBe(true);
    const outLog = await readFile(hookOutLog, 'utf-8');
    expect(outLog.trim().length).toBeGreaterThan(0);
    expect(outLog).toMatch(/\brtk\b/);

    // 3. The second Bash tool call ran to completion after the hook.
    expect(await fileExists(marker)).toBe(true);

    // 4. The model finished its turn.
    expect(stdout.toLowerCase()).toContain('done');
  }, 240_000);
});
