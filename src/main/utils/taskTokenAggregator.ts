import * as fs from 'fs';
import * as path from 'path';
import { parseJsonlLine } from './jsonlParser';
import { claudeProjectDir } from './claudePaths';
import { computeCostUsd } from './claudePricing';
import type { ParsedSessionMessage } from '../../shared/sessionTypes';
import { parseClaudeVersion } from '../services/claudeCli';
import { reportFindings } from '../claudeContract/driftReporter';
import { checkTranscriptUsage } from '../claudeContract/internalSchemas';

export interface TaskTokenStats {
  totalTokens: number;
  totalCostUsd: number;
}

/** One message as the totals count it. */
interface Counted {
  requestId: string | undefined;
  tokens: number;
  costUsd: number;
}

/**
 * What one transcript has yielded so far. Transcripts only grow, so a read
 * picks up at `offset`, the end of the last whole line, and the counted
 * messages carry over.
 */
interface Tally {
  ino: number;
  offset: number;
  /** The file's first bytes and the last ones read (up to `offset`), to tell
   *  a rewritten file from a grown one. */
  head: Buffer;
  edge: Buffer;
  /** Counted messages in line order, a requestId's at its last line: what
   *  deduplicateByRequestId keeps of this file alone. Messages with neither
   *  a requestId nor usage add nothing, so they are left out. */
  counted: Map<string, Counted>;
  /** Unique keys for the messages without a requestId. */
  lines: number;
  /** A last line not yet ended by a newline: counted this time, read again next. */
  tail: Counted | null;
}

const PROBE_BYTES = 64;
/** How many transcript folders keep their tallies (each task has one or two). */
const FOLDER_CAP = 32;

/**
 * Sums tokens and cost over every transcript Claude wrote for a task, keeping
 * a tally per file so a recompute reads only what was appended since the last
 * one. A file that shrank, was replaced or was rewritten is read again whole.
 * The totals equal a full read's to the last bit: the messages are summed in
 * the same order (see `sum`).
 */
export class TokenStatsAggregator {
  /** Per transcript folder, its files' tallies. Least recently used first. */
  private folders = new Map<string, Map<string, Tally>>();
  /** (version, model) pairs whose usage shape was checked for drift. */
  private checked = new Set<string>();
  /** Recomputes run one at a time, so two never append to one tally. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Accepts the task's current path plus any earlier one (Task.previousPath
   * after the 0.16 worktree move): Claude keys transcript dirs by the cwd a
   * session started in, so a moved task's history is split across two encoded
   * dirs. Messages are deduplicated by requestId across all of them.
   * `sessions`, when given, limits the count to those sessions' transcripts
   * (a folder several tasks share holds all of theirs).
   */
  aggregate(
    taskPath: string | Array<string | null | undefined>,
    sessions?: ReadonlySet<string>,
  ): Promise<TaskTokenStats> {
    const run = this.queue.then(() => this.run(taskPath, sessions));
    this.queue = run.catch(() => {});
    return run;
  }

  private async run(
    taskPath: string | Array<string | null | undefined>,
    sessions: ReadonlySet<string> | undefined,
  ): Promise<TaskTokenStats> {
    const paths = (Array.isArray(taskPath) ? taskPath : [taskPath]).filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );

    const tallies: Tally[] = [];
    for (const p of new Set(paths)) {
      const projectDir = claudeProjectDir(p);

      // Recursive: subagent and workflow transcripts are written to
      // <sessionId>/subagents/**/agent-*.jsonl, not next to the session file.
      let entries: string[];
      try {
        entries = await fs.promises.readdir(projectDir, { recursive: true });
      } catch {
        continue;
      }

      const known = this.folders.get(projectDir) ?? new Map<string, Tally>();
      const seen = new Map<string, Tally>();
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        const full = path.join(projectDir, entry);
        if (sessions && !sessions.has(transcriptSession(entry))) {
          // Another task's: not counted, but its tally is kept for that task.
          const other = known.get(full);
          if (other) seen.set(full, other);
          continue;
        }
        const tally = await this.read(full, known.get(full));
        if (!tally) continue;
        seen.set(full, tally);
        tallies.push(tally);
      }
      // Files gone from the folder drop out.
      this.folders.delete(projectDir);
      this.folders.set(projectDir, seen);
      if (this.folders.size > FOLDER_CAP) this.folders.delete(this.folders.keys().next().value!);
    }

    return sum(tallies);
  }

  /** `prev` brought up to the file's end, or a fresh tally; null when unreadable. */
  private async read(file: string, prev: Tally | undefined): Promise<Tally | null> {
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(file, 'r');
    } catch {
      return null;
    }
    try {
      const { ino, size } = await handle.stat();
      let tally = prev;
      if (
        tally &&
        (tally.ino !== ino || size < tally.offset || !(await unchanged(handle, tally)))
      ) {
        tally = undefined;
      }
      tally ??= {
        ino,
        offset: 0,
        head: Buffer.alloc(0),
        edge: Buffer.alloc(0),
        counted: new Map(),
        lines: 0,
        tail: null,
      };

      const fresh = Buffer.alloc(size - tally.offset);
      const { bytesRead } = await handle.read(fresh, 0, fresh.length, tally.offset);
      const chunk = fresh.subarray(0, bytesRead);

      // Whole lines only: a newline byte never sits inside a UTF-8 sequence,
      // so the text decodes as it does within the whole file.
      const end = chunk.lastIndexOf(0x0a) + 1;
      for (const line of chunk.subarray(0, end).toString('utf8').split('\n')) {
        const msg = this.parse(line);
        if (!msg) continue;
        const key = msg.requestId ?? `\0${tally.lines++}`;
        tally.counted.delete(key);
        tally.counted.set(key, msg);
      }
      if (end > 0) {
        const read = Buffer.concat([tally.edge, chunk.subarray(0, end)]);
        if (tally.head.length < PROBE_BYTES)
          tally.head = Buffer.from(read.subarray(0, PROBE_BYTES));
        tally.edge = Buffer.from(read.subarray(Math.max(0, read.length - PROBE_BYTES)));
      }
      tally.offset += end;
      tally.tail = this.parse(chunk.subarray(end).toString('utf8'));
      return tally;
    } catch {
      return null;
    } finally {
      await handle.close().catch(() => {});
    }
  }

  /** A transcript line as the totals count it; null when it adds nothing. */
  private parse(line: string): Counted | null {
    const msg = parseJsonlLine(line);
    if (!msg || (!msg.requestId && !msg.usage)) return null;
    this.checkDrift(msg);
    const usage = msg.usage;
    return {
      requestId: msg.requestId,
      tokens: usage
        ? (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.output_tokens ?? 0)
        : 0,
      costUsd: usage ? computeCostUsd(usage, msg.model) : 0,
    };
  }

  /** Drift: one message per (version, model) is enough, and keeps a
   *  transcript of thousands of lines from re-checking (and re-counting) each one. */
  private checkDrift(msg: ParsedSessionMessage): void {
    const key = `${msg.version}\0${msg.model}`;
    if (msg.type !== 'assistant' || this.checked.has(key)) return;
    this.checked.add(key);
    const version = parseClaudeVersion(msg.version)?.join('.') ?? 'unknown';
    reportFindings('transcript', checkTranscriptUsage(msg.usage, msg.model), version);
  }
}

/**
 * The session a transcript belongs to, from its path in the transcript dir:
 * `<session>.jsonl`, or a subagent's under `<session>/subagents/`.
 */
export function transcriptSession(entry: string): string {
  const first = entry.split(/[\\/]/)[0]!;
  return first.endsWith('.jsonl') ? first.slice(0, -'.jsonl'.length) : first;
}

/** Whether the file still holds, at its start and just before `offset`, the bytes the tally read there. */
async function unchanged(handle: fs.promises.FileHandle, tally: Tally): Promise<boolean> {
  const holds = async (expected: Buffer, at: number) => {
    const buf = Buffer.alloc(expected.length);
    const { bytesRead } = await handle.read(buf, 0, buf.length, at);
    return bytesRead === buf.length && buf.equals(expected);
  };
  return (
    (await holds(tally.head, 0)) && (await holds(tally.edge, tally.offset - tally.edge.length))
  );
}

/** A tally's messages in line order, its unfinished last line last. */
function* messagesOf(tally: Tally): Generator<Counted> {
  const tailId = tally.tail?.requestId;
  for (const msg of tally.counted.values()) {
    if (tailId === undefined || msg.requestId !== tailId) yield msg;
  }
  if (tally.tail) yield tally.tail;
}

/**
 * The totals over the files in read order, as a full read computes them:
 * deduplicateByRequestId keeps each requestId's last message across all
 * files, and the cost is summed in that order (float addition isn't
 * associative, so the order is part of the result).
 */
export function sum(tallies: Tally[]): TaskTokenStats {
  const lastFile = new Map<string, number>();
  tallies.forEach((tally, i) => {
    for (const msg of messagesOf(tally)) if (msg.requestId) lastFile.set(msg.requestId, i);
  });
  let totalTokens = 0;
  let totalCostUsd = 0;
  tallies.forEach((tally, i) => {
    for (const msg of messagesOf(tally)) {
      if (msg.requestId && lastFile.get(msg.requestId) !== i) continue;
      totalTokens += msg.tokens;
      totalCostUsd += msg.costUsd;
    }
  });
  return { totalTokens, totalCostUsd };
}

const aggregator = new TokenStatsAggregator();

/** Sum tokens + cost over every transcript Claude wrote for a task (see TokenStatsAggregator). */
export function aggregateTokenStatsForTaskPath(
  taskPath: string | Array<string | null | undefined>,
  sessions?: ReadonlySet<string>,
): Promise<TaskTokenStats> {
  return aggregator.aggregate(taskPath, sessions);
}
