import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeDashctl } from '../dashctl';
import { controlPaths } from '../paths';
import { initTokens, tokenFor, verify } from '../tokens';
import { dashSessionAccess, setReadOnlyCapabilities } from '../taskAccess';

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
    execFileSync('sh', ['-c', hook!.command], {
      env: { ...process.env, CLAUDE_ENV_FILE: envFile },
    });
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
