/**
 * Pure pieces of "Fix CI" on Azure DevOps: what a failed Azure Pipelines
 * build tells of its failure, read from its timeline (Build - Timeline - Get,
 * https://learn.microsoft.com/en-us/rest/api/azure/devops/build/timeline/get)
 * and the failing task's log (Builds - Get Build Log), in the shape
 * `ciReport.ts` renders for GitHub.
 */
import { failedLogExcerpt } from './ciReport';

/** One record of a build's timeline: a stage, phase, job or task. */
interface RawRecord {
  id?: string;
  parentId?: string | null;
  /** "The type of the record": Stage, Phase, Job, Task, Checkpoint in practice. */
  type?: string;
  name?: string;
  /** TaskResult: succeeded | succeededWithIssues | failed | canceled | skipped | abandoned. */
  result?: string | null;
  order?: number;
  issues?: { type?: string; message?: string; data?: Record<string, unknown> | null }[] | null;
  log?: { id?: number } | null;
}

const FAILED = new Set(['failed', 'canceled', 'abandoned']);

const records = (timeline: unknown): RawRecord[] => {
  const list = (timeline as { records?: unknown } | null)?.records;
  return Array.isArray(list)
    ? list.filter((r): r is RawRecord => !!r && typeof r === 'object')
    : [];
};

/** An issue's `data` value by key, whatever its case (the docs leave `data` untyped). */
function dataOf(data: Record<string, unknown> | null | undefined, key: string): string {
  const hit = Object.entries(data ?? {}).find(([k]) => k.toLowerCase() === key);
  return hit && (typeof hit[1] === 'string' || typeof hit[1] === 'number') ? String(hit[1]) : '';
}

/** What a failed build's timeline tells: its failed tasks as "job / task",
 *  their error issues as "error path:line: message", and the log of the last
 *  failed task (the one that stopped its job), if it has one. */
export function adoTimelineFailure(timeline: unknown): {
  failedSteps: string[];
  annotations: string[];
  logId: number | null;
} {
  const all = records(timeline);
  const byId = new Map(all.map((r) => [r.id, r]));
  const jobOf = (r: RawRecord): string => {
    for (let p = byId.get(r.parentId ?? undefined); p; p = byId.get(p.parentId ?? undefined)) {
      if (p.type === 'Job') return p.name ?? '';
    }
    return '';
  };
  const failed = all
    .filter((r) => r.type === 'Task' && FAILED.has(r.result ?? ''))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const failedSteps = failed.map((r) =>
    [jobOf(r), r.name || '(unnamed task)'].filter(Boolean).join(' / '),
  );
  const annotations = all.flatMap((r) =>
    (r.issues ?? [])
      .filter((i) => i?.type === 'error' && i.message)
      .map((i) => {
        const path = dataOf(i.data, 'sourcepath');
        const line = dataOf(i.data, 'linenumber');
        const where = path ? `${path}${line ? `:${line}` : ''}: ` : '';
        return `error ${where}${i.message}`;
      }),
  );
  const last = [...failed].reverse().find((r) => typeof r.log?.id === 'number');
  return { failedSteps, annotations: [...new Set(annotations)], logId: last?.log?.id ?? null };
}

// Each line of an Azure Pipelines log starts with its time: `2026-11-27T10:00:00.1234567Z `.
const LOG_TIME = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/;

/** A task's log up to its last `##[error]` line, without the timestamps, capped as GitHub's is. */
export function adoLogExcerpt(log: string): string {
  return failedLogExcerpt(
    log
      .split(/\r?\n/)
      .map((l) => l.replace(LOG_TIME, ''))
      .join('\n'),
  );
}

/** The line to start a log read from so the read holds its last `tail` lines
 *  (a `logs` listing gives each log's `lineCount`); 1 for a short or unknown log. */
export function adoLogStartLine(logs: unknown, logId: number, tail = 400): number {
  const list = (logs as { value?: unknown } | null)?.value;
  const entry = Array.isArray(list)
    ? (list as { id?: number; lineCount?: number }[]).find((l) => l?.id === logId)
    : undefined;
  const count = typeof entry?.lineCount === 'number' ? entry.lineCount : 0;
  return Math.max(1, count - tail + 1);
}

/** The build a check links to (`…/_build/results?buildId=N`, as
 *  `AzureDevOpsService.getPullRequestChecks` links a build policy), else null. */
export function adoBuildIdOf(url: string | null): number | null {
  const m = url ? /\/_build\/results\?(?:.*&)?buildId=(\d+)/.exec(url) : null;
  return m ? Number(m[1]) : null;
}
