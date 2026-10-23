import * as fs from 'fs';
import * as path from 'path';
import { parseJsonlLine, deduplicateByRequestId, calculateMetrics } from './jsonlParser';
import { claudeConfigDir, claudeProjectDir } from './claudePaths';
import { computeCostUsd } from './claudePricing';
import type { ParsedSessionMessage } from '../../shared/sessionTypes';

export interface TaskTokenStats {
  totalTokens: number;
  totalCostUsd: number;
}

const EMPTY: TaskTokenStats = { totalTokens: 0, totalCostUsd: 0 };

/** Every `.jsonl` under `dir`, recursive: subagent and workflow transcripts are
 *  written to `<sessionId>/subagents/**\/agent-*.jsonl`, not next to the session
 *  file. A missing dir yields none. */
async function listJsonl(dir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dir, { recursive: true });
    return entries.filter((e) => e.endsWith('.jsonl')).map((e) => path.join(dir, e));
  } catch {
    return [];
  }
}

/**
 * Where the task's recorded session wrote its transcript, whichever project
 * dir that is. Claude keys the dir by the session's *current* cwd, so an agent
 * that entered another worktree writes its new usage under that worktree's dir
 * and the task's own dir stops growing.
 */
async function listSessionFiles(sessionId: string): Promise<string[]> {
  const root = path.join(claudeConfigDir(), 'projects');
  let dirs: string[];
  try {
    dirs = await fs.promises.readdir(root);
  } catch {
    return [];
  }
  const found = await Promise.all(
    dirs.map(async (d) => [
      path.join(root, d, `${sessionId}.jsonl`),
      ...(await listJsonl(path.join(root, d, sessionId))),
    ]),
  );
  return found.flat();
}

/**
 * Sum tokens + cost over every transcript Claude wrote for a task. Accepts the
 * task's current path plus any earlier one (Task.previousPath after the 0.16
 * worktree move): Claude keys transcript dirs by the cwd a session started in,
 * so a moved task's history is split across two encoded dirs. `sessionId` adds
 * the task's recorded session wherever its cwd has since moved it. Messages are
 * deduplicated by requestId across all of them.
 */
export async function aggregateTokenStatsForTaskPath(
  taskPath: string | Array<string | null | undefined>,
  sessionId?: string | null,
): Promise<TaskTokenStats> {
  const paths = (Array.isArray(taskPath) ? taskPath : [taskPath]).filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );

  const files = new Set<string>();
  for (const p of new Set(paths)) {
    for (const f of await listJsonl(claudeProjectDir(p))) files.add(f);
  }
  if (sessionId) {
    for (const f of await listSessionFiles(sessionId)) files.add(f);
  }

  const allMessages: ParsedSessionMessage[] = [];
  for (const full of files) {
    let data: string;
    try {
      data = await fs.promises.readFile(full, 'utf8');
    } catch {
      continue;
    }
    for (const line of data.split('\n')) {
      const parsed = parseJsonlLine(line);
      if (parsed) allMessages.push(parsed);
    }
  }

  if (allMessages.length === 0) return EMPTY;

  const deduped = deduplicateByRequestId(allMessages);
  const metrics = calculateMetrics(deduped);

  let totalCostUsd = 0;
  for (const msg of deduped) {
    if (msg.usage) {
      totalCostUsd += computeCostUsd(msg.usage, msg.model);
    }
  }

  return {
    totalTokens: metrics.totalTokens,
    totalCostUsd,
  };
}
