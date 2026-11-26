import * as fs from 'fs';
import * as path from 'path';
import { parseJsonlLine, deduplicateByRequestId, calculateMetrics } from './jsonlParser';
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

const EMPTY: TaskTokenStats = { totalTokens: 0, totalCostUsd: 0 };

/**
 * Sum tokens + cost over every transcript Claude wrote for a task. Accepts the
 * task's current path plus any earlier one (Task.previousPath after the 0.16
 * worktree move): Claude keys transcript dirs by the cwd a session started in,
 * so a moved task's history is split across two encoded dirs. Messages are
 * deduplicated by requestId across all of them.
 */
export async function aggregateTokenStatsForTaskPath(
  taskPath: string | Array<string | null | undefined>,
): Promise<TaskTokenStats> {
  const paths = (Array.isArray(taskPath) ? taskPath : [taskPath]).filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );

  const allMessages: ParsedSessionMessage[] = [];
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

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const full = path.join(projectDir, entry);
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
  }

  if (allMessages.length === 0) return EMPTY;

  const deduped = deduplicateByRequestId(allMessages);
  const metrics = calculateMetrics(deduped);

  let totalCostUsd = 0;
  // Drift: one message per (version, model) is enough, and keeps a recompute
  // over thousands of lines from re-checking (and re-counting) each one.
  const checked = new Set<string>();
  for (const msg of deduped) {
    if (msg.usage) {
      totalCostUsd += computeCostUsd(msg.usage, msg.model);
    }
    const key = `${msg.version}\0${msg.model}`;
    if (msg.type === 'assistant' && !checked.has(key)) {
      checked.add(key);
      const version = parseClaudeVersion(msg.version)?.join('.') ?? 'unknown';
      reportFindings('transcript', checkTranscriptUsage(msg.usage, msg.model), version);
    }
  }

  return {
    totalTokens: metrics.totalTokens,
    totalCostUsd,
  };
}
