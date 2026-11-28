import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { aggregateTokenStatsForTaskPath, TokenStatsAggregator } from '../taskTokenAggregator';
import { claudeProjectDir } from '../claudePaths';
import { calculateMetrics, deduplicateByRequestId, parseJsonlLine } from '../jsonlParser';
import { computeCostUsd } from '../claudePricing';
import type { ParsedSessionMessage } from '../../../shared/sessionTypes';

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
  const file = path.join(claudeProjectDir(taskPath), `${sessionId}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
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

  it('counts subagent and workflow transcripts nested under a session', async () => {
    const taskPath = '/tmp/test-task-e';
    writeSession(taskPath, 'session-1', [
      asstLine({ uuid: 'a', requestId: 'r1', input: 1000, output: 500 }),
    ]);
    writeSession(taskPath, 'session-1/subagents/agent-abc', [
      asstLine({ uuid: 'b', requestId: 'r2', input: 2000, output: 1000 }),
    ]);
    writeSession(taskPath, 'session-1/subagents/workflows/wf_1/agent-def', [
      asstLine({ uuid: 'c', requestId: 'r3', input: 4000, output: 2000 }),
    ]);
    // Workflow journal lines have no uuid/usage and must not affect the total.
    writeSession(taskPath, 'session-1/subagents/workflows/wf_1/journal', [
      { type: 'started', key: 'v2:x', agentId: 'def' },
    ]);

    const result = await aggregateTokenStatsForTaskPath(taskPath);

    expect(result.totalTokens).toBe(10500);
  });

  it("counts only the given sessions in a folder several tasks share, each task's own", async () => {
    const plain = '/tmp/test-task-shared';
    writeSession(plain, 'sess-a', [
      asstLine({ uuid: 'a', requestId: 'ra', input: 100, output: 0 }),
    ]);
    writeSession(plain, 'sess-a/subagents/agent-x', [
      asstLine({ uuid: 'x', requestId: 'rx', input: 10, output: 0 }),
    ]);
    writeSession(plain, 'sess-b', [
      asstLine({ uuid: 'b', requestId: 'rb', input: 2000, output: 0 }),
    ]);
    writeSession(plain, 'sess-c', [
      asstLine({ uuid: 'c', requestId: 'rc', input: 30000, output: 0 }),
    ]);
    const agg = new TokenStatsAggregator();

    expect((await agg.aggregate(plain, new Set(['sess-a']))).totalTokens).toBe(110);
    expect((await agg.aggregate(plain, new Set(['sess-b']))).totalTokens).toBe(2000);
    expect((await agg.aggregate(plain, new Set(['sess-c', 'gone']))).totalTokens).toBe(30000);
    expect(await agg.aggregate(plain, new Set())).toEqual({ totalTokens: 0, totalCostUsd: 0 });
    // The whole folder without a filter, after the filtered reads kept every tally.
    expect((await agg.aggregate(plain)).totalTokens).toBe(32110);
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

/**
 * The full read the incremental tally replaces, kept as the oracle: every
 * transcript read and parsed whole, deduplicated by requestId, summed in order.
 */
async function fullRead(paths: string[]) {
  const all: ParsedSessionMessage[] = [];
  for (const p of new Set(paths)) {
    const dir = claudeProjectDir(p);
    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir, { recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries.filter((e) => e.endsWith('.jsonl'))) {
      const data = await fs.promises.readFile(path.join(dir, entry), 'utf8');
      for (const line of data.split('\n')) {
        const parsed = parseJsonlLine(line);
        if (parsed) all.push(parsed);
      }
    }
  }
  if (all.length === 0) return { totalTokens: 0, totalCostUsd: 0 };
  const deduped = deduplicateByRequestId(all);
  let totalCostUsd = 0;
  for (const msg of deduped) if (msg.usage) totalCostUsd += computeCostUsd(msg.usage, msg.model);
  return { totalTokens: calculateMetrics(deduped).totalTokens, totalCostUsd };
}

describe('TokenStatsAggregator, read on as transcripts grow', () => {
  const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5', undefined];
  /** A transcript's worth of lines: streamed requests repeating a requestId,
   *  user lines, a line with usage but no requestId, and a broken one. */
  function transcript(prefix: string, n: number, seed = 1): string {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 5 === 0)
        out.push(
          JSON.stringify({
            uuid: `${prefix}u${i}`,
            type: 'user',
            message: { role: 'user', content: 'hé ✓' },
          }),
        );
      else if (i % 17 === 0) out.push('{"broken": ');
      else
        out.push(
          JSON.stringify(
            asstLine({
              uuid: `${prefix}a${i}`,
              // Some requestIds recur in the other transcripts too.
              requestId: i % 13 === 0 ? undefined : `r${Math.floor(i / 3) % 40}`,
              input: (i * 7 * seed) % 1013,
              output: (i * 31) % 4099,
              cacheRead: (i * 101) % 70001,
              model: MODELS[i % MODELS.length],
            }),
          ),
        );
    }
    return out.join('\n') + '\n';
  }

  /** Appends `text` to the file in uneven slices, lines cut anywhere, checking each step. */
  async function growAndCheck(
    agg: TokenStatsAggregator,
    paths: string[],
    file: string,
    text: string,
  ) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = Buffer.from(text);
    for (let at = 0, step = 1; at < bytes.length; step++) {
      const next = Math.min(bytes.length, at + ((step * 977) % 3001) + 1);
      fs.appendFileSync(file, bytes.subarray(at, next));
      at = next;
      expect(await agg.aggregate(paths)).toEqual(await fullRead(paths));
    }
  }

  it('equals a full read after every append, across files and both task paths', async () => {
    const paths = ['/tmp/test-task-grow', '/tmp/test-task-grow-old'];
    const agg = new TokenStatsAggregator();
    const [now, old] = paths.map(claudeProjectDir) as [string, string];
    await growAndCheck(agg, paths, path.join(old, 's0.jsonl'), transcript('o', 60));
    await growAndCheck(agg, paths, path.join(now, 's1.jsonl'), transcript('a', 120));
    await growAndCheck(
      agg,
      paths,
      path.join(now, 's1/subagents/agent-x.jsonl'),
      transcript('b', 80),
    );
    await growAndCheck(agg, paths, path.join(now, 's1.jsonl'), transcript('c', 90));

    const totals = await agg.aggregate(paths);
    expect(totals.totalTokens).toBeGreaterThan(0);
    // Bit for bit, not close to: the cost is summed in the full read's order.
    expect(totals.totalCostUsd).toBe((await fullRead(paths)).totalCostUsd);
    expect(await new TokenStatsAggregator().aggregate(paths)).toEqual(totals);
  });

  it('reads a file again whole when it shrinks, is rewritten or replaced', async () => {
    const paths = ['/tmp/test-task-rewrite'];
    const file = path.join(claudeProjectDir(paths[0]!), 's1.jsonl');
    const agg = new TokenStatsAggregator();
    await growAndCheck(agg, paths, file, transcript('a', 50));

    fs.writeFileSync(file, transcript('b', 10));
    expect(await agg.aggregate(paths)).toEqual(await fullRead(paths));

    // Rewritten in place to more bytes than were read: the tokens differ
    // from the first line on, so reading on from the old offset would be wrong.
    fs.writeFileSync(file, transcript('b', 40, 3));
    expect(await agg.aggregate(paths)).toEqual(await fullRead(paths));

    // Replaced by another file (a rename over it), larger than before.
    fs.writeFileSync(`${file}.tmp`, transcript('d', 70));
    fs.renameSync(`${file}.tmp`, file);
    expect(await agg.aggregate(paths)).toEqual(await fullRead(paths));
  });

  it('counts a last line without its newline, and once it gets one', async () => {
    const paths = ['/tmp/test-task-tail'];
    const file = path.join(claudeProjectDir(paths[0]!), 's1.jsonl');
    const agg = new TokenStatsAggregator();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = (uuid: string, requestId: string, input: number) =>
      JSON.stringify(asstLine({ uuid, requestId, input, output: 1 }));
    // The unfinished line repeats r1's requestId, so it stands in for the first.
    fs.writeFileSync(
      file,
      `${line('a', 'r1', 10)}\n${line('b', 'r2', 20)}\n${line('c', 'r1', 40)}`,
    );
    expect(await agg.aggregate(paths)).toEqual({ ...(await fullRead(paths)), totalTokens: 62 });
    fs.appendFileSync(file, `\n${line('d', 'r3', 80)}`);
    expect(await agg.aggregate(paths)).toEqual({ ...(await fullRead(paths)), totalTokens: 143 });
  });

  it('drops a deleted transcript from the totals', async () => {
    const paths = ['/tmp/test-task-delete'];
    const dir = claudeProjectDir(paths[0]!);
    const agg = new TokenStatsAggregator();
    await growAndCheck(agg, paths, path.join(dir, 's1.jsonl'), transcript('a', 40));
    await growAndCheck(agg, paths, path.join(dir, 's2.jsonl'), transcript('b', 40));
    fs.rmSync(path.join(dir, 's1.jsonl'));
    expect(await agg.aggregate(paths)).toEqual(await fullRead(paths));
  });

  it('keeps concurrent recomputes of one task from counting an append twice', async () => {
    const paths = ['/tmp/test-task-concurrent'];
    const file = path.join(claudeProjectDir(paths[0]!), 's1.jsonl');
    const agg = new TokenStatsAggregator();
    await growAndCheck(agg, paths, file, transcript('a', 30));
    fs.appendFileSync(file, transcript('b', 30));
    const [x, y] = await Promise.all([agg.aggregate(paths), agg.aggregate(paths)]);
    const full = await fullRead(paths);
    expect(x).toEqual(full);
    expect(y).toEqual(full);
  });
});
