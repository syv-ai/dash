import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractRewrittenCommand, pipeStdin, runShell } from './helpers';
import type { RtkExecDiff, RtkResolution, RtkTestResult } from './types';

/**
 * Run `rtk hook claude` end to end on a `git status` PreToolUse payload, so
 * Settings can show that the binary really rewrites. `managedDir` is prepended
 * to PATH when running the rewritten command (it invokes the bare `rtk`).
 */
export async function runHookTest(
  resolved: RtkResolution,
  managedDir: string | null,
): Promise<RtkTestResult> {
  const testedCommand = 'git status';
  const input = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: testedCommand, description: 'RTK self-test' },
  });

  try {
    const { stdout, stderr, code, signal } = await pipeStdin(
      resolved.path,
      ['hook', 'claude'],
      input,
      10_000,
    );

    if (/panic|unwrap|segfault/i.test(stderr)) {
      return { ok: false, testedCommand, error: `rtk crashed: ${stderr.trim().slice(0, 400)}` };
    }
    if (code === null) {
      return {
        ok: false,
        testedCommand,
        error: `rtk killed by signal ${signal ?? 'unknown'} (likely timeout)`,
      };
    }
    // rtk exits 2 to signal "block this tool call" — a valid hook result.
    if (code !== 0 && code !== 2) {
      return {
        ok: false,
        testedCommand,
        error: `rtk exited ${code}${stderr ? ': ' + stderr.trim().slice(0, 400) : ''}`,
      };
    }

    const extracted = extractRewrittenCommand(stdout);
    if (!extracted.ok) {
      return {
        ok: false,
        testedCommand,
        error: `rtk produced unparsable output: ${extracted.reason}`,
      };
    }

    const rawOutput = stdout.slice(0, 2000);
    if (code === 2) {
      return {
        ok: true,
        testedCommand,
        rawOutput,
        outcome: { kind: 'blocked', stderr: stderr.trim().slice(0, 400) },
      };
    }

    const rewriteCmd = extracted.command;
    if (rewriteCmd !== null && rewriteCmd !== testedCommand) {
      const execDiff = await captureExecDiff(testedCommand, rewriteCmd, managedDir);
      return {
        ok: true,
        testedCommand,
        rawOutput,
        outcome: { kind: 'rewritten', rewrittenCommand: rewriteCmd, execDiff },
      };
    }
    return { ok: true, testedCommand, rawOutput, outcome: { kind: 'pass-through' } };
  } catch (err) {
    return { ok: false, testedCommand, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run the raw and rewritten commands in a throwaway git repo with enough files
 * to make `git status` verbose. Failures come back as `kind: 'failed'`, never as
 * a silent pass-through.
 */
async function captureExecDiff(
  rawCommand: string,
  rewrittenCommand: string,
  managedDir: string | null,
): Promise<RtkExecDiff> {
  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), 'dash-rtk-verify-'));
  } catch (err) {
    return {
      kind: 'failed',
      stage: 'setup',
      reason: `Couldn't create temp dir: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    await Promise.all([
      writeFile(join(dir, 'package.json'), '{}\n'),
      writeFile(join(dir, 'README.md'), '# test\n'),
      writeFile(join(dir, 'config.toml'), '[section]\nvalue = 1\n'),
      mkdir(join(dir, 'src')).then(() =>
        Promise.all([
          writeFile(join(dir, 'src', 'index.ts'), 'export {};\n'),
          writeFile(join(dir, 'src', 'lib.ts'), 'export {};\n'),
          writeFile(join(dir, 'src', 'types.ts'), 'export {};\n'),
        ]),
      ),
      mkdir(join(dir, 'tests')).then(() =>
        Promise.all([
          writeFile(join(dir, 'tests', 'a.test.ts'), 'test\n'),
          writeFile(join(dir, 'tests', 'b.test.ts'), 'test\n'),
        ]),
      ),
    ]);

    const initRes = await runShell('git init -q', dir);
    if (initRes.code !== 0) {
      return {
        kind: 'failed',
        stage: 'setup',
        exitCode: initRes.code ?? undefined,
        stderr: initRes.stderr.slice(0, 400),
        reason: `git init failed (exit ${initRes.code ?? 'null'}). Is git installed?`,
      };
    }

    const env = {
      ...process.env,
      PATH: [managedDir, process.env.PATH].filter(Boolean).join(delimiter),
    };
    const [rawRes, rewrittenRes] = await Promise.all([
      runShell(rawCommand, dir, env),
      runShell(rewrittenCommand, dir, env),
    ]);

    if (rawRes.code !== 0) {
      return {
        kind: 'failed',
        stage: 'raw',
        exitCode: rawRes.code ?? undefined,
        stderr: rawRes.stderr.slice(0, 400),
        reason: `Raw command exited ${rawRes.code ?? 'null'}: ${rawCommand}`,
      };
    }
    if (rewrittenRes.code !== 0) {
      return {
        kind: 'failed',
        stage: 'rewritten',
        exitCode: rewrittenRes.code ?? undefined,
        stderr: rewrittenRes.stderr.slice(0, 400),
        reason: `Rewritten command exited ${rewrittenRes.code ?? 'null'}: ${rewrittenCommand}`,
      };
    }

    const DISPLAY_CAP = 8 * 1024;
    return {
      kind: 'ok',
      rawStdout: rawRes.stdout.slice(0, DISPLAY_CAP),
      compressedStdout: rewrittenRes.stdout.slice(0, DISPLAY_CAP),
      rawBytes: Buffer.byteLength(rawRes.stdout),
      compressedBytes: Buffer.byteLength(rewrittenRes.stdout),
      truncated: rawRes.truncated || rewrittenRes.truncated,
    };
  } catch (err) {
    console.warn('[rtk.captureExecDiff] unexpected:', err);
    return {
      kind: 'failed',
      stage: 'unknown',
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch((err) => {
      console.warn('[rtk.captureExecDiff] tmpdir cleanup failed:', err);
    });
  }
}
