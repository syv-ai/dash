import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  encodeProjectPath,
  parseJsonlLine,
  deduplicateByRequestId,
  calculateMetrics,
} from './jsonlParser';
import { computeCostUsd } from './claudePricing';
import type { ParsedSessionMessage } from '../../shared/sessionTypes';

export interface TaskTokenStats {
  totalTokens: number;
  totalCostUsd: number;
}

const EMPTY: TaskTokenStats = { totalTokens: 0, totalCostUsd: 0 };

export async function aggregateTokenStatsForTaskPath(taskPath: string): Promise<TaskTokenStats> {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', encodeProjectPath(taskPath));

  let entries: string[];
  try {
    entries = await fs.promises.readdir(projectDir);
  } catch {
    return EMPTY;
  }

  const allMessages: ParsedSessionMessage[] = [];
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
