import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { aggregateTokenStatsForTaskPath } from '../taskTokenAggregator';
import { claudeProjectDir } from '../claudePaths';

let tmpHome: string;
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-tokens-'));
  process.env.HOME = tmpHome;
  delete process.env.CLAUDE_CONFIG_DIR;
});

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CONFIG_DIR;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeSession(taskPath: string, sessionId: string, lines: object[]) {
  const dir = claudeProjectDir(taskPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${sessionId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

function asstLine(opts: {
  uuid: string;
  requestId?: string;
  input: number;
  output: number;
  cacheRead?: number;
  model?: string;
}) {
  return {
    uuid: opts.uuid,
    type: 'assistant',
    timestamp: '2026-01-01T00:00:00Z',
    requestId: opts.requestId,
    message: {
      role: 'assistant',
      content: [],
      usage: {
        input_tokens: opts.input,
        output_tokens: opts.output,
        cache_read_input_tokens: opts.cacheRead ?? 0,
      },
      model: opts.model ?? 'claude-sonnet-4-6',
    },
  };
}

describe('aggregateTokenStatsForTaskPath', () => {
  it('returns zeros when project dir does not exist', async () => {
    const result = await aggregateTokenStatsForTaskPath('/nonexistent/path');
    expect(result).toEqual({ totalTokens: 0, totalCostUsd: 0 });
  });

  it('sums tokens and cost from a single session file', async () => {
    const taskPath = '/tmp/test-task-a';
    writeSession(taskPath, 'session-1', [
      asstLine({ uuid: 'a', requestId: 'r1', input: 1000, output: 500 }),
      asstLine({ uuid: 'b', requestId: 'r2', input: 2000, output: 1000 }),
    ]);

    const result = await aggregateTokenStatsForTaskPath(taskPath);

    expect(result.totalTokens).toBe(4500);
    expect(result.totalCostUsd).toBeCloseTo(0.0315, 6);
  });

  it('reads a worktree task from the directory Claude Code writes under CLAUDE_CONFIG_DIR', async () => {
    const configDir = path.join(tmpHome, 'alt-claude');
    process.env.CLAUDE_CONFIG_DIR = configDir;
    // Written by hand, not via claudeProjectDir, so the path is an oracle: the
    // `.` of `.claude` encodes to `-` just like the `/` before it.
    const dir = path.join(configDir, 'projects', '-tmp-repo--claude-worktrees-fix-1a2b');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'session-1.jsonl'),
      JSON.stringify(asstLine({ uuid: 'a', requestId: 'r1', input: 1000, output: 500 })) + '\n',
    );

    const result = await aggregateTokenStatsForTaskPath('/tmp/repo/.claude/worktrees/fix-1a2b');

    expect(result.totalTokens).toBe(1500);
  });

  it('dedupes by requestId across multiple session files', async () => {
    const taskPath = '/tmp/test-task-b';
    writeSession(taskPath, 'session-1', [
      asstLine({ uuid: 'a', requestId: 'r1', input: 1000, output: 500 }),
    ]);
    writeSession(taskPath, 'session-2', [
      asstLine({ uuid: 'a-copy', requestId: 'r1', input: 1000, output: 500 }),
      asstLine({ uuid: 'b', requestId: 'r2', input: 2000, output: 1000 }),
    ]);

    const result = await aggregateTokenStatsForTaskPath(taskPath);

    expect(result.totalTokens).toBe(4500);
  });

  it('uses per-message model to compute cost (mixed models)', async () => {
    const taskPath = '/tmp/test-task-c';
    writeSession(taskPath, 'session-1', [
      asstLine({
        uuid: 'a',
        requestId: 'r1',
        input: 1_000_000,
        output: 0,
        model: 'claude-opus-4-7',
      }),
      asstLine({
        uuid: 'b',
        requestId: 'r2',
        input: 1_000_000,
        output: 0,
        model: 'claude-sonnet-4-6',
      }),
    ]);

    const result = await aggregateTokenStatsForTaskPath(taskPath);

    expect(result.totalCostUsd).toBeCloseTo(15 + 3, 6);
  });

  it('skips non-jsonl files in the project dir', async () => {
    const taskPath = '/tmp/test-task-d';
    writeSession(taskPath, 'session-1', [
      asstLine({ uuid: 'a', requestId: 'r1', input: 1000, output: 500 }),
    ]);
    const dir = claudeProjectDir(taskPath);
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'should be ignored');

    const result = await aggregateTokenStatsForTaskPath(taskPath);
    expect(result.totalTokens).toBe(1500);
  });
});
