// Two suites: (A) rtk's hook output alone (no API); (B) full Dash+Claude e2e
// (gated on ANTHROPIC_API_KEY). Auto-skips when prerequisites are missing so
// `pnpm test` is safe to run anywhere.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, execSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, mkdir, access, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

/** Prefer Dash's managed binary (where the UI installs it) over $PATH. */
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

/** Pull the rewritten Bash command out of rtk's JSON advice. */
function extractCommand(rtkStdout: string): string {
  const parsed = JSON.parse(rtkStdout) as {
    hookSpecificOutput?: { updatedInput?: { command?: string } };
  };
  const cmd = parsed.hookSpecificOutput?.updatedInput?.command;
  if (typeof cmd !== 'string') {
    throw new Error(`rtk output missing hookSpecificOutput.updatedInput.command: ${rtkStdout}`);
  }
  return cmd;
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
    expect(code).toBe(0); // 0 = allow (with modification); a rewrite must not block.
    expect(stdout.trim().length).toBeGreaterThan(0);

    // Assert on the exact field carrying the rewritten command — a broad
    // /rtk/ match would also hit field names and thus pass under schema drift.
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: { updatedInput?: { command?: string } };
    };
    const rewritten = parsed.hookSpecificOutput?.updatedInput?.command;
    expect(typeof rewritten).toBe('string');
    expect(rewritten).toMatch(/\brtk\b/);
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

    // Wrap the hook with tee so we can capture stdin/stdout. The JSON shape
    // matches what Dash writes at runtime — drift here means this test no
    // longer represents production.
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

    // Pass only the env vars claude actually needs; don't leak the developer's
    // full shell env (local RTK_* overrides, test-affecting vars, etc.) in.
    const hermeticEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
    const { stdout } = await execFileAsync(
      claudePath,
      ['-p', prompt, '--dangerously-skip-permissions'],
      { cwd, timeout: 180_000, env: hermeticEnv, maxBuffer: 4 * 1024 * 1024 },
    );

    // 1. The hook was invoked at least once — input log has content.
    expect(await fileExists(hookInLog)).toBe(true);
    const inLog = await readFile(hookInLog, 'utf-8');
    expect(inLog).toMatch(/PreToolUse/);
    expect(inLog).toMatch(/"tool_name":\s*"Bash"/);

    // 2. rtk wrote back a rewrite directive — assert on the exact command
    //    field, not a broad /rtk/ match that would also hit field names.
    expect(await fileExists(hookOutLog)).toBe(true);
    const outLog = await readFile(hookOutLog, 'utf-8');
    expect(outLog.trim().length).toBeGreaterThan(0);
    const rewritten = extractCommand(outLog);
    expect(rewritten).toMatch(/\brtk\b/);

    // 3. The second Bash tool call ran to completion after the hook.
    expect(await fileExists(marker)).toBe(true);

    // 4. The model finished its turn.
    expect(stdout.toLowerCase()).toContain('done');
  }, 240_000);
});
