import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CarbonStats, CarbonProjectStat } from '@shared/types';
import { computeEnergyFromMessages, sumEnergyStats, type EnergyStats } from '@shared/carbon';
import type { ParsedSessionMessage } from '@shared/sessionTypes';
import { parseJsonlLine, deduplicateByRequestId, encodeProjectPath } from '../utils/jsonlParser';

function getProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/** Best-effort readable label for a Claude Code encoded project folder name. */
function decodeProjectName(folder: string): string {
  // Encoding is lossy ('/' → '-'), so this can't be perfect; show the trailing
  // segment, which is usually the recognizable project/worktree name.
  const trimmed = folder.replace(/^-+/, '');
  const segments = trimmed.split('-').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : folder;
}

function energyStatsForFile(filePath: string): EnergyStats | null {
  let data: string;
  try {
    data = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const messages: ParsedSessionMessage[] = [];
  for (const line of data.split('\n')) {
    const parsed = parseJsonlLine(line);
    if (parsed) messages.push(parsed);
  }
  return computeEnergyFromMessages(deduplicateByRequestId(messages));
}

/**
 * Scan Claude Code session files under ~/.claude/projects and aggregate estimated
 * energy use, broken down by model family and by session folder. Synchronous fs is
 * fine here — this runs on demand from an IPC handler, not in a hot path.
 *
 * @param paths When provided, restricts the scan to the Claude Code project folders
 *   for these absolute paths (a Dash project's repo path + each task's worktree
 *   path). Omit to scan everything (lifetime total across all projects).
 */
export function computeCarbonStats(paths?: string[]): CarbonStats {
  const projectsDir = getProjectsDir();
  const empty: CarbonStats = {
    tokens: 0,
    energyWh: 0,
    tokensByModel: { opus: 0, sonnet: 0, haiku: 0 },
    projects: [],
    sessionCount: 0,
  };

  // Encode the requested paths to the folder names Claude Code uses. An empty
  // (but defined) list means "no folders match" → return empty rather than all.
  const allowedFolders =
    paths !== undefined ? new Set(paths.filter(Boolean).map(encodeProjectPath)) : null;
  if (allowedFolders && allowedFolders.size === 0) return empty;

  let projectFolders: string[];
  try {
    projectFolders = fs.readdirSync(projectsDir);
  } catch {
    return empty;
  }
  if (allowedFolders) projectFolders = projectFolders.filter((f) => allowedFolders.has(f));

  const perProjectStats: EnergyStats[] = [];
  const projectStats: CarbonProjectStat[] = [];
  let sessionCount = 0;

  for (const folder of projectFolders) {
    const folderPath = path.join(projectsDir, folder);
    let entries: string[];
    try {
      if (!fs.statSync(folderPath).isDirectory()) continue;
      entries = fs.readdirSync(folderPath);
    } catch {
      continue;
    }

    const fileStats: EnergyStats[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const stats = energyStatsForFile(path.join(folderPath, entry));
      if (!stats) continue;
      sessionCount++;
      fileStats.push(stats);
    }

    const projectTotal = sumEnergyStats(fileStats);
    if (projectTotal.tokens === 0) continue;
    perProjectStats.push(projectTotal);
    projectStats.push({
      project: decodeProjectName(folder),
      tokens: projectTotal.tokens,
      energyWh: projectTotal.energyWh,
    });
  }

  projectStats.sort((a, b) => b.energyWh - a.energyWh);

  const total = sumEnergyStats(perProjectStats);
  return {
    tokens: total.tokens,
    energyWh: total.energyWh,
    tokensByModel: total.tokensByModel,
    projects: projectStats,
    sessionCount,
  };
}
